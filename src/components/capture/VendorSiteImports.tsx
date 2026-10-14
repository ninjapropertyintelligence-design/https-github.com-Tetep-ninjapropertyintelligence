"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";

interface DroneMap {
  id: string;
  name: string | null;
  createdAt: string | null;
  distanceMeters: number | null;
  imported: boolean;
}

interface DroneImportRow {
  id: string;
  planName: string | null;
  status: string;
  errorMessage: string | null;
  exports: Array<{ layer: string; status: string; errorMessage: string | null }>;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  const payload = (await res.json().catch(() => null)) as { data?: T; error?: unknown } | null;
  if (!res.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`);
  return payload?.data as T;
}

function distanceLabel(m: number | null) {
  if (m === null) return "no location";
  return m < 1000 ? `${m} m from the site` : `${(m / 1000).toFixed(1)} km from the site`;
}

/**
 * Bringing work in from the vendor's own accounts, on one job site: a
 * DroneDeploy flight (copied in, nearest flights first) and a Matterport scan.
 * Both are held for the platform team's approval like an upload.
 */
export function VendorSiteImports({
  jobId,
  siteId,
  deliverables,
  connected,
}: {
  jobId: string;
  siteId: string;
  deliverables: string[];
  connected: { DRONEDEPLOY: boolean; MATTERPORT: boolean };
}) {
  const wantsDrone = deliverables.includes("DRONE");
  const wantsMatterport = deliverables.includes("MATTERPORT");
  if (!wantsDrone && !wantsMatterport) return null;

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">From your connected accounts</p>
      {wantsDrone ? <DroneDeployPicker jobId={jobId} siteId={siteId} connected={connected.DRONEDEPLOY} /> : null}
      {wantsMatterport ? <MatterportPicker jobId={jobId} siteId={siteId} connected={connected.MATTERPORT} /> : null}
    </div>
  );
}

function NotConnected({ name }: { name: string }) {
  return (
    <p className="text-sm text-muted">
      {name} is not connected.{" "}
      <Link href="/settings/connections" className="font-medium text-brand hover:underline">
        Connect your account →
      </Link>
    </p>
  );
}

function DroneDeployPicker({ jobId, siteId, connected }: { jobId: string; siteId: string; connected: boolean }) {
  const router = useRouter();
  const base = `/api/v1/capture-jobs/${jobId}/sites/${siteId}/dronedeploy`;
  const [maps, setMaps] = useState<DroneMap[] | null>(null);
  const [imports, setImports] = useState<DroneImportRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!connected) return <NotConnected name="DroneDeploy" />;

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">DroneDeploy flight</span>
        <Button
          type="button"
          variant="secondary"
          disabled={busy !== null}
          onClick={() =>
            run("maps", async () => {
              const [m, i] = await Promise.all([call<{ items: DroneMap[] }>(`${base}?view=maps`), call<{ items: DroneImportRow[] }>(base)]);
              setMaps(m.items);
              setImports(i.items);
            })
          }
        >
          {busy === "maps" ? "Loading…" : maps ? "Reload my flights" : "Choose from my DroneDeploy flights"}
        </Button>
        {imports && imports.some((i) => i.status === "IMPORTING") ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy !== null}
            onClick={() =>
              run("refresh", async () => {
                const r = await call<{ items: DroneImportRow[] }>(base, { method: "POST", body: JSON.stringify({ action: "refresh" }) });
                setImports(r.items);
                router.refresh();
              })
            }
          >
            {busy === "refresh" ? "Checking…" : "Check progress"}
          </Button>
        ) : null}
      </div>

      {imports && imports.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {imports.map((i) => (
            <li key={i.id} className="text-foreground">
              {i.planName ?? "Flight"} —{" "}
              <span className={i.status === "FAILED" ? "text-[var(--band-critical)]" : "text-muted"}>
                {i.status === "IMPORTING"
                  ? "DroneDeploy is preparing the map; it is copied in automatically (or press Check progress)"
                  : i.status === "IMPORTED"
                    ? "map copied in"
                    : (i.errorMessage ?? i.status.toLowerCase())}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {maps ? (
        maps.length === 0 ? (
          <p className="text-sm text-muted">No maps in your DroneDeploy account yet.</p>
        ) : (
          <ul className="max-h-60 overflow-y-auto rounded-lg border border-border bg-surface">
            {maps.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-foreground">{m.name ?? "Untitled map"}</p>
                  <p className="text-xs text-muted">
                    {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "undated"} · {distanceLabel(m.distanceMeters)}
                  </p>
                </div>
                {m.imported ? (
                  <span className="shrink-0 text-xs text-muted">Already brought in</span>
                ) : (
                  <Button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      run(`import-${m.id}`, async () => {
                        const r = await call<{ items: DroneImportRow[] }>(base, {
                          method: "POST",
                          body: JSON.stringify({ action: "import", planId: m.id }),
                        });
                        setImports(r.items);
                        setMaps((list) => list?.map((x) => (x.id === m.id ? { ...x, imported: true } : x)) ?? null);
                        router.refresh();
                      })
                    }
                  >
                    {busy === `import-${m.id}` ? "Importing…" : "Use this flight"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
    </div>
  );
}

function MatterportPicker({ jobId, siteId, connected }: { jobId: string; siteId: string; connected: boolean }) {
  const router = useRouter();
  const [spaces, setSpaces] = useState<Array<{ id: string; name: string | null }> | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!connected) return <NotConnected name="Matterport" />;

  async function load(e?: FormEvent) {
    e?.preventDefault();
    setBusy("load");
    setError(null);
    try {
      setSpaces((await call<{ items: Array<{ id: string; name: string | null }> }>("/api/v1/vendor/matterport-spaces")).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your scans.");
    } finally {
      setBusy(null);
    }
  }

  async function link(space: { id: string; name: string | null }) {
    setBusy(space.id);
    setError(null);
    setNotice(null);
    try {
      await call(`/api/v1/capture-jobs/${jobId}/sites/${siteId}/matterport`, {
        method: "POST",
        body: JSON.stringify({ spaceId: space.id }),
      });
      setNotice(`${space.name ?? space.id} added to this site.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that scan.");
    } finally {
      setBusy(null);
    }
  }

  const shown = (spaces ?? []).filter((s) => `${s.name ?? ""} ${s.id}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">Matterport scan</span>
        <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => load()}>
          {busy === "load" ? "Loading…" : spaces ? "Reload my scans" : "Choose from my Matterport scans"}
        </Button>
        {spaces && spaces.length > 8 ? (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter scans"
            className="w-48 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-brand"
          />
        ) : null}
      </div>
      {spaces ? (
        shown.length === 0 ? (
          <p className="text-sm text-muted">No scans found in your Matterport account.</p>
        ) : (
          <ul className="max-h-60 overflow-y-auto rounded-lg border border-border bg-surface">
            {shown.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
                <span className="min-w-0 truncate text-foreground">{s.name ?? s.id}</span>
                <Button type="button" disabled={busy !== null} onClick={() => link(s)}>
                  {busy === s.id ? "Adding…" : "Use this scan"}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {notice ? <p className="text-sm text-[var(--band-good)]">{notice}</p> : null}
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
    </div>
  );
}
