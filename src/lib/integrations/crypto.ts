import crypto from "node:crypto";

/**
 * At-rest encryption for third-party integration credentials
 * (MatterportConnection.accessTokenEnc / refreshTokenEnc). AES-256-GCM with
 * a key derived from INTEGRATION_ENCRYPTION_KEY (falls back to
 * NEXTAUTH_SECRET, documented in .env.example — set a dedicated key in
 * production so rotating the auth secret doesn't also break stored
 * credentials).
 */
function getKey(): Buffer {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY (or NEXTAUTH_SECRET) must be set to store integration credentials");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted credential payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
