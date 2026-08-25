import crypto from "node:crypto";
import { decryptWithKey, deriveKey, encryptWithKey } from "@/lib/crypto";

/**
 * TOTP multi-factor authentication (spec §43 "MFA capability").
 *
 * Implemented directly against RFC 4226 (HOTP) and RFC 6238 (TOTP) using
 * node's crypto rather than pulling in a dependency: the algorithm is ~40
 * lines, this is authentication code, and both RFCs publish test vectors
 * that `tests/unit/mfa.test.ts` asserts against — so correctness is proven
 * rather than trusted.
 *
 * Secrets are encrypted at rest with AES-256-GCM (spec §43 "Encryption at
 * rest") through the shared primitive in lib/crypto.ts. There is
 * deliberately no plaintext path: a TOTP secret is a shared secret, and
 * storing it in the clear would make the database a bypass for the second
 * factor it is supposed to provide.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** Accept the previous and next step to tolerate clock skew (RFC 6238 §5.2). */
const VERIFY_WINDOW_STEPS = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character in TOTP secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 4226 HOTP. Exported so the RFC's own test vectors can be asserted. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", secret).update(counterBuf).digest();
  // Dynamic truncation (RFC 4226 §5.4).
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/** RFC 6238 TOTP for a given instant (defaults to now). */
export function totp(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

/**
 * Constant-time verification across the skew window. Returns the matched
 * step offset (so a caller could reject replays by remembering it) or null.
 */
export function verifyTotp(secretBase32: string, code: string, atMs: number = Date.now()): number | null {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;

  const secret = base32Decode(secretBase32);
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  for (let offset = -VERIFY_WINDOW_STEPS; offset <= VERIFY_WINDOW_STEPS; offset++) {
    const expected = hotp(secret, counter + offset);
    // Both are fixed-length 6-digit strings, so timingSafeEqual is safe to
    // call directly and never leaks length information.
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) {
      return offset;
    }
  }
  return null;
}

/** 160-bit secret, the RFC 4226 recommended length, base32 for authenticators. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** otpauth:// URI an authenticator app scans or accepts pasted. */
export function otpauthUri(params: { secret: string; accountEmail: string; issuer: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountEmail}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

// ---------------------------------------------------------------------------
// Secret encryption at rest
// ---------------------------------------------------------------------------

export class MfaNotConfiguredError extends Error {
  constructor() {
    super(
      "No key is available to encrypt TOTP secrets. Set MFA_ENCRYPTION_KEY (or NEXTAUTH_SECRET) " +
        "before enabling multi-factor authentication.",
    );
    this.name = "MfaNotConfiguredError";
  }
}

/**
 * Key source mirrors lib/integrations/crypto.ts: a dedicated key if set,
 * otherwise NEXTAUTH_SECRET, which any working deployment already has. The
 * "mfa-totp" domain separator means this key cannot decrypt integration
 * credentials and vice versa, so one compromised value doesn't unlock both.
 *
 * Consequence worth stating: rotating NEXTAUTH_SECRET without a dedicated
 * MFA_ENCRYPTION_KEY invalidates every enrollment. Production should set
 * the dedicated key — .env.example says so.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.MFA_ENCRYPTION_KEY ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new MfaNotConfiguredError();
  return deriveKey(secret, "mfa-totp");
}

/** True when this deployment can store TOTP secrets. Drives honest UI state. */
export function isMfaConfigured(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  return encryptWithKey(getEncryptionKey(), plaintext);
}

export function decryptSecret(stored: string): string {
  return decryptWithKey(getEncryptionKey(), stored);
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10;

/**
 * Recovery codes are shown to the user exactly once and stored only as
 * SHA-256 hashes. bcrypt would be overkill and slow here: unlike a password
 * these are 50 bits of full-entropy random, so there is nothing to brute
 * force offline that a work factor would meaningfully slow down.
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^0-9A-F]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}
