"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";

interface PropertyOption {
  id: string;
  label: string;
  region: string | null;
}

interface PortfolioOption {
  id: string;
  name: string;
  regions: Array<{ id: string; name: string }>;
}

/** One thing the vendor must capture at every site, in walking order. */
interface Requirement {
  key: string;
  label: string;
  kind: "PHOTO" | "IMAGE_360";
  required: boolean;
  notes: string;
}

const DELIVERABLES = [
  { value: "PHOTOS", label: "Photos" },
  { value: "IMAGE_360", label: "360° photos" },
  { value: "DRONE", label: "Drone imagery" },
  { value: "MATTERPORT", label: "Matterport scan" },
  { value: "CONDITION_SCORES", label: "Condition scores" },
] as const;

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand";

let nextKey = 0;
function newRequirement(label = "", kind: Requirement["kind"] = "PHOTO"): Requirement {
  nextKey += 1;
  return { key: `r${nextKey}`, label, kind, required: true, notes: "" };
}

function siteLabel(p: { name: string; city: string | null; state: string | null }) {
  return [p.name, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" — ");
}

/**
 * The platform team ordering capture work on one customer's sites.
 *
 * Everything the vendor needs is set here: the sites (including a new one
 * the customer does not have yet), what to deliver, the specific shots to
 * take, instructions and a due date. "Send to vendor" saves and issues in one
 * step — issuing is what gives the vendor access to the sites. "Save draft"
 * keeps it to the platform team.
 */
