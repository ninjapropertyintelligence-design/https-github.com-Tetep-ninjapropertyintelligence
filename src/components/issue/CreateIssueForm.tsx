"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiFetch, ApiClientError } from "@/lib/api-client";

export function CreateIssueForm({ properties }: { properties: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const issue = await apiFetch<{ id: string }>("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          title,
          description: description || undefined,
          severity,
          estimatedCost: estimatedCost ? Math.round(Number(estimatedCost) * 100) : undefined,
        }),
      });
      router.push(`/issues/${issue.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to create issue");
    } finally {
      setLoading(false);
    }
  }

  if (properties.length === 0) {
    return <p className="text-sm text-muted">You don&apos;t have access to any properties to create an issue on.</p>;
  }

  return (
    <form onSubmit={submit} className="max-w-lg space-y-4">
      <div>
        <label className="block text-xs font-medium text-muted">Property</label>
        <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm">
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-muted">Title</label>
        <input required value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand" />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted">Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted">Severity</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm">
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted">Estimated cost ($)</label>
          <input type="number" min={0} value={estimatedCost} onChange={(e) => setEstimatedCost(e.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand" />
        </div>
      </div>
      {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
      <Button type="submit" disabled={loading}>
        {loading ? "Creating..." : "Create Issue"}
      </Button>
    </form>
  );
}
