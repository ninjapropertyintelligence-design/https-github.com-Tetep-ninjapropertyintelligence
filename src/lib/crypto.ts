import crypto from "node:crypto";

/**
 * The one at-rest encryption primitive for this app: AES-256-GCM over a
 * SHA-256-derived key. Both callers that store secrets in the database
 * (third-party integration credentials, TOTP secrets) go through here, so
 * the ciphertext format and the authentication tag handling exist once.
 *
 * `deriveKey(secret)` with no domain reproduces the derivation that
 * `lib/integrations/crypto.ts` has always used — existing stored Matterport
 * tokens keep decrypting. New callers pass a `domain` so a single leaked
 * key can't be reused across purposes.
 */
export function deriveKey(secret: string, domain?: string): Buffer {
  return crypto.createHash("sha256").update(domain ? `${domain}:${secret}` : secret).digest();
}

/** Returns `iv.authTag.ciphertext`, each base64. */
export function encryptWithKey(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptWithKey(key: Buffer, payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
