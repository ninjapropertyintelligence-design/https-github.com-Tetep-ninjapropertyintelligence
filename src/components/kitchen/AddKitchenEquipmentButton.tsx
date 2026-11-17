"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

/** Adds the restaurant kitchen equipment catalog to a property's assets. */
export function AddKitchenEquipmentButton({ propertyId, hasKitchen }: { propertyId: string; hasKitchen: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant={hasKitchen ? "secondary" : "primary"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          const res = await apiRequest(`/api/v1/properties/${propertyId}/kitchen-equipment`, { method: "POST" });
          setBusy(false);
          if (!res.ok) {
            setMessage({ tone: "error", text: res.error });
            return;
          }
          const created = Number(res.data?.created ?? 0);
          setMessage({
            tone: "ok",
            text: created > 0 ? `Added ${created} pieces of kitchen equipment` : "All kitchen equipment is already listed",
          });
          router.refresh();
        }}
      >
        {busy ? "Adding…" : hasKitchen ? "Add missing kitchen equipment" : "Add restaurant kitchen equipment"}
      </Button>
      {message ? (
        <span className={`text-xs ${message.tone === "error" ? "text-[var(--band-critical)]" : "text-muted"}`}>{message.text}</span>
      ) : null}
    </span>
  );
}
