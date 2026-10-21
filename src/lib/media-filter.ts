/**
 * The media gallery's filters and sort, as pure functions over the loaded
 * list — the browser runs them on every change, and tests run them alone.
 */

export interface FilterableItem {
  id: string;
  type: string;
  takenAt: string;
  isFlagged: boolean;
  tagValueIds: string[];
}

export interface VocabularyType {
  id: string;
  name: string;
  values: Array<{ id: string; name: string }>;
}

export interface MediaFilters {
  flag: "all" | "flagged" | "unflagged";
  /** Empty means every type. */
  types: string[];
  /** Per tag type, the value a photo must carry; an absent or empty entry means any. */
  tags: Record<string, string>;
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
}

export const EMPTY_FILTERS: MediaFilters = { flag: "all", types: [], tags: {} };

export function filterMedia<T extends FilterableItem>(items: T[], f: MediaFilters): T[] {
  const wanted = Object.values(f.tags).filter(Boolean);
  return items.filter((item) => {
    if (f.flag === "flagged" && !item.isFlagged) return false;
    if (f.flag === "unflagged" && item.isFlagged) return false;
    if (f.types.length > 0 && !f.types.includes(item.type)) return false;
    if (wanted.some((valueId) => !item.tagValueIds.includes(valueId))) return false;
    const day = item.takenAt.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return true;
  });
}

/** "date-desc" | "date-asc" | "type" | `tag:<tagTypeId>` */
export type MediaSort = string;

const TYPE_ORDER = ["PHOTO", "IMAGE_360", "DRONE_IMAGE", "VIDEO"];

/**
 * Sorting by a tag type orders by that type's own value order (Ground,
 * Level 1, Roof…) rather than alphabetically, with untagged items last.
 * Ties fall back to newest first, so the order never jumps between renders.
 */
export function sortMedia<T extends FilterableItem>(items: T[], sort: MediaSort, vocabulary: VocabularyType[]): T[] {
  const newestFirst = (a: T, b: T) => b.takenAt.localeCompare(a.takenAt) || a.id.localeCompare(b.id);
  const sorted = [...items];
  if (sort === "date-asc") return sorted.sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.id.localeCompare(b.id));
  if (sort === "type") {
    return sorted.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || newestFirst(a, b));
  }
  if (sort.startsWith("tag:")) {
    const type = vocabulary.find((t) => t.id === sort.slice(4));
    if (type) {
      const rank = new Map(type.values.map((v, i) => [v.id, i]));
      const rankOf = (item: T) => {
        const ranks = item.tagValueIds.map((id) => rank.get(id)).filter((r): r is number => r !== undefined);
        return ranks.length ? Math.min(...ranks) : Number.MAX_SAFE_INTEGER;
      };
      return sorted.sort((a, b) => rankOf(a) - rankOf(b) || newestFirst(a, b));
    }
  }
  return sorted.sort(newestFirst);
}

/** How many items carry each tag value, for the counts beside filter options. */
export function countByTagValue(items: FilterableItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) for (const id of item.tagValueIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