export function NewCaptureJobForm({
  organizationId,
  properties,
  vendors,
  portfolios,
}: {
  organizationId: string;
  properties: PropertyOption[];
  vendors: Array<{ id: string; label: string }>;
  portfolios: PortfolioOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [deliverables, setDeliverables] = useState<string[]>(["PHOTOS", "CONDITION_SCORES"]);
  const [sites, setSites] = useState<PropertyOption[]>(properties);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter((p) => `${p.label} ${p.region ?? ""}`.toLowerCase().includes(q));
  }, [filter, sites]);

  function toggle(list: string[], id: string, on: boolean) {
    return on ? [...list, id] : list.filter((x) => x !== id);
  }

  function updateRequirement(key: string, patch: Partial<Requirement>) {
    setRequirements((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function moveRequirement(key: string, by: -1 | 1) {
    setRequirements((list) => {
      const i = list.findIndex((r) => r.key === key);
      const j = i + by;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  async function save(e: FormEvent, issue: boolean) {
    e.preventDefault();
    setError(null);
    if (!vendorId) {
      setError("Choose a vendor for this job.");
      return;
    }
    if (requirements.some((r) => !r.label.trim())) {
      setError("Every requirement needs a name, or remove the empty one.");
      return;
    }
    setBusy(true);
    try {
      const shots = requirements.map((r) => ({
        label: r.label.trim(),
        kind: r.kind,
        required: r.required,
        notes: r.notes.trim() || undefined,
      }));
      const res = await fetch("/api/v1/admin/capture-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          title,
          vendorId,
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
    <form onSubmit={(e) => save(e, true)} className="space-y-6">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Sites <span className="font-normal text-muted">({propertyIds.length} of {sites.length} selected)</span>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
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
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border">
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
        <NewSiteForm
          organizationId={organizationId}
          portfolios={portfolios}
          onCreated={(site) => {
            setSites((list) => [...list, site].sort((a, b) => a.label.localeCompare(b.label)));
            setPropertyIds((ids) => [...ids, site.id]);
            setFilter("");
          }}
        />
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Requirements</h3>

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
            Condition scores are what move a property&apos;s health score; imagery alone does not. The vendor cannot
            submit a site until every item here is delivered.
          </p>
        </fieldset>

        <div>
          <p className="text-xs font-medium text-muted">Specific shots to capture at every site (optional, in walking order)</p>
          {requirements.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted">
              None yet. Add the exact positions the vendor must shoot — the site cannot be submitted until each
              required one is captured.
            </p>
          ) : (
            <ol className="mt-1.5 space-y-2">
              {requirements.map((r, index) => (
                <li key={r.key} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 text-center text-xs font-semibold text-muted">{index + 1}</span>
                    <input
                      aria-label={`Requirement ${index + 1}`}
                      value={r.label}
                      onChange={(e) => updateRequirement(r.key, { label: e.target.value })}
                      placeholder="e.g. Roof — RTU row"
                      className={`min-w-[12rem] flex-1 ${inputClass}`}
                    />
                    <select
                      aria-label={`Type for requirement ${index + 1}`}
                      value={r.kind}
                      onChange={(e) => updateRequirement(r.key, { kind: e.target.value as Requirement["kind"] })}
                      className="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-foreground"
                    >
                      <option value="PHOTO">Photo</option>
                      <option value="IMAGE_360">360° photo</option>
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={r.required}
                        onChange={(e) => updateRequirement(r.key, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    <div className="ml-auto flex gap-1">
                      <Button type="button" variant="ghost" aria-label="Move up" onClick={() => moveRequirement(r.key, -1)}>
                        ↑
                      </Button>
                      <Button type="button" variant="ghost" aria-label="Move down" onClick={() => moveRequirement(r.key, 1)}>
                        ↓
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Remove requirement ${index + 1}`}
                        onClick={() => setRequirements((list) => list.filter((x) => x.key !== r.key))}
                      >
                        ✕
                      </Button>
                    </div>
                  </div>
                  <input
                    aria-label={`Notes for requirement ${index + 1}`}
                    value={r.notes}
                    onChange={(e) => updateRequirement(r.key, { notes: e.target.value })}
                    placeholder="Notes for the vendor (optional) — e.g. include the unit's data plate"
                    className={`mt-2 ${inputClass}`}
                  />
                </li>
              ))}
            </ol>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setRequirements((list) => [...list, newRequirement()])}>
              + Add requirement
            </Button>
            {requirements.length === 0 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setRequirements([
                    newRequirement("North entrance", "IMAGE_360"),
                    newRequirement("Main entrance", "IMAGE_360"),
                    newRequirement("Parking lot", "PHOTO"),
                    newRequirement("Roof — RTU row", "PHOTO"),
                    newRequirement("Roof — membrane", "PHOTO"),
                  ])
                }
              >
                Start from a standard site route
              </Button>
            ) : null}
          </div>
        </div>

        <label className="block text-xs font-medium text-muted">
          Instructions for the vendor (optional)
          <textarea
            rows={4}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Access, safety, who to call on site, anything else they need to know"
            className={`mt-1 ${inputClass}`}
          />
        </label>
      </section>

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

/**
 * Adds a site the customer does not have yet. It is created in the customer's
 * account — the same as if they had added it — and ticked for this job.
 */
function NewSiteForm({
  organizationId,
  portfolios,
  onCreated,
}: {
  organizationId: string;
  portfolios: PortfolioOption[];
  onCreated: (site: PropertyOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [customerPropertyId, setCustomerPropertyId] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [portfolioId, setPortfolioId] = useState(portfolios[0]?.id ?? "");
  const [regionId, setRegionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const regions = portfolios.find((p) => p.id === portfolioId)?.regions ?? [];

  // Not a nested <form>: this sits inside the job form, and a nested form is
  // invalid HTML that would submit the job.
  async function add() {
    setError(null);
    setNotice(null);
    if (!name.trim() || !addressLine1.trim() || !city.trim() || !state.trim() || !postalCode.trim()) {
      setError("Enter the site name and its full address.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/admin/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          name: name.trim(),
          customerPropertyId: customerPropertyId.trim() || null,
          addressLine1: addressLine1.trim(),
          city: city.trim(),
          state: state.trim(),
          postalCode: postalCode.trim(),
          portfolioId,
          regionId: regionId || null,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { data?: { id: string; name: string; city: string | null; state: string | null }; error?: unknown }
        | null;
      if (!res.ok || !payload?.data) {
        setError(typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`);
        return;
      }
      onCreated({
        id: payload.data.id,
        label: siteLabel(payload.data),
        region: regions.find((r) => r.id === regionId)?.name ?? null,
      });
      setNotice(`${payload.data.name} added to the customer and selected for this job.`);
      setName("");
      setCustomerPropertyId("");
      setAddressLine1("");
      setCity("");
      setState("");
      setPostalCode("");
      setOpen(false);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (portfolios.length === 0) {
    return <p className="mt-2 text-xs text-muted">This customer has no portfolio yet, so new sites cannot be added here.</p>;
  }

  return (
    <div className="mt-2 space-y-2">
      {notice ? <p className="text-sm text-[var(--band-good)]">{notice}</p> : null}
      {open ? (
        <div className="space-y-3 rounded-lg border border-border bg-background p-3">
          <p className="text-sm font-medium text-foreground">Add a new site</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-muted">
              Site name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Store #1200" className={`mt-1 ${inputClass}`} />
            </label>
            <label className="block text-xs font-medium text-muted">
              Customer&apos;s site ID (optional)
              <input
                value={customerPropertyId}
                onChange={(e) => setCustomerPropertyId(e.target.value)}
                placeholder="e.g. STORE-1200"
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <label className="block text-xs font-medium text-muted sm:col-span-2">
              Street address
              <input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} className={`mt-1 ${inputClass}`} />
            </label>
            <label className="block text-xs font-medium text-muted">
              City
              <input value={city} onChange={(e) => setCity(e.target.value)} className={`mt-1 ${inputClass}`} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-muted">
                State
                <input value={state} onChange={(e) => setState(e.target.value)} placeholder="MO" className={`mt-1 ${inputClass}`} />
              </label>
              <label className="block text-xs font-medium text-muted">
                ZIP code
                <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className={`mt-1 ${inputClass}`} />
              </label>
            </div>
            {portfolios.length > 1 ? (
              <label className="block text-xs font-medium text-muted">
                Portfolio
                <select
                  value={portfolioId}
                  onChange={(e) => {
                    setPortfolioId(e.target.value);
                    setRegionId("");
                  }}
                  className={`mt-1 ${inputClass}`}
                >
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {regions.length > 0 ? (
              <label className="block text-xs font-medium text-muted">
                Region (optional)
                <select value={regionId} onChange={(e) => setRegionId(e.target.value)} className={`mt-1 ${inputClass}`}>
                  <option value="">No region</option>
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <p className="text-xs text-muted">
            The site is added to the customer&apos;s account, the same as if they had added it, and its address is
            placed on the map.
          </p>
          {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={add}>
              {busy ? "Adding…" : "Add site"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          + Add a new site
        </Button>
      )}
    </div>
  );
}
