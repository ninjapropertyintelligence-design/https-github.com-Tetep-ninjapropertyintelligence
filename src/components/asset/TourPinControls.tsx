"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

/** Pins equipment to a spot in the 3D tour, from a Matterport link copied while standing there. */
export function TourPinForm({ assetId }: { assetId: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await apiRequest(`/api/v1/assets/${assetId}/tour-pin`, { method: "POST", body: JSON.stringify({ url, label }) });
        setBusy(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setUrl("");
        setLabel("");
        router.refresh();
      }}
    >
      <p className="text-xs text-muted">Open the 3D tour, stand where this equipment is, copy the link from your browser and paste it here.</p>
      <div className="flex flex-wrap gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://my.matterport.com/show/?m=…&ss=…" className="min-w-64 flex-1 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="w-44 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand" />
        <Button type="submit" variant="secondary" disabled={busy || !url.trim()}>
          {busy ? "Pinning…" : "Pin to tour"}
        </Button>
      </div>
      {error ? <p className="text-xs text-[var(--band-critical)]">{error}</p> : null}
    </form>
  );
}

export function RemovePinButton({ assetId, pinId }: { assetId: string; pinId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await apiRequest(`/api/v1/assets/${assetId}/tour-pin?pinId=${encodeURIComponent(pinId)}`, { method: "DELETE" });
        setBusy(false);
        router.refresh();
      }}
    >
      Remove
    </Button>
  );
}
