import crypto from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { presignS3Url, type S3SignerConfig } from "@/lib/s3-signer";

/**
 * FILE STORAGE (spec §18-19). Large files must never be proxied through the
 * app server — clients upload directly to storage using short-lived signed
 * URLs, and the app only ever stores the resulting key + metadata.
 *
 * `StorageProvider` is the abstraction; `LocalStorageProvider` is a real,
 * working implementation for local/dev environments (disk-backed, HMAC-signed
 * URLs with expiry — the same contract a real signed URL has, not a canned
 * "success" response). Swapping to S3/R2 in staging/production means adding
 * an `S3StorageProvider` behind this same interface and switching
 * `STORAGE_PROVIDER`; no caller changes.
 */
export interface SignedUploadUrl {
  url: string;
  method: "PUT";
  key: string;
  expiresAt: string;
}

export interface UploadVerification {
  exists: boolean;
  actualSizeBytes: number | null;
  actualChecksumSha256: string | null;
}

export interface StorageProvider {
  createUploadUrl(params: {
    organizationId: string;
    filename: string;
    contentType: string;
  }): Promise<SignedUploadUrl>;
  getDownloadUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
  /**
   * Reads back what was actually written for a key — used to verify large
   * direct-uploaded files (drone images/outputs) after the client PUTs
   * them, without the app server ever holding the bytes in a request body.
   * For a real S3 backend this would be a HeadObject / checksum call
   * instead of a local read.
   */
  verifyUpload(key: string): Promise<UploadVerification>;
  /**
   * Reads the full object back into memory — used only for small,
   * server-side processing jobs (document text extraction) where holding
   * the bytes briefly is appropriate, unlike the large drone/evidence
   * files that must never round-trip through the app server.
   */
  readBytes(key: string): Promise<Buffer | null>;
  /**
   * Writes an object from the app server. The counterpart to `readBytes`,
   * and subject to the same rule: only for small files the server is
   * legitimately holding anyway — an uploaded import spreadsheet, capped at
   * a few MB — never the large capture files that use signed direct upload.
   */
  writeBytes(key: string, bytes: Buffer): Promise<void>;
}

const UPLOAD_TTL_MS = 15 * 60 * 1000;
const DOWNLOAD_TTL_MS = 60 * 60 * 1000;
const LOCAL_STORAGE_ROOT = path.join(process.cwd(), ".local-storage");

function sign(key: string, expiresAt: number): string {
  const secret = process.env.NEXTAUTH_SECRET ?? "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${key}:${expiresAt}`).digest("hex");
}

export function verifyStorageToken(key: string, expiresAt: number, token: string): boolean {
  if (Date.now() > expiresAt) return false;
  const expected = sign(key, expiresAt);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token.padEnd(expected.length, "0")));
}

