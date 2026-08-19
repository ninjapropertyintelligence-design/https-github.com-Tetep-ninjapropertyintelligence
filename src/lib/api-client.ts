"use client";

/**
 * Client-side counterpart to `withApiHandler`'s `{data, error, meta}`
 * envelope (spec §63) — every fetch against this app's own `/api/v1/*`
 * routes should go through this instead of raw `fetch().then(r =>
 * r.json())`, so the envelope only needs to be unwrapped in one place.
 *
 * Throws with the server's `error` message on a non-2xx response or a
 * malformed body; otherwise resolves to `data` directly (not the whole
 * envelope) so call sites read fields the same way they did before the
 * envelope existed.
 */
export class ApiClientError extends Error {}

export async function apiFetch<T = unknown>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in body ? (body as { error?: string }).error : null;
    throw new ApiClientError(message || `Request failed (${res.status})`);
  }
  if (!body || typeof body !== "object" || !("data" in body)) {
    throw new ApiClientError("Malformed response from server");
  }
  return (body as { data: T }).data;
}
