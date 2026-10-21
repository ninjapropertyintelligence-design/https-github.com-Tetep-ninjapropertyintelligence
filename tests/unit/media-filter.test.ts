import { describe, expect, it } from "vitest";
import { countByTagValue, EMPTY_FILTERS, filterMedia, sortMedia, type VocabularyType } from "@/lib/media-filter";

const level: VocabularyType = { id: "level", name: "Level", values: [{ id: "ground", name: "Ground" }, { id: "roof", name: "Roof" }] };
const category: VocabularyType = { id: "cat", name: "Category", values: [{ id: "hvac", name: "HVAC" }] };
const items = [
  { id: "a", type: "PHOTO", takenAt: "2026-10-01T10:00:00Z", isFlagged: false, tagValueIds: ["roof", "hvac"] },
  { id: "b", type: "IMAGE_360", takenAt: "2026-10-03T10:00:00Z", isFlagged: true, tagValueIds: ["ground"] },
  { id: "c", type: "PHOTO", takenAt: "2026-10-02T10:00:00Z", isFlagged: false, tagValueIds: [] },
];
const ids = (list: { id: string }[]) => list.map((i) => i.id);

describe("filterMedia", () => {
  it("combines flag, type, tag and date filters", () => {
    expect(ids(filterMedia(items, EMPTY_FILTERS))).toEqual(["a", "b", "c"]);
    expect(ids(filterMedia(items, { ...EMPTY_FILTERS, flag: "flagged" }))).toEqual(["b"]);
    expect(ids(filterMedia(items, { ...EMPTY_FILTERS, types: ["PHOTO"] }))).toEqual(["a", "c"]);
    expect(ids(filterMedia(items, { ...EMPTY_FILTERS, tags: { level: "roof", cat: "hvac" } }))).toEqual(["a"]);
    expect(ids(filterMedia(items, { ...EMPTY_FILTERS, tags: { level: "" } }))).toEqual(["a", "b", "c"]);
    expect(ids(filterMedia(items, { ...EMPTY_FILTERS, from: "2026-10-02", to: "2026-10-02" }))).toEqual(["c"]);
  });
});

describe("sortMedia", () => {
  it("sorts by date either way, by type, and by a tag type's own value order with untagged last", () => {
    expect(ids(sortMedia(items, "date-desc", [level]))).toEqual(["b", "c", "a"]);
    expect(ids(sortMedia(items, "date-asc", [level]))).toEqual(["a", "c", "b"]);
    expect(ids(sortMedia(items, "type", [level]))).toEqual(["c", "a", "b"]);
    expect(ids(sortMedia(items, "tag:level", [level, category]))).toEqual(["b", "a", "c"]);
  });
});

describe("countByTagValue", () => {
  it("counts items per value", () => {
    expect(Object.fromEntries(countByTagValue(items))).toEqual({ roof: 1, hvac: 1, ground: 1 });
  });
});
