"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";
import { TagPicker, type PickerTagType } from "@/components/tags/TagPicker";
import { AddToCollection } from "@/components/collection/CollectionControls";
import { countByTagValue, EMPTY_FILTERS, filterMedia, sortMedia, type MediaFilters } from "@/lib/media-filter";
import type { GalleryItem } from "@/lib/media-gallery";

const TYPE_LABELS: Record<string, string> = {
  PHOTO: "Photos",
  IMAGE_360: "360° images",
  DRONE_IMAGE: "Drone images",
  VIDEO: "Videos",
};
const SELECT = "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground";

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
}

export function MediaGallery({
  items: initialItems,
  truncated,
  tagTypes,
  collections,
  canEdit,
  canCollect,
  currentUserId,
}: {
  items: GalleryItem[];
  truncated: boolean;
  tagTypes: PickerTagType[];
  collections: Array<{ id: string; name: string }>;
  canEdit: boolean;
  canCollect: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  // Edits land here first, so the grid and the open photo stay in step
  // without a full reload after every tag change.
  const [items, setItems] = useState(initialItems);
  const [filters, setFilters] = useState<MediaFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState("date-desc");
  const [size, setSize] = useState(140);
  const [openId, setOpenId] = useState<string | null>(null);

  const presentTypes = useMemo(() => [...new Set(items.map((i) => i.type))], [items]);
  const shown = useMemo(() => sortMedia(filterMedia(items, filters), sort, tagTypes), [items, filters, sort, tagTypes]);
  const counts = useMemo(() => countByTagValue(items), [items]);
  const valueName = useMemo(() => new Map(tagTypes.flatMap((t) => t.values.map((v) => [v.id, v.name] as const))), [tagTypes]);
  const filtered = filters.flag !== "all" || filters.types.length > 0 || Object.values(filters.tags).some(Boolean) || !!filters.from || !!filters.to;

  const open = items.find((i) => i.id === openId) ?? null;
  const openIndex = open ? shown.findIndex((i) => i.id === open.id) : -1;

  function patchItem(id: string, patch: Partial<GalleryItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted">
        No photos for this property yet. Photos from surveys, issues and capture jobs collect here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
        <label className="space-y-0.5 text-xs text-muted">
          <span className="block">Flag</span>
          <select className={SELECT} value={filters.flag} onChange={(e) => setFilters({ ...filters, flag: e.target.value as MediaFilters["flag"] })}>
            <option value="all">All</option>
            <option value="flagged">Flagged</option>
            <option value="unflagged">Not flagged</option>
          </select>
        </label>

        {presentTypes.length > 1 ? (
          <fieldset className="space-y-0.5 text-xs text-muted">
            <legend>Media type</legend>
            <div className="flex gap-2 rounded-lg border border-border px-2 py-1.5">
              {presentTypes.map((type) => (
                <label key={type} className="flex items-center gap-1 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={filters.types.length === 0 || filters.types.includes(type)}
                    onChange={(e) => {
                      const current = filters.types.length === 0 ? presentTypes : filters.types;
                      const next = e.target.checked ? [...current, type] : current.filter((t) => t !== type);
                      setFilters({ ...filters, types: next.length === presentTypes.length ? [] : next });
                    }}
                  />
                  {TYPE_LABELS[type] ?? type}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {tagTypes
          .filter((t) => t.values.some((v) => counts.has(v.id)))
          .map((type) => (
            <label key={type.id} className="space-y-0.5 text-xs text-muted">
              <span className="block">{type.name}</span>
              <select
                className={SELECT}
                value={filters.tags[type.id] ?? ""}
                onChange={(e) => setFilters({ ...filters, tags: { ...filters.tags, [type.id]: e.target.value } })}
              >
                <option value="">Any</option>
                {type.values
                  .filter((v) => counts.has(v.id))
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({counts.get(v.id)})
                    </option>
                  ))}
              </select>
            </label>
          ))}

        <label className="space-y-0.5 text-xs text-muted">
          <span className="block">From</span>
          <input type="date" className={SELECT} value={filters.from ?? ""} onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })} />
        </label>
        <label className="space-y-0.5 text-xs text-muted">
          <span className="block">To</span>
          <input type="date" className={SELECT} value={filters.to ?? ""} onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })} />
        </label>

        <label className="space-y-0.5 text-xs text-muted">
          <span className="block">Sort by</span>
          <select className={SELECT} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="date-desc">Date, newest first</option>
            <option value="date-asc">Date, oldest first</option>
            <option value="type">Media type</option>
            {tagTypes
              .filter((t) => t.values.length > 0)
              .map((t) => (
                <option key={t.id} value={`tag:${t.id}`}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>

        <label className="ml-auto flex items-center gap-2 self-center text-xs text-muted">
          Size
          <input type="range" min={80} max={260} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Thumbnail size" />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>
          {shown.length} of {items.length} item{items.length === 1 ? "" : "s"}
          {truncated ? " (newest shown; more exist)" : ""}
          {filtered ? (
            <button type="button" className="ml-2 text-brand hover:underline" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear filters
            </button>
          ) : null}
        </span>
        {canCollect && shown.length > 0 ? <AddToCollection evidenceIds={shown.map((i) => i.id)} collections={collections} /> : null}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-8 text-center text-sm text-muted">Nothing matches these filters.</p>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
          {shown.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setOpenId(item.id)}
              className="group relative block overflow-hidden rounded-lg border border-border bg-zinc-100 text-left focus:outline-none focus:ring-2 focus:ring-brand"
              aria-label={`${TYPE_LABELS[item.type] ?? item.type} from ${new Date(item.takenAt).toLocaleDateString()}`}
            >
              {item.type === "VIDEO" ? (
                <span className="grid aspect-square place-items-center text-xs text-muted">Video</span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- same-origin evidence bytes, not a static asset
                <img src={`/api/v1/evidence/${item.id}/content?size=small`} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              )}
              <span className="absolute left-1 top-1 flex gap-1">
                {item.isFlagged ? <span className="rounded bg-[var(--band-critical)] px-1 text-[10px] font-semibold text-white">Flagged</span> : null}
                {item.type === "IMAGE_360" ? <span className="rounded bg-black/60 px-1 text-[10px] text-white">360°</span> : null}
              </span>
              {item.comments > 0 ? (
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">{item.comments} 💬</span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {open ? (
        <MediaDetail
          key={open.id}
          item={open}
          tagTypes={tagTypes}
          valueName={valueName}
          collections={collections}
          canEdit={canEdit}
          canCollect={canCollect}
          currentUserId={currentUserId}
          onClose={() => setOpenId(null)}
          onPrev={openIndex > 0 ? () => setOpenId(shown[openIndex - 1].id) : null}
          onNext={openIndex >= 0 && openIndex < shown.length - 1 ? () => setOpenId(shown[openIndex + 1].id) : null}
          onChange={(patch) => patchItem(open.id, patch)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

function MediaDetail({
  item,
  tagTypes,
  valueName,
  collections,
  canEdit,
  canCollect,
  currentUserId,
  onClose,
  onPrev,
  onNext,
  onChange,
  onSaved,
}: {
  item: GalleryItem;
  tagTypes: PickerTagType[];
  valueName: Map<string, string>;
  collections: Array<{ id: string; name: string }>;
  canEdit: boolean;
  canCollect: boolean;
  currentUserId: string;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onChange: (patch: Partial<GalleryItem>) => void;
  onSaved: () => void;
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiRequest(`/api/v1/evidence/${item.id}/comments`, { method: "GET" }).then((res) => {
      if (!cancelled) setComments(res.ok ? ((res.data?.items as Comment[] | undefined) ?? []) : []);
    });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    const res = await apiRequest(url, init);
    setBusy(false);
    if (!res.ok) setError(res.error);
    return res;
  }

  async function saveTags(tagValueIds: string[]) {
    const before = item.tagValueIds;
    onChange({ tagValueIds });
    const res = await call(`/api/v1/evidence/${item.id}/tags`, { method: "PUT", body: JSON.stringify({ tagValueIds }) });
    if (!res.ok) onChange({ tagValueIds: before });
    else onSaved();
  }

  async function toggleFlag() {
    const res = await call(`/api/v1/evidence/${item.id}/flag`, { method: "PATCH", body: JSON.stringify({ flagged: !item.isFlagged }) });
    if (res.ok) {
      onChange({ isFlagged: !item.isFlagged });
      onSaved();
    }
  }

  async function addComment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get("body") ?? "");
    const res = await call(`/api/v1/evidence/${item.id}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    if (res.ok && res.data) {
      setComments((prev) => [...(prev ?? []), res.data as unknown as Comment]);
      onChange({ comments: item.comments + 1 });
      form.reset();
    }
  }

  async function removeComment(id: string) {
    const res = await call(`/api/v1/evidence/comments/${id}`, { method: "DELETE" });
    if (res.ok) {
      setComments((prev) => (prev ?? []).filter((c) => c.id !== id));
      onChange({ comments: Math.max(0, item.comments - 1) });
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Photo details" className="fixed inset-0 z-50 flex bg-black/80" onClick={onClose}>
      <div className="flex min-w-0 flex-1 items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
        {onPrev ? (
          <button type="button" onClick={onPrev} className="mr-2 rounded-full bg-white/10 px-3 py-2 text-white hover:bg-white/20" aria-label="Previous">
            ‹
          </button>
        ) : null}
        {item.type === "VIDEO" ? (
          <video src={`/api/v1/evidence/${item.id}/content`} controls className="max-h-full max-w-full" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- same-origin evidence bytes, not a static asset
          <img src={`/api/v1/evidence/${item.id}/content?size=medium`} alt="" className="max-h-full max-w-full object-contain" />
        )}
        {onNext ? (
          <button type="button" onClick={onNext} className="ml-2 rounded-full bg-white/10 px-3 py-2 text-white hover:bg-white/20" aria-label="Next">
            ›
          </button>
        ) : null}
      </div>

      <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto bg-surface p-4 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Info</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground" aria-label="Close">
            ✕
          </button>
        </div>

        <dl className="mt-3 space-y-1.5">
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{item.capturedKnown ? "Date captured" : "Date uploaded"}</dt>
            <dd className="text-right text-foreground">{new Date(item.takenAt).toLocaleString()}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">By</dt>
            <dd className="text-right text-foreground">{item.uploadedBy}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Type</dt>
            <dd className="text-right text-foreground">{TYPE_LABELS[item.type] ?? item.type}</dd>
          </div>
          {item.context ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Taken for</dt>
              <dd className="text-right">
                <Link
                  href={item.context.kind === "assessment" ? `/assessments/${item.context.id}` : item.context.kind === "issue" ? `/issues/${item.context.id}` : `/assets/${item.context.id}`}
                  className="text-brand hover:underline"
                >
                  {item.context.label}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-4 space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Tags</h3>
          {canEdit ? (
            <TagPicker types={tagTypes} selected={item.tagValueIds} onChange={saveTags} disabled={busy} />
          ) : item.tagValueIds.length > 0 ? (
            <p className="text-foreground">{item.tagValueIds.map((id) => valueName.get(id) ?? "").filter(Boolean).join(" · ")}</p>
          ) : (
            <p className="text-muted">No tags</p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
          {canEdit ? (
            <Button variant="secondary" disabled={busy} onClick={toggleFlag}>
              {item.isFlagged ? "Unflag" : "Flag"}
            </Button>
          ) : null}
          {canCollect ? <AddToCollection evidenceIds={[item.id]} collections={collections} /> : null}
          <a href={`/api/v1/evidence/${item.id}/content`} className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-zinc-50">
            Original
          </a>
        </div>

        <div className="mt-4 flex-1 space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Comments</h3>
          {comments === null ? <p className="text-muted">Loading…</p> : null}
          {comments?.length === 0 ? <p className="text-muted">No comments yet.</p> : null}
          <ul className="space-y-2">
            {comments?.map((c) => (
              <li key={c.id} className="rounded-lg bg-zinc-50 px-3 py-2">
                <p className="whitespace-pre-wrap text-foreground">{c.body}</p>
                <p className="mt-1 flex justify-between text-xs text-muted">
                  <span>
                    {c.author.name} · {new Date(c.createdAt).toLocaleString()}
                  </span>
                  {c.author.id === currentUserId ? (
                    <button type="button" onClick={() => removeComment(c.id)} className="hover:text-[var(--band-critical)]">
                      Remove
                    </button>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
          <form onSubmit={addComment} className="space-y-2">
            <textarea name="body" required maxLength={4000} rows={2} placeholder="Add a comment" className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand" />
            <Button type="submit" variant="secondary" disabled={busy}>
              Comment
            </Button>
          </form>
        </div>

        {error ? <p className="mt-2 text-sm text-[var(--band-critical)]">{error}</p> : null}
      </aside>
    </div>
  );
}
