export function formatCents(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (Math.abs(dollars) >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars.toFixed(0)}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatRelativeTime(value: string | Date): string {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return formatDate(date);
}

export function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    "property.created": "Property created",
    "property.updated": "Property updated",
    "capture.created": "Capture created",
    "capture.processing_started": "Capture processing started",
    "capture.processing_completed": "Capture processing completed",
    "capture.processing_failed": "Capture processing failed",
    "asset.created": "Asset added",
    "asset.updated": "Asset updated",
    "asset.condition_changed": "Asset condition changed",
    "assessment.started": "Assessment started",
    "assessment.completed": "Assessment completed",
    "issue.created": "Issue created",
    "issue.assigned": "Issue assigned",
    "issue.resolved": "Issue resolved",
    "document.uploaded": "Document uploaded",
    "evidence.uploaded": "Evidence uploaded",
    "report.generated": "Report generated",
    "user.invited": "User invited",
    "permission.changed": "Permission changed",
  };
  return labels[type] ?? type;
}
