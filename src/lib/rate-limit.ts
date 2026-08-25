/**
 * Rate limiting (spec §43 "Rate limiting", Day-1 requirement).
 *
 * Fixed-window counter held in process memory. Deliberate limits, stated
 * rather than hidden: this bounds one Node instance only. Behind more than
 * one instance an attacker gets N x the budget, so a shared store (Redis,
 * or an edge/WAF rule) has to replace `store` before horizontal scaling —
 * the interface below is what that swap targets. It is still worth having
 * now: it stops the single-instance credential-stuffing case completely,
 * and it makes the limits explicit and testable instead of theoretical.
 */

interface Window {
  count: number;
  resetAt: number;
}

const store = new Map<string, Window>();

/** Bounds memory if a flood of distinct keys arrives (e.g. spoofed IPs). */
const MAX_TRACKED_KEYS = 50_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
  /** Seconds a client should wait, for a Retry-After header. */
  retryAfterSeconds: number;
}

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

/** Login and MFA verification: strict, because these gate authentication. */
export const AUTH_RULE: RateLimitRule = { limit: 10, windowMs: 15 * 60 * 1000 };
/** Enrollment/verification by an already-authenticated user. */
export const MFA_ACTION_RULE: RateLimitRule = { limit: 20, windowMs: 15 * 60 * 1000 };

export function checkRateLimit(key: string, rule: RateLimitRule, nowMs: number = Date.now()): RateLimitResult {
  const existing = store.get(key);

  if (!existing || existing.resetAt <= nowMs) {
    if (store.size >= MAX_TRACKED_KEYS) {
      pruneExpired(nowMs);
      // Still full of live windows — every one of them is an active
      // limiter, so drop the oldest rather than stop limiting.
      if (store.size >= MAX_TRACKED_KEYS) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
    }
    const resetAt = nowMs + rule.windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: rule.limit - 1, resetAt, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= rule.limit;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - nowMs) / 1000),
  };
}

/** Called after a successful authentication so a legitimate user isn't punished. */
export function resetRateLimit(key: string): void {
  store.delete(key);
}

function pruneExpired(nowMs: number): void {
  for (const [key, window] of store) {
    if (window.resetAt <= nowMs) store.delete(key);
  }
}

/** Test-only: drop all windows so cases don't leak state into each other. */
export function __resetAllRateLimits(): void {
  store.clear();
}

/**
 * Client identity for rate-limit keys. `x-forwarded-for` is attacker-
 * controlled unless a trusted proxy sets it, so this is a best-effort
 * bucket, and every rule that uses it is paired with an identity-based key
 * (e.g. the submitted email) that an attacker cannot rotate freely.
 */
export function clientIpFromRequest(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() ?? "unknown";
}
