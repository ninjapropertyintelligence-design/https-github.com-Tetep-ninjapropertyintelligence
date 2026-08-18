import crypto from "node:crypto";

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

export interface StorageProvider {
  createUploadUrl(params: {
    organizationId: string;
    filename: string;
    contentType: string;
  }): Promise<SignedUploadUrl>;
  getDownloadUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}

const UPLOAD_TTL_MS = 15 * 60 * 1000;
const DOWNLOAD_TTL_MS = 60 * 60 * 1000;

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
      url: `/api/uploads/${encodeURIComponent(key)}?exp=${expiresAt}&token=${token}`,
      method: "PUT",
      key,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async getDownloadUrl(key: string): Promise<string> {
    const expiresAt = Date.now() + DOWNLOAD_TTL_MS;
    const token = sign(key, expiresAt);
    return `/api/uploads/${encodeURIComponent(key)}?exp=${expiresAt}&token=${token}`;
  }

  async delete(): Promise<void> {
    // Local dev provider: deletion of the underlying file is intentionally
    // not implemented (evidence/documents are soft-referenced, not purged).
  }
}

let provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (provider) return provider;
  const kind = process.env.STORAGE_PROVIDER ?? "local";
  if (kind !== "local") {
    throw new Error(
      `Storage provider "${kind}" is not implemented yet — only "local" is available in this phase. ` +
        "Add an S3StorageProvider behind the StorageProvider interface to enable it.",
    );
  }
  provider = new LocalStorageProvider();
  return provider;
}