class LocalStorageProvider implements StorageProvider {
  async createUploadUrl(params: {
    organizationId: string;
    filename: string;
    contentType: string;
  }): Promise<SignedUploadUrl> {
    const safeName = params.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `${params.organizationId}/${crypto.randomUUID()}-${safeName}`;
    const expiresAt = Date.now() + UPLOAD_TTL_MS;
    const token = sign(key, expiresAt);
    return {
      url: `/api/v1/uploads/${encodeURIComponent(key)}?exp=${expiresAt}&token=${token}`,
      method: "PUT",
      key,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async getDownloadUrl(key: string): Promise<string> {
    const expiresAt = Date.now() + DOWNLOAD_TTL_MS;
    const token = sign(key, expiresAt);
    return `/api/v1/uploads/${encodeURIComponent(key)}?exp=${expiresAt}&token=${token}`;
  }

  /**
   * Actually removes the file. This used to be a no-op, which was fine while
   * nothing called it — but secure deletion (spec §54) does, and a provider
   * that silently keeps the bytes would let a deletion report success while
   * the customer's data stayed on disk. That is precisely the "delete does
   * not mean hiding a row" failure the spec calls out.
   *
   * Missing files are not an error: deletion is retried and must converge,
   * so a key that is already gone is the desired end state.
   */
  async delete(key: string): Promise<void> {
    const filePath = path.join(LOCAL_STORAGE_ROOT, key);
    // Same containment check as verifyUpload — a key is attacker-influenced
    // input and must never escape the storage root.
    if (!filePath.startsWith(LOCAL_STORAGE_ROOT + path.sep)) {
      throw new Error("Refusing to delete a key outside the storage root");
    }
    try {
      await unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }

  async verifyUpload(key: string): Promise<UploadVerification> {
    const filePath = path.join(LOCAL_STORAGE_ROOT, key);
    if (!filePath.startsWith(LOCAL_STORAGE_ROOT + path.sep)) {
      return { exists: false, actualSizeBytes: null, actualChecksumSha256: null };
    }
    try {
      const stats = await stat(filePath);
      const bytes = await readFile(filePath);
      const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
      return { exists: true, actualSizeBytes: stats.size, actualChecksumSha256: checksum };
    } catch {
      return { exists: false, actualSizeBytes: null, actualChecksumSha256: null };
    }
  }

  async readBytes(key: string): Promise<Buffer | null> {
    const filePath = path.join(LOCAL_STORAGE_ROOT, key);
    if (!filePath.startsWith(LOCAL_STORAGE_ROOT + path.sep)) return null;
    try {
      return await readFile(filePath);
    } catch {
      return null;
    }
  }

  async writeBytes(key: string, bytes: Buffer): Promise<void> {
    const filePath = path.join(LOCAL_STORAGE_ROOT, key);
    // Same containment check as everywhere else a key becomes a path.
    if (!filePath.startsWith(LOCAL_STORAGE_ROOT + path.sep)) {
      throw new Error("Refusing to write a key outside the storage root");
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
  }
}

/**
 * S3-compatible object storage (AWS S3, Supabase Storage, Cloudflare R2, MinIO).
 *
 * Every operation goes through a presigned URL rather than an SDK call. That is
 * a deliberate consequence of the §18-19 contract: browsers must be handed a
 * signed URL for direct upload, so presigning is required regardless — and
 * routing the server-side operations through the same path means there is one
 * signing implementation to get right instead of two.
 *
 * The app server never streams large objects. `readBytes`/`writeBytes` are
 * documented as small-file-only on the interface and that rule matters more
 * here than it did on local disk, because on serverless these bytes cross the
 * network and count against the function's memory and execution budget.
 */
class S3StorageProvider implements StorageProvider {
  constructor(private readonly config: S3SignerConfig) {}

  async createUploadUrl(params: {
    organizationId: string;
    filename: string;
    contentType: string;
  }): Promise<SignedUploadUrl> {
    // Key shape is kept identical to the local provider so that objects written
    // by one are addressable by the other — which is what makes a migration
    // between them a data copy rather than a re-keying exercise.
    const safeName = params.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `${params.organizationId}/${crypto.randomUUID()}-${safeName}`;
    const { url, expiresAt } = presignS3Url(this.config, {
      method: "PUT",
      key,
      expiresInSeconds: Math.floor(UPLOAD_TTL_MS / 1000),
    });
    return { url, method: "PUT", key, expiresAt: expiresAt.toISOString() };
  }

  async getDownloadUrl(key: string): Promise<string> {
    const { url } = presignS3Url(this.config, {
      method: "GET",
      key,
      expiresInSeconds: Math.floor(DOWNLOAD_TTL_MS / 1000),
    });
    return url;
  }

  async delete(key: string): Promise<void> {
    const { url } = presignS3Url(this.config, { method: "DELETE", key, expiresInSeconds: 300 });
    const res = await fetch(url, { method: "DELETE" });
    // S3 returns 204 for a successful delete and also for a key that was never
    // there. 404 is treated the same way for stores that report it instead:
    // deletion is retried and must converge, so "already gone" is success.
    if (!res.ok && res.status !== 404) {
      throw new Error(`Storage delete failed for key (HTTP ${res.status})`);
    }
  }

  async verifyUpload(key: string): Promise<UploadVerification> {
    const { url } = presignS3Url(this.config, { method: "HEAD", key, expiresInSeconds: 300 });
    const res = await fetch(url, {
      method: "HEAD",
      // Asks the store to return the stored SHA-256 alongside the metadata.
      // Only objects uploaded with a checksum have one; see the null case below.
      headers: { "x-amz-checksum-mode": "ENABLED" },
    });
    if (!res.ok) {
      return { exists: false, actualSizeBytes: null, actualChecksumSha256: null };
    }
    const length = res.headers.get("content-length");
    // S3 reports checksums base64-encoded; the rest of the codebase speaks hex.
    const b64 = res.headers.get("x-amz-checksum-sha256");
    const checksum = b64 ? Buffer.from(b64, "base64").toString("hex") : null;
    return {
      exists: true,
      actualSizeBytes: length === null ? null : Number(length),
      actualChecksumSha256: checksum,
    };
  }

  async readBytes(key: string): Promise<Buffer | null> {
    const { url } = presignS3Url(this.config, { method: "GET", key, expiresInSeconds: 300 });
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  async writeBytes(key: string, bytes: Buffer): Promise<void> {
    const { url } = presignS3Url(this.config, { method: "PUT", key, expiresInSeconds: 300 });
    const res = await fetch(url, {
      method: "PUT",
      body: new Uint8Array(bytes),
      headers: { "content-length": String(bytes.byteLength) },
    });
    if (!res.ok) {
      throw new Error(`Storage write failed for key (HTTP ${res.status})`);
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `STORAGE_PROVIDER is "s3" but ${name} is not set. ` +
        "S3 storage needs STORAGE_BUCKET, STORAGE_REGION, STORAGE_ENDPOINT, " +
        "STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY.",
    );
  }
  return value;
}

export function readS3ConfigFromEnv(): S3SignerConfig {
  return {
    accessKeyId: requireEnv("STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("STORAGE_SECRET_ACCESS_KEY"),
    region: requireEnv("STORAGE_REGION"),
    endpoint: requireEnv("STORAGE_ENDPOINT"),
    bucket: requireEnv("STORAGE_BUCKET"),
    // Supabase, R2 and MinIO are path-style; AWS S3 proper prefers virtual-host.
    // Defaulting to path-style matches the store this app is deployed against
    // and is the safer default — virtual-host silently breaks on endpoints that
    // do not wildcard their subdomains.
    forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE ?? "true") !== "false",
    sessionToken: process.env.STORAGE_SESSION_TOKEN || undefined,
  };
}

let provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (provider) return provider;
  const kind = process.env.STORAGE_PROVIDER ?? "local";
  if (kind === "local") {
    provider = new LocalStorageProvider();
  } else if (kind === "s3") {
    provider = new S3StorageProvider(readS3ConfigFromEnv());
  } else {
    throw new Error(
      `Unknown STORAGE_PROVIDER "${kind}". Supported values are "local" and "s3".`,
    );
  }
  return provider;
}

/** Test seam: lets a suite install a provider without touching module state directly. */
export function __setStorageProviderForTest(next: StorageProvider | null): void {
  provider = next;
}
