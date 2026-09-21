import { describe, expect, it } from "vitest";
import { installBigIntJson, normalizeBigInts as normalize } from "@/lib/json-safe";

/**
 * A BigInt reaching JSON.stringify throws outright — it does not coerce, and
 * TypeScript cannot see it because the failure is a runtime property of the
 * value. Every sizeBytes column is a BigInt (a 32-bit int caps one stored
 * object at 2.147 GB), so without normalisation any route returning a drone
 * image, document version or evidence row would 500.
 */
/**
 * Runs `fn` with the global BigInt JSON patch removed.
 *
 * Two assertions below are about the behaviour the patch EXISTS to fix, so
 * they have to observe the unpatched state. Without this they would pass or
 * fail purely on whether some other module had already imported the installer
 * — an order dependency that would eventually flip silently.
 */
function withoutBigIntJson(fn: () => void): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => unknown };
  const saved = proto.toJSON;
  delete proto.toJSON;
  try {
    fn();
  } finally {
    if (saved) proto.toJSON = saved;
  }
}

describe("BigInt response normalisation", () => {
  it("is guarding against a real throw, not a hypothetical one", () => {
    withoutBigIntJson(() => {
      expect(() => JSON.stringify({ sizeBytes: BigInt(5) })).toThrow(/BigInt/);
    });
  });

  it("converts a BigInt to a Number", () => {
    expect(normalize({ sizeBytes: BigInt(5_000_000_000) })).toEqual({ sizeBytes: 5_000_000_000 });
  });

  it("makes a previously unserialisable envelope serialisable", () => {
    const envelope = { data: { items: [{ sizeBytes: BigInt(9) }] }, error: null, meta: {} };
    withoutBigIntJson(() => {
      expect(() => JSON.stringify(envelope)).toThrow();
    });
    expect(JSON.stringify(normalize(envelope))).toBe(
      '{"data":{"items":[{"sizeBytes":9}]},"error":null,"meta":{}}',
    );
  });

  it("reaches BigInts nested in arrays and objects", () => {
    expect(normalize({ a: [{ b: { c: BigInt(1) } }] })).toEqual({ a: [{ b: { c: 1 } }] });
  });

  it("leaves a Date intact rather than flattening it to a plain object", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    const out = normalize({ at: date }) as { at: Date };
    expect(out.at).toBeInstanceOf(Date);
    expect(out.at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("leaves null, undefined and ordinary values alone", () => {
    expect(normalize({ a: null, b: undefined, c: "s", d: 1, e: false })).toEqual({
      a: null, b: undefined, c: "s", d: 1, e: false,
    });
  });

  it("keeps a byte count exact at sizes far past a 32-bit column", () => {
    // 9 TB — the size that motivated widening the column in the first place.
    const bytes = BigInt(9_000_000_000_000);
    expect(normalize({ sizeBytes: bytes })).toEqual({ sizeBytes: 9_000_000_000_000 });
  });
});

describe("installBigIntJson", () => {
  it("makes JSON.stringify accept a BigInt instead of throwing", () => {
    installBigIntJson();
    expect(JSON.stringify({ sizeBytes: BigInt(5_000_000_000) })).toBe('{"sizeBytes":5000000000}');
  });

  it("falls back to a string past 2^53 rather than silently losing precision", () => {
    installBigIntJson();
    // 2^53 + 1 is not representable as a Number; returning one would be a
    // quietly wrong answer, so it is serialised as a string instead.
    const unsafe = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(2);
    expect(JSON.stringify({ n: unsafe })).toBe('{"n":"9007199254740993"}');
  });

  it("is idempotent, so importing it twice cannot double-wrap", () => {
    installBigIntJson();
    installBigIntJson();
    expect(JSON.stringify({ n: BigInt(7) })).toBe('{"n":7}');
  });
});
