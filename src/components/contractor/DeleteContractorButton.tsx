"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

export function DeleteContractorButton({ contractorId, name }: { contractorId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="danger"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(`Delete ${name}? Equipment it serviced will have no contractor.`)) return;
          setBusy(true);
          setError(null);
          const res = await apiRequest(`/api/v1/vendors/${contractorId}`, { method: "DELETE" });
          setBusy(false);
          if (res.ok) router.push("/contractors");
          else setError(res.error);
        }}
      >
        Delete
      </Button>
      {error ? <span className="text-xs text-[var(--band-critical)]">{error}</span> : null}
    </span>
  );
}
