import { redirect } from "next/navigation";
import { getSessionContext, can, propertyScopeWhere } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { TagVocabularyManager } from "@/components/tags/TagVocabularyManager";

/** The organization's tag vocabulary: every value, wherever it is offered. */
export default async function TagSettingsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canManageProperties")) redirect("/settings");

  const [types, properties] = await Promise.all([
    prisma.tagType.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: {
        values: {
          // Property-only values of sites this manager cannot see stay hidden.
          where: { OR: [{ propertyId: null }, { property: propertyScopeWhere(ctx) }] },
          orderBy: [{ position: "asc" }, { name: "asc" }],
          include: { property: { select: { name: true } } },
        },
      },
    }),
    prisma.property.findMany({ where: propertyScopeWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Tags</h1>
        <p className="text-sm text-muted">
          How photos and task responses are filed — the Level, Area, Type and Category the media gallery filters by.
        </p>
      </div>
      <TagVocabularyManager
        properties={properties}
        types={types.map((t) => ({
          id: t.id,
          name: t.name,
          allowMultiple: t.allowMultiple,
          values: t.values.map((v) => ({ id: v.id, name: v.name, propertyName: v.property?.name ?? null })),
        }))}
      />
    </div>
  );
}
