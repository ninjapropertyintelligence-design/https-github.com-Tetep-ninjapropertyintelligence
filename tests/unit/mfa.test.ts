import { describe, expect, it, beforeEach } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hotp,
  normalizeRecoveryCode,
  otpauthUri,
  totp,
  verifyTotp,
} from "@/lib/mfa";
import {
  AUTH_RULE,
  __resetAllRateLimits,
  checkRateLimit,
  resetRateLimit,
} from "@/lib/rate-limit";

/**
 * The TOTP implementation is hand-written (see lib/mfa.ts for why), so it is
 * asserted against the published RFC test vectors rather than against
 * itself. If any of these fail, real authenticator apps would disagree with
 * us and users would be locked out.
 */
const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET_B32 = base32Encode(Buffer.from(RFC_SECRET_ASCII, "ascii"));

describe("HOTP — RFC 4226 Appendix D test vectors", () => {
  const EXPECTED = [
    "755224", "287082", "359152", "969429", "338314",
    "254676", "287922", "162583", "399871", "520489",
  ];

  it.each(EXPECTED.map((code, counter) => ({ counter, code })))(
    "counter $counter produces $code",
    ({ counter, code }) => {
      expect(hotp(Buffer.from(RFC_SECRET_ASCII, "ascii"), counter)).toBe(code);
    },
  );
});

describe("TOTP — RFC 6238 Appendix B test vectors (SHA-1)", () => {
  // The RFC tabulates 8-digit codes; the counter is floor(T / 30).
  const VECTORS = [
    { unixSeconds: 59, code: "94287082" },
    { unixSeconds: 1111111109, code: "07081804" },
    { unixSeconds: 1111111111, code: "14050471" },
    { unixSeconds: 1234567890, code: "89005924" },
    { unixSeconds: 2000000000, code: "69279037" },
  ];

  it.each(VECTORS)("T=$unixSeconds produces $code", ({ unixSeconds, code }) => {
    const counter = Math.floor(unixSeconds / 30);
    expect(hotp(Buffer.from(RFC_SECRET_ASCII, "ascii"), counter, 8)).toBe(code);
  });

  it("the 6-digit form used by the app is the low 6 digits of the same vector", () => {
    expect(totp(RFC_SECRET_B32, 59_000)).toBe("287082");
  });
});

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    for (const len of [1, 2, 3, 4, 5, 10, 20, 32]) {
      const buf = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37 + 11) % 256));
      expect(base32Decode(base32Encode(buf))).toEqual(buf);
    }
  });

  it("matches RFC 4648 vectors", () => {
    expect(base32Encode(Buffer.from("f"))).toBe("MY");
    expect(base32Encode(Buffer.from("fo"))).toBe("MZXQ");
    expect(base32Encode(Buffer.from("foo"))).toBe("MZXW6");
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });

  it("rejects characters outside the alphabet rather than decoding garbage", () => {
    expect(() => base32Decode("ABC!")).toThrow(/Invalid base32/);
  });
});

describe("verifyTotp", () => {
  const NOW = 1_700_000_000_000;

  it("accepts the current code", () => {
    expect(verifyTotp(RFC_SECRET_B32, totp(RFC_SECRET_B32, NOW), NOW)).toBe(0);
  });

  it("tolerates one step of clock skew in each direction", () => {
    expect(verifyTotp(RFC_SECRET_B32, totp(RFC_SECRET_B32, NOW - 30_000), NOW)).toBe(-1);
    expect(verifyTotp(RFC_SECRET_B32, totp(RFC_SECRET_B32, NOW + 30_000), NOW)).toBe(1);
  });

  it("rejects a code two steps away — the window is bounded, not generous", () => {
    expect(verifyTotp(RFC_SECRET_B32, totp(RFC_SECRET_B32, NOW - 90_000), NOW)).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, totp(RFC_SECRET_B32, NOW + 90_000), NOW)).toBeNull();
  });

  it("rejects malformed input without throwing (it is attacker-controlled)", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56 78", "'; DROP TABLE"]) {
      expect(verifyTotp(RFC_SECRET_B32, bad, NOW)).toBeNull();
    }
  });

  it("ignores whitespace, which is what users paste", () => {
    const code = totp(RFC_SECRET_B32, NOW);
    expect(verifyTotp(RFC_SECRET_B32, `${code.slice(0, 3)} ${code.slice(3)}`, NOW)).toBe(0);
  });

  it("a code from a different secret never verifies", () => {
    const other = generateTotpSecret();
    expect(verifyTotp(RFC_SECRET_B32, totp(other, NOW), NOW)).toBeNull();
  });
});

describe("secrets and recovery codes", () => {
  it("generates a 160-bit secret, the RFC 4226 recommended length", () => {
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it("generates distinct secrets", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(50);
  });

  it("builds an otpauth URI an authenticator can parse", () => {
    const uri = otpauthUri({ secret: RFC_SECRET_B32, accountEmail: "a@b.com", issuer: "Property Intelligence" });
    const parsed = new URL(uri);
    expect(parsed.protocol).toBe("otpauth:");
    expect(decodeURIComponent(parsed.pathname)).toContain("Property Intelligence:a@b.com");
    expect(parsed.searchParams.get("secret")).toBe(RFC_SECRET_B32);
    expect(parsed.searchParams.get("digits")).toBe("6");
    expect(parsed.searchParams.get("period")).toBe("30");
  });

  it("issues 10 unique recovery codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
  });

  it("hashes a recovery code the same way regardless of how the user types it", () => {
    const canonical = hashRecoveryCode("ABCDE-12345");
    expect(hashRecoveryCode("abcde-12345")).toBe(canonical);
    expect(hashRecoveryCode(" ABCDE12345 ")).toBe(canonical);
    expect(normalizeRecoveryCode("abcde-12345")).toBe("ABCDE12345");
  });

  it("stores a hash, not the code", () => {
    const hash = hashRecoveryCode("ABCDE-12345");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("ABCDE");
  });
});

describe("rate limiting (spec §43)", () => {
  beforeEach(() => __resetAllRateLimits());

  it("allows exactly `limit` attempts, then blocks", () => {
    const now = 1_000_000;
    for (let i = 0; i < AUTH_RULE.limit; i++) {
      expect(checkRateLimit("k", AUTH_RULE, now).allowed).toBe(true);
    }
    const blocked = checkRateLimit("k", AUTH_RULE, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keys are independent — one attacker cannot lock out another user", () => {
    const now = 1_000_000;
    for (let i = 0; i <= AUTH_RULE.limit; i++) checkRateLimit("victim-a", AUTH_RULE, now);
    expect(checkRateLimit("victim-a", AUTH_RULE, now).allowed).toBe(false);
    expect(checkRateLimit("victim-b", AUTH_RULE, now).allowed).toBe(true);
  });

  it("the window actually expires", () => {
    const now = 1_000_000;
    for (let i = 0; i <= AUTH_RULE.limit; i++) checkRateLimit("k", AUTH_RULE, now);
    expect(checkRateLimit("k", AUTH_RULE, now).allowed).toBe(false);
    expect(checkRateLimit("k", AUTH_RULE, now + AUTH_RULE.windowMs + 1).allowed).toBe(true);
  });

  it("a successful login clears the counter so a legitimate user isn't punished", () => {
    const now = 1_000_000;
    for (let i = 0; i < AUTH_RULE.limit - 1; i++) checkRateLimit("k", AUTH_RULE, now);
    resetRateLimit("k");
    expect(checkRateLimit("k", AUTH_RULE, now).remaining).toBe(AUTH_RULE.limit - 1);
  });
});
