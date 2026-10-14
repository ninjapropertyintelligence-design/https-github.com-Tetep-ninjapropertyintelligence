/**
 * Replace every BigInt in a value with a Number.
 *
 * Prisma returns BigInt for 64-bit columns (`sizeBytes` — widened because a
 * 32-bit int caps a single stored object at 2.147 GB, which drone point
 * clouds routinely exceed), and `JSON.stringify` THROWS on a BigInt rather
 * than coercing it. Without this, any route returning one of those rows would
 * 500, and the idempotency store — which persists the response envelope as
 * JSON — would fail its write too.
 *
 * TypeScript cannot catch this: the throw is a runtime property of the value,
 * and the types say `bigint` is perfectly fine to put in an object.
 *
 * Number is exact for integers up to 2^53 — about 9 petabytes measured in
 * bytes — so no byte count this system will ever hold loses precision.
 *
 * Lives in its own module with no imports so it can be unit-tested without
 * dragging in the auth stack.
 */
export function normalizeBigInts(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(normalizeBigInts);
  if (value !== null && typeof value === "object") {
    // Dates (and other class instances) pass through untouched — walking
    // their properties would flatten a Date into a plain object.
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeBigInts(v);
    return out;
  }
  return value;
}

/**
 * Teach JSON.stringify how to serialise a BigInt, globally.
 *
 * `normalizeBigInts` above only protects the one envelope in
 * `withApiHandler`. That is not enough: `withApiHandler` deliberately lets a
 * route return a `NextResponse` it built itself (for a 201, say), and
 * `NextResponse.json()` runs `JSON.stringify` INSIDE the route — throwing
 * "Do not know how to serialize a BigInt" before the wrapper ever sees the
 * value. Of ~53 such routes, 5 currently return rows carrying a `sizeBytes`,
 * and nothing stops the next one from doing the same: the failure is a
 * runtime property of the value, so TypeScript cannot warn about it and it
 * surfaces only as a 500 in production.
 *
 * Patching the prototype is a blunt instrument, chosen because the
 * alternative is a rule every future route has to remember.
 *
 * Numbers are returned when — and only when — the value is a safe integer.
 * Beyond 2^53 a Number would silently lose precision, so those fall back to a
 * string: exact when it can be, visibly a string when it cannot, never
 * quietly wrong. Byte counts stay numeric to ~9 petabytes.
 */
export function installBigIntJson(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => number | string };
  if (proto.toJSON) return;
  proto.toJSON = function (this: bigint) {
    const asNumber = Number(this);
    return Number.isSafeInteger(asNumber) ? asNumber : this.toString();
  };
}
