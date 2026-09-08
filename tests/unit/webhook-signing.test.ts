import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  assertDeliverableUrl,
  generateSigningSecret,
  signPayload,
  verifySignature,
} from "@/lib/webhooks";
import { hashRequestBody } from "@/lib/idempotency";

/**
 * The signing scheme is what an integrator writes code against, and a
 * scheme nobody verified against is a guess. `verifySignature` is exported
 * for exactly that reason and is exercised here the way a receiver would
 * use it — including the cases where it must REFUSE.
 */
const SECRET = "whsec_test_secret_value";
const BODY = JSON.stringify({ id: "del_1", type: "issue.created", data: { issueId: "abc" } });
const NOW = 1_780_000_000;

describe("webhook signatures", () => {
  it("a signature we produce verifies with the same secret", () => {
    const header = signPayload(SECRET, BODY, NOW);
    expect(verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW })).toBe(true);
  });

  it("emits the documented t=…,v1=… shape", () => {
    expect(signPayload(SECRET, BODY, NOW)).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it("is deterministic — same inputs, same signature", () => {
    expect(signPayload(SECRET, BODY, NOW)).toBe(signPayload(SECRET, BODY, NOW));
  });

  it("rejects a tampered body", () => {
    const header = signPayload(SECRET, BODY, NOW);
    const tampered = JSON.stringify({ id: "del_1", type: "issue.created", data: { issueId: "SOMEONE_ELSE" } });
    expect(verifySignature({ secret: SECRET, body: tampered, header, nowSeconds: NOW })).toBe(false);
  });

  it("rejects the wrong secret — this is the whole point", () => {
    const header = signPayload(SECRET, BODY, NOW);
    expect(verifySignature({ secret: "whsec_attacker", body: BODY, header, nowSeconds: NOW })).toBe(false);
  });

  it("rejects a replay outside the tolerance window even though the HMAC is valid", () => {
    // The timestamp is inside the signed material precisely so a captured
    // request stops being usable. Signing the body alone would leave a
    // valid payload valid forever.
    const header = signPayload(SECRET, BODY, NOW);
    expect(verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW + 301 })).toBe(false);
    expect(verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW + 299 })).toBe(true);
  });

  it("rejects a future timestamp just as firmly as a stale one", () => {
    const header = signPayload(SECRET, BODY, NOW + 10_000);
    expect(verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW })).toBe(false);
  });

  it("rejects malformed headers rather than throwing — they are attacker-supplied", () => {
    for (const header of ["", "garbage", "t=abc,v1=xyz", `t=${NOW}`, `v1=${"a".repeat(64)}`, `t=${NOW},v1=short`]) {
      expect(verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW })).toBe(false);
    }
  });

  it("generates unguessable, prefixed secrets", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateSigningSecret()));
    expect(secrets.size).toBe(50);
    for (const s of secrets) expect(s).toMatch(/^whsec_[A-Za-z0-9_-]{30,}$/);
  });
});

describe("endpoint URL safety", () => {
  it("accepts a normal https URL", () => {
    expect(() => assertDeliverableUrl("https://example.com/hooks/npi")).not.toThrow();
  });

  it("refuses http — payloads carry customer property data", () => {
    expect(() => assertDeliverableUrl("http://example.com/hooks")).toThrow(/https/);
  });

  it.each([
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://10.0.0.5/hook",
    "https://192.168.1.10/hook",
    "https://172.16.0.9/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://db.internal/hook",
    "https://service.local/hook",
  ])("refuses %s — a customer-supplied URL we fetch is an SSRF vector", (url) => {
    expect(() => assertDeliverableUrl(url)).toThrow(/private or loopback/);
  });

  it("refuses a malformed URL", () => {
    expect(() => assertDeliverableUrl("not a url")).toThrow(/valid URL/);
  });
});

describe("retry schedule", () => {
  it("backs off strictly increasing, and MAX_ATTEMPTS matches the schedule", () => {
    for (let i = 1; i < RETRY_BACKOFF_MS.length; i++) {
      expect(RETRY_BACKOFF_MS[i]).toBeGreaterThan(RETRY_BACKOFF_MS[i - 1]);
    }
    expect(MAX_ATTEMPTS).toBe(RETRY_BACKOFF_MS.length + 1);
  });
});

describe("request hashing (spec §65)", () => {
  it("same body hashes the same, different body does not", () => {
    expect(hashRequestBody('{"a":1}')).toBe(hashRequestBody('{"a":1}'));
    expect(hashRequestBody('{"a":1}')).not.toBe(hashRequestBody('{"a":2}'));
  });

  it("is order-sensitive — {a,b} and {b,a} are different requests to a server", () => {
    expect(hashRequestBody('{"a":1,"b":2}')).not.toBe(hashRequestBody('{"b":2,"a":1}'));
  });
});
