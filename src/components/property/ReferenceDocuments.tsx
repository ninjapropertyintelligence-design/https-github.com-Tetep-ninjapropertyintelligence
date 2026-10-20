import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";

/**
 * A short list of a property's documents chosen by one of the two document
 * flags: the Overview's key documents (`showInInfoTab`) or the field's
 * reference material on an assessment (`availableInCapture`). Renders
 * nothing when none are flagged, rather than an empty card.
 */
export async function ReferenceDocuments({
  propertyId,
  flag,
  title,
  subtitle,
}: {
  propertyId: string;
  flag: "showInInfoTab" | "availableInCapture";
  title: string;
  subtitle?: string;
}) {
  const documents = await prisma.document.findMany({
    where: { propertyId, [flag]: true, versions: { some: {} } },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: { id: true, title: true, documentType: true, updatedAt: true },
  });
  if (documents.length === 0) return null;
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <CardBody className="p-0">
        <ul>
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between border-b border-border px-5 py-2.5 text-sm last:border-0">
              <a href={`/api/v1/documents/${d.id}/download`} className="font-medium text-foreground hover:text-brand">
                {d.title}
              </a>
              <span className="text-xs text-muted">
                {d.documentType.replace(/_/g, " ")} · {formatDate(d.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
