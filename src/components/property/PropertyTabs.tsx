import Link from "next/link";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "exterior", label: "Exterior" },
  { key: "interior", label: "Interior" },
  { key: "digital-twin", label: "Digital Twin" },
  { key: "assets", label: "Assets" },
  { key: "assessments", label: "Assessments" },
  { key: "issues", label: "Issues" },
  { key: "documents", label: "Documents" },
  { key: "projects", label: "Projects" },
  { key: "history", label: "History" },
  { key: "reports", label: "Reports" },
  { key: "ai", label: "AI" },
] as const;

export function PropertyTabs({ propertyId, active }: { propertyId: string; active: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/properties/${propertyId}?tab=${tab.key}`}
          className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
            active === tab.key ? "border-brand text-brand" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
