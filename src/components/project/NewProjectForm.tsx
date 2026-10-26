"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

const INPUT = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand";

export function NewProjectForm({
  properties,
  programs,
  defaultPropertyId,
}: {
  properties: Array<{ id: string; name: string }>;
  programs: Array<{ id: string; name: string }>;
  defaultPropertyId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProgram, setNewProgram] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    let programId = String(form.get("programId") || "") || null;
    if (programId === "__new") {
      const created = await apiRequest("/api/v1/programs", { method: "POST", body: JSON.stringify({ name: newProgram }) });
      if (!created.ok) {
        setBusy(false);
        setError(created.error);
        return;
      }
      programId = String(created.data?.id);
    }
    const res = await apiRequest("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        propertyId: form.get("propertyId"),
        name: form.get("name"),
        programId,
        projectType: form.get("projectType") || null,
        startDate: form.get("startDate") || null,
        endDate: form.get("endDate") || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/projects/${res.data?.id}`);
  }

  if (!open) return <Button onClick={() => setOpen(true)}>New project</Button>;

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Name</span>
          <input name="name" required maxLength={200} className={INPUT} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Property</span>
          <select name="propertyId" required defaultValue={defaultPropertyId ?? ""} className={INPUT}>
            <option value="" disabled>
              Choose a property
            </option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Program</span>
          <select name="programId" defaultValue="" className={INPUT} onChange={(e) => e.target.value !== "__new" && setNewProgram("")}>
            <option value="">No program</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="__new">New program…</option>
          </select>
          <input
            placeholder="New program name (when chosen above)"
            value={newProgram}
            onChange={(e) => setNewProgram(e.target.value)}
            className={`${INPUT} mt-1`}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Type</span>
          <input name="projectType" placeholder="e.g. Full Capture" maxLength={100} className={INPUT} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Starts</span>
          <input type="date" name="startDate" className={INPUT} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Ends</span>
          <input type="date" name="endDate" className={INPUT} />
        </label>
      </div>
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Creating..." : "Create project"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
