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

/**
 * Storage classes this app can ask for, named independently of any one
 * vendor's vocabulary. Mapped to concrete S3 class names in the provider.
 */
export type StorageTierName = "STANDARD" | "INFREQUENT_ACCESS" | "ARCHIVE" | "DEEP_ARCHIVE";

/**
 * The outcome of a tier transition, kept as a discriminated union so a caller
 * cannot record "moved to archive" when nothing moved.
 *
 * NOT_SUPPORTED is a first-class outcome rather than an error: Supabase
 * Storage and Cloudflare R2 have a single storage class, so "this store does
 * not tier" is the honest answer for a large share of deployments, and it is
 * different from "the transition was attempted and failed".
 */
export type TierTransitionResult =
  | { status: "TRANSITIONED"; tier: StorageTierName }
  | { status: "NOT_SUPPORTED"; reason: string }
  | { status: "FAILED"; reason: string };

/**
 * Archived objects cannot be read until restored, and restore takes time.
 * REQUESTED means the store accepted the request, not that bytes are ready.
 */
export type RestoreResult =
  | { status: "REQUESTED"; availableAfter: Date | null }
  | { status: "ALREADY_AVAILABLE" }
  | { status: "NOT_SUPPORTED"; reason: string }
  | { status: "FAILED"; reason: string };

export interface StorageCapabilities {
  /** Whether this backend has distinct storage classes at all. */
  tiering: boolean;
}

export interface StorageProvider {
  /**
   * What this backend can actually do. Callers branch on this rather than
   * assuming, so a feature that depends on tiering can degrade visibly
   * instead of silently no-op'ing.
   */
  capabilities(): StorageCapabilities;
  /** Moves an existing object to a different storage class. */
  transitionTier(key: string, tier: StorageTierName): Promise<TierTransitionResult>;
  /** Asks the store to make an archived object readable again. */
  restoreObject(key: string, availableForDays: number): Promise<RestoreResult>;
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
  /**
   * A directory on disk has no storage classes. Saying so is the point:
   * reporting a successful "transition to archive" here would make the
   * tiering feature look like it worked in development and then behave
   * completely differently in production.
   */
  capabilities(): StorageCapabilities {
    return { tiering: false };
  }

  async transitionTier(): Promise<TierTransitionResult> {
    return {
      status: "NOT_SUPPORTED",
      reason: "Local disk storage has no storage classes to transition between",
    };
  }

  async restoreObject(): Promise<RestoreResult> {
    // Nothing is ever archived here, so everything is always readable.
    return { status: "ALREADY_AVAILABLE" };
  }

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
/**
 * Our tier names to concrete S3 storage classes.
 *
 * GLACIER_IR rather than GLACIER for ARCHIVE: instant retrieval costs more per
 * GB but needs no restore step, and an archived-but-unreadable inspection
 * photo is a support ticket. DEEP_ARCHIVE is the tier that genuinely requires
 * restore, and is opt-in precisely because of that.
 */
const S3_STORAGE_CLASS: Record<StorageTierName, string> = {
  STANDARD: "STANDARD",
  INFREQUENT_ACCESS: "STANDARD_IA",
  ARCHIVE: "GLACIER_IR",
  DEEP_ARCHIVE: "DEEP_ARCHIVE",
};

class S3StorageProvider implements StorageProvider {
  constructor(private readonly config: S3SignerConfig) {}

  capabilities(): StorageCapabilities {
    // Not every S3-compatible store implements storage classes — Supabase and
    // R2 do not. Operators say which they have rather than the app guessing
    // from the endpoint hostname, which would be a brittle inference.
    return { tiering: (process.env.STORAGE_SUPPORTS_TIERING ?? "false") === "true" };
  }

  async transitionTier(key: string, tier: StorageTierName): Promise<TierTransitionResult> {
    if (!this.capabilities().tiering) {
      return {
        status: "NOT_SUPPORTED",
        reason:
          "STORAGE_SUPPORTS_TIERING is not enabled — this backend is configured as having a single storage class",
      };
    }
    // S3 changes an existing object's class by copying it onto itself with a
    // new class. There is no "set storage class" operation.
    const copySource = `/${this.config.bucket}/${key}`;
    const signedHeaders = {
      "x-amz-copy-source": copySource,
      "x-amz-storage-class": S3_STORAGE_CLASS[tier],
      // Keep the object's existing metadata; we are changing where it lives,
      // not what it is.
      "x-amz-metadata-directive": "COPY",
    };
    const { url } = presignS3Url(this.config, {
      method: "PUT",
      key,
      expiresInSeconds: 300,
      signedHeaders,
    });
    const res = await fetch(url, { method: "PUT", headers: signedHeaders });
    if (!res.ok) {
      return { status: "FAILED", reason: `Storage class transition returned HTTP ${res.status}` };
    }
    return { status: "TRANSITIONED", tier };
  }

  async restoreObject(key: string, availableForDays: number): Promise<RestoreResult> {
    if (!this.capabilities().tiering) {
      // Without tiering nothing is ever archived, so nothing needs restoring.
      return { status: "ALREADY_AVAILABLE" };
    }
    const body = `<RestoreRequest><Days>${availableForDays}</Days></RestoreRequest>`;
    const { url } = presignS3Url(this.config, {
      method: "POST",
      key,
      expiresInSeconds: 300,
      query: { restore: "" },
    });
    const res = await fetch(url, { method: "POST", body });
    // 202 = restore started. 200 = already restored. 409 = restore already in
    // progress, which is success from the caller's point of view: someone
    // asked first and the object is on its way back either way.
    if (res.status === 200) return { status: "ALREADY_AVAILABLE" };
    if (res.status === 202 || res.status === 409) {
      return {
        status: "REQUESTED",
        availableAfter: new Date(Date.now() + availableForDays * 24 * 60 * 60 * 1000),
      };
    }
    return { status: "FAILED", reason: `Restore request returned HTTP ${res.status}` };
  }

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
