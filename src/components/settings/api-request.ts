/**
 * A JSON request to this app's API. Returns the envelope's data, or the
 * server's error message — which names what is wrong ("An organization needs
 * at least one Owner"), so it is shown as-is rather than replaced.
 */
export async function apiRequest(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; data?: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    const payload = (await res.json().catch(() => null)) as { data?: Record<string, unknown>; error?: unknown } | null;
    if (!res.ok) {
      return { ok: false, error: typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})` };
    }
    return { ok: true, data: payload?.data ?? undefined };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}
