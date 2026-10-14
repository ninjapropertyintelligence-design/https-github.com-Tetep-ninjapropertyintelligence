"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";

interface PropertyOption {
  id: string;
  label: string;
  region: string | null;
}

const DELIVERABLES = [
  { value: "DRONE", label: "Drone imagery" },
  { value: "IMAGE_360", label: "360° photos" },
  { value: "MATTERPORT", label: "Matterport scan" },
  { value: "PHOTOS", label: "Photos" },
  { value: "CONDITION_SCORES", label: "Condition scores" },
] as const;

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand";

/**
 * The platform team ordering capture work on one customer's sites.
 *
 * "Send to vendor" saves and issues in one step — issuing is what gives the
 * vendor access to the sites. "Save draft" keeps it to the platform team, so
 * a job can be assembled (and its route pinned) before anyone is sent.
 */
export function NewCaptureJobForm({
  organizationId,
  properties,
  vendors,
}: {
  organizationId: string;
  properties: PropertyOption[];
  vendors: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [deliverables, setDeliverables] = useState<string[]>(["PHOTOS", "CONDITION_SCORES"]);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [route, setRoute] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter((p) => `${p.label} ${p.region ?? ""}`.toLowerCase().includes(q));
  }, [filter, properties]);

  function toggle(list: string[], id: string, on: boolean) {
    return on ? [...list, id] : list.filter((x) => x !== id);
  }

  async function save(e: FormEvent, issue: boolean) {
    e.preventDefault();
    setError(null);
    if (!vendorId) {
      setError("Choose a vendor for this job.");
      return;
    }
    setBusy(true);
    try {
      // One position per line. Order is the walking order on site.
      const shots = route
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((label) => ({ label }));
      const res = await fetch("/api/v1/admin/capture-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          title,
          vendorId: vendorId || null,
          instructions: instructions || null,
          dueDate: dueDate || null,
          propertyIds,
          deliverables,
          shots: shots.length ? shots : undefined,
          issue,
        }),
      });
      const payload = (await res.json().catch(() => null)) as { data?: { id?: string }; error?: unknown } | null;
      if (!res.ok || !payload?.data?.id) {
        setError(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`);
        return;
      }
      router.push(`/capture-jobs/${payload.data.id}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const ready = title.trim() && vendorId && propertyIds.length > 0 && deliverables.length > 0;

  return (
    <form onSubmit={(e) => save(e, true)} className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block text-xs font-medium text-muted md:col-span-2">
          Job title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Q4 roof and parking sweep — Midwest"
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="block text-xs font-medium text-muted">
          Vendor
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={`mt-1 ${inputClass}`}>
            {vendors.length === 0 ? <option value="">No vendors yet</option> : null}
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          {vendors.length === 0 ? (
            <span className="mt-1 block font-normal">No vendors for this customer yet — add one on the Vendors page.</span>
          ) : null}
        </label>
        <label className="block text-xs font-medium text-muted">
          Due date (optional)
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`mt-1 ${inputClass}`} />
        </label>
      </div>

      <fieldset>
        <legend className="text-xs font-medium text-muted">What the vendor must deliver at every site</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {DELIVERABLES.map((d) => (
            <label
              key={d.value}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground"
            >
              <input
                type="checkbox"
                checked={deliverables.includes(d.value)}
                onChange={(e) => setDeliverables((list) => toggle(list, d.value, e.target.checked))}
              />
              {d.label}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">
          Condition scores are what move a property&apos;s health score; imagery alone does not.
        </p>
      </fieldset>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="text-xs font-medium text-muted">
            Sites ({propertyIds.length} of {properties.length} selected)
          </p>
          <div className="flex items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, city or region"
              className="w-56 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-brand"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPropertyIds((ids) => [...new Set([...ids, ...visible.map((p) => p.id)])])}
            >
              Select shown
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPropertyIds([])}>
              Clear
            </Button>
          </div>
        </div>
        <div className="mt-1.5 max-h-72 overflow-y-auto rounded-lg border border-border">
          {visible.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">No sites match.</p>
          ) : (
            visible.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-sm text-foreground last:border-0"
              >
                <input
                  type="checkbox"
                  checked={propertyIds.includes(p.id)}
                  onChange={(e) => setPropertyIds((ids) => toggle(ids, p.id, e.target.checked))}
                />
                <span className="min-w-0 truncate">{p.label}</span>
                {p.region ? <span className="ml-auto shrink-0 text-xs text-muted">{p.region}</span> : null}
              </label>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block text-xs font-medium text-muted">
          Instructions for the vendor (optional)
          <textarea
            rows={5}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="block text-xs font-medium text-muted">
          Shot route (optional) — one position per line, in walking order
          <textarea
            rows={5}
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            placeholder={"North entrance\nLoading dock\nRoof — RTU row"}
            className={`mt-1 ${inputClass}`}
          />
        </label>
      </div>

      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !ready}>
          {busy ? "Saving…" : "Send to vendor"}
        </Button>
        <Button type="button" variant="secondary" disabled={busy || !ready} onClick={(e) => save(e, false)}>
          Save draft
        </Button>
      </div>
    </form>
  );
}
