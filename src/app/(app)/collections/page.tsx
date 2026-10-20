import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewCollectionForm } from "@/components/collection/CollectionControls";
import { COLLECTION_SORTS, listCollections, type CollectionSort } from "@/lib/collection-service";
import { formatDate } from "@/lib/format";

const SELECT = "rounded-lg border border-border px-3 py-2 text-sm";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; visibility?: string; creator?: string; sort?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const params = await searchParams;
  const visibility = params.visibility === "PRIVATE" || params.visibility === "ORGANIZATION" ? params.visibility : null;
  const sort = COLLECTION_SORTS.includes(params.sort as CollectionSort) ? (params.sort as CollectionSort) : "recent";

  const collections = await listCollections(ctx, {
    q: params.q?.trim() || null,
    visibility,
    creator: params.creator === "me" ? "me" : null,
    sort,
  });
  const filtered = !!(params.q || visibility || params.creator);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Collections</h1>
          <p className="text-sm text-muted">
            {collections.length} collection{collections.length === 1 ? "" : "s"} — hand-picked photos, private or shared
          </p>
        </div>
        {can(ctx, "canViewPortfolio") ? <NewCollectionForm /> : null}
      </div>

      <form action="/collections" className="flex flex-wrap gap-2">
        <input name="q" defaultValue={params.q ?? ""} placeholder="Search collections" className={`${SELECT} w-56 outline-none focus:border-brand`} />
        <select name="visibility" defaultValue={visibility ?? ""} className={SELECT} aria-label="Privacy">
          <option value="">Any privacy</option>
          <option value="PRIVATE">Private</option>
          <option value="ORGANIZATION">Shared</option>
        </select>
        <select name="creator" defaultValue={params.creator ?? ""} className={SELECT} aria-label="Creator">
          <option value="">Anyone</option>
          <option value="me">Made by me</option>
        </select>
        <select name="sort" defaultValue={sort} className={SELECT} aria-label="Sort by">
          <option value="recent">Recently updated</option>
          <option value="name">Name</option>
          <option value="items">Most items</option>
        </select>
        <button type="submit" className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-zinc-50">
          Apply
        </button>
      </form>

      {collections.length === 0 ? (
        <EmptyState
          title={filtered ? "No collections match" : "No collections"}
          description={
            filtered
              ? "Try clearing the search or filters."
              : "Gather photos from projects and properties into a collection to review or share them together."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((c) => (
            <Link key={c.id} href={`/collections/${c.id}`} className="overflow-hidden rounded-xl border border-border bg-surface transition hover:border-brand">
              {c.coverEvidenceId ? (
                // eslint-disable-next-line @next/next/no-img-element -- same-origin evidence bytes, not a static asset
                <img src={`/api/v1/evidence/${c.coverEvidenceId}/content`} alt="" className="h-32 w-full object-cover" />
              ) : (
                <div className="grid h-32 place-items-center bg-zinc-50 text-xs text-muted">Empty</div>
              )}
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium text-foreground">{c.name}</p>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                    {c.visibility === "PRIVATE" ? "Private" : "Shared"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {c._count.items} item{c._count.items === 1 ? "" : "s"} · {c.createdBy.id === ctx.userId ? "you" : c.createdBy.name} · {formatDate(c.updatedAt)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
