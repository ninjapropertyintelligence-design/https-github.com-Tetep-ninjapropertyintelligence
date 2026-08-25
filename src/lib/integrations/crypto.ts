import { decryptWithKey, deriveKey, encryptWithKey } from "@/lib/crypto";

/**
 * At-rest encryption for third-party integration credentials
 * (MatterportConnection.accessTokenEnc / refreshTokenEnc). AES-256-GCM with
 * a key derived from INTEGRATION_ENCRYPTION_KEY (falls back to
 * NEXTAUTH_SECRET, documented in .env.example — set a dedicated key in
 * production so rotating the auth secret doesn't also break stored
 * credentials).
 *
 * The primitive now lives in `lib/crypto.ts`; the key derivation here is
 * unchanged (no domain separator), so credentials encrypted before that
 * split still decrypt.
 */
function getKey(): Buffer {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY (or NEXTAUTH_SECRET) must be set to store integration credentials");
  }
  return deriveKey(secret);
}

export function encryptSecret(plaintext: string): string {
  return encryptWithKey(getKey(), plaintext);
}

export function decryptSecret(payload: string): string {
  return decryptWithKey(getKey(), payload);
}
