"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

export function TemplateActiveToggle({ templateId, isActive }: { templateId: string; isActive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await apiRequest(`/api/v1/assessments/templates/${templateId}`, {
            method: "PATCH",
            body: JSON.stringify({ isActive: !isActive }),
          });
          setBusy(false);
          if (res.ok) router.refresh();
          else setError(res.error);
        }}
      >
        {isActive ? "Retire" : "Reactivate"}
      </Button>
      {error ? <span className="text-xs text-[var(--band-critical)]">{error}</span> : null}
    </span>
  );
}
