import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/session-context";
import { EmptyState } from "@/components/ui/EmptyState";
import { CollectionSettings, RemoveFromCollection } from "@/components/collection/CollectionControls";
import { getCollection } from "@/lib/collection-service";
import { ApiError } from "@/lib/api-error";
import { formatDate } from "@/lib/format";

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const { id } = await params;
  const collection = await getCollection(ctx, id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  });
  if (!collection) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/collections" className="text-xs text-muted hover:text-brand">
          ← Collections
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{collection.name}</h1>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
            {collection.visibility === "PRIVATE" ? "Private" : "Shared with organization"}
          </span>
        </div>
        <p className="text-sm text-muted">
          {collection.items.length} item{collection.items.length === 1 ? "" : "s"} · made by{" "}
          {collection.canEdit ? "you" : collection.createdBy.name} · updated {formatDate(collection.updatedAt)}
        </p>
        {collection.description ? <p className="mt-2 max-w-2xl text-sm text-foreground">{collection.description}</p> : null}
      </div>

      {collection.canEdit ? (
        <CollectionSettings
          collectionId={collection.id}
          name={collection.name}
          description={collection.description}
          visibility={collection.visibility}
        />
      ) : null}

      {collection.items.length === 0 ? (
        <EmptyState title="Nothing collected yet" description="Use “Add to collection” on a project's media to gather photos here." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {collection.items.map((item) => (
            <figure key={item.id} className="space-y-1">
              <a href={`/api/v1/evidence/${item.evidence.id}/content`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- same-origin evidence bytes, not a static asset */}
                <img
                  src={`/api/v1/evidence/${item.evidence.id}/content?size=small`}
                  alt={`${item.evidence.type === "IMAGE_360" ? "360° panorama" : "Photo"}${item.evidence.property ? ` at ${item.evidence.property.name}` : ""}`}
                  className="aspect-square w-full rounded-lg border border-border object-cover"
                />
              </a>
              <figcaption className="flex items-center justify-between gap-1 text-xs text-muted">
                {item.evidence.property ? (
                  <Link href={`/properties/${item.evidence.property.id}`} className="truncate hover:text-brand">
                    {item.evidence.property.name}
                  </Link>
                ) : (
                  <span>—</span>
                )}
                {collection.canEdit ? <RemoveFromCollection collectionId={collection.id} evidenceId={item.evidence.id} /> : null}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {collection.visibility === "ORGANIZATION" ? (
        <p className="text-xs text-muted">Everyone sees only the items on properties they can access.</p>
      ) : null}
    </div>
  );
}
