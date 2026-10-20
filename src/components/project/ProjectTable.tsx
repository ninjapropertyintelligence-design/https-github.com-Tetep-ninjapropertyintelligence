import Link from "next/link";
import { StatusBadge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";

export interface ProjectRow {
  id: string;
  name: string;
  projectType: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  property: { id: string; name: string; city: string; state: string };
  program: { id: string; name: string } | null;
}

export function ProjectTable({ projects, showProperty = true }: { projects: ProjectRow[]; showProperty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-5 py-2.5 font-medium">Project</th>
            {showProperty ? <th className="px-5 py-2.5 font-medium">Property</th> : null}
            <th className="px-5 py-2.5 font-medium">Program</th>
            <th className="px-5 py-2.5 font-medium">Dates</th>
            <th className="px-5 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0">
              <td className="px-5 py-3">
                <Link href={`/projects/${p.id}`} className="font-medium text-foreground hover:text-brand">
                  {p.name}
                </Link>
                {p.projectType ? <p className="text-xs text-muted">{p.projectType}</p> : null}
              </td>
              {showProperty ? (
                <td className="px-5 py-3">
                  <Link href={`/properties/${p.property.id}`} className="text-foreground hover:text-brand">
                    {p.property.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {p.property.city}, {p.property.state}
                  </p>
                </td>
              ) : null}
              <td className="px-5 py-3 text-muted">{p.program?.name ?? "—"}</td>
              <td className="px-5 py-3 text-muted">
                {p.startDate || p.endDate ? `${formatDate(p.startDate)} – ${formatDate(p.endDate)}` : "—"}
              </td>
              <td className="px-5 py-3">
                <StatusBadge status={p.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
