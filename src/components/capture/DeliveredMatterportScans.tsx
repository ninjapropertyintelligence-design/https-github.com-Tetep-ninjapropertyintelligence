"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export interface DeliveredMatterportScan {
  id: string;
  externalSpaceId: string;
  name: string | null;
  operator: string | null;
  linkedAt: string;
  embedUrl: string | null;
}

/**
 * Matterport scans delivered on a job site. The scan itself stays on
 * Matterport, so this shows the space in Matterport's own viewer — enough for
 * the vendor to see what they handed over, and for the platform team to walk
 * it before approving.
 */
export function DeliveredMatterportScans({ scans }: { scans: DeliveredMatterportScan[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (scans.length === 0) return null;

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Matterport scans delivered</p>
      {scans.map((scan) => (
        <div key={scan.id} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-foreground">
              {scan.name ?? `Space ${scan.externalSpaceId}`}
              <span className="ml-2 text-xs text-muted">
                {scan.operator ? `${scan.operator} · ` : ""}
                {scan.linkedAt}
              </span>
            </p>
            <div className="flex items-center gap-2">
              {scan.embedUrl ? (
                <Button type="button" variant="secondary" onClick={() => setOpen(open === scan.id ? null : scan.id)}>
                  {open === scan.id ? "Hide tour" : "View tour"}
                </Button>
              ) : null}
              <a
                href={`https://my.matterport.com/show/?m=${encodeURIComponent(scan.externalSpaceId)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-brand hover:underline"
              >
                Open in Matterport ↗
              </a>
            </div>
          </div>
          {open === scan.id && scan.embedUrl ? (
            <iframe
              src={scan.embedUrl}
              title={scan.name ?? `Matterport space ${scan.externalSpaceId}`}
              className="h-96 w-full rounded-lg border border-border"
              allow="xr-spatial-tracking"
              allowFullScreen
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
