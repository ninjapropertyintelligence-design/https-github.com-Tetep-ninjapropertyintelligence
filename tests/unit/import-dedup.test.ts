import { describe, expect, it } from "vitest";
import {
  DUPLICATE_THRESHOLD,
  DedupCandidate,
  findIntraFileDuplicates,
  findMatches,
  indexCandidates,
  verdictFor,
} from "@/lib/import/dedup";
import {
  normalizeAddress,
  normalizeName,
  normalizePostalCode,
  parseExternalIdCell,
} from "@/lib/import/normalize";

/**
 * Spec §69 states the requirement as a concrete failure to avoid:
 *
 *     Store 1052 / Store #1052 / Store-1052 becoming three properties.
 *
 * These tests encode that literally, then cover the inverse risk — that an
 * over-eager matcher merges properties which are genuinely different, which
 * silently destroys customer data and is the worse of the two failures.
 */
const existing: DedupCandidate[] = [
  {
    id: "prop-1052",
    name: "Store #1052",
    customerPropertyId: "STORE-1052",
    externalIds: [{ system: "yardi", id: "P-1052" }],
    addressLine1: "1200 Main St",
    city: "Dallas",
    state: "TX",
    postalCode: "75201",
  },
  {
    id: "prop-2210",
    name: "Store #2210",
    customerPropertyId: "STORE-2210",
    externalIds: [],
    addressLine1: "88 Oak Ave",
    city: "Austin",
    state: "TX",
    postalCode: "78701",
  },
];
const index = indexCandidates(existing);

describe("§69 — the three spellings must not become three properties", () => {
  it.each(["Store 1052", "Store #1052", "Store-1052", "STORE_1052", "store.1052"])(
    "%s matches the existing property on name + city alone (no ID supplied)",
    (name) => {
      const matches = findMatches({ name, city: "Dallas", state: "TX" }, index);
      expect(matches[0]?.candidateId).toBe("prop-1052");
      expect(verdictFor(matches[0])).toBe("DUPLICATE");
    },
  );

  it("matches on customer property ID however it is punctuated", () => {
    for (const id of ["STORE-1052", "store 1052", "Store#1052", "store_1052"]) {
      const matches = findMatches({ name: "Totally Different Name", customerPropertyId: id }, index);
      expect(matches[0]?.best.rule).toBe("CUSTOMER_PROPERTY_ID");
      expect(matches[0]?.best.confidence).toBe(1);
    }
  });

  it("matches on address even when the row spells the street differently", () => {
    const matches = findMatches(
      { name: "Renamed Store", addressLine1: "1200 Main Street, Suite 400", postalCode: "75201-4432" },
      index,
    );
    expect(matches[0]?.candidateId).toBe("prop-1052");
    expect(matches[0]?.best.rule).toBe("ADDRESS");
    expect(verdictFor(matches[0])).toBe("DUPLICATE");
  });

  it("matches on a shared external system ID", () => {
    const matches = findMatches(
      { name: "Unknown", externalIds: parseExternalIdCell("yardi=P-1052") },
      index,
    );
    expect(matches[0]?.best.rule).toBe("EXTERNAL_ID");
    expect(verdictFor(matches[0])).toBe("DUPLICATE");
  });

  it("every match explains itself — a reviewer needs the reason, not just a score", () => {
    const matches = findMatches({ name: "Store 1052", customerPropertyId: "STORE-1052", city: "Dallas", state: "TX" }, index);
    expect(matches[0].best.detail).toContain("STORE-1052");
    // All the rules that fired are reported, not only the winner.
    expect(matches[0].evidence.length).toBeGreaterThan(1);
  });
});

describe("the inverse risk — genuinely different properties must NOT merge", () => {
  it("a different store number is a different property", () => {
    expect(findMatches({ name: "Store #1053", city: "Dallas", state: "TX" }, index)).toHaveLength(0);
  });

  it("the same name in a different city needs review, not an automatic merge", () => {
    // Two real stores can share a name across regions. Merging on name alone
    // would silently destroy one of them.
    const matches = findMatches({ name: "Store #1052", city: "Phoenix", state: "AZ" }, index);
    expect(matches[0]?.best.rule).toBe("NAME_ONLY");
    expect(matches[0]?.best.confidence).toBeLessThan(DUPLICATE_THRESHOLD);
    expect(verdictFor(matches[0])).toBe("NEEDS_REVIEW");
  });

  it("a neighbouring street number is not the same building", () => {
    expect(
      findMatches({ name: "Some Store", addressLine1: "1201 Main St", postalCode: "75201" }, index),
    ).toHaveLength(0);
  });

  it("the same street name in a different ZIP is not a match", () => {
    expect(
      findMatches({ name: "Some Store", addressLine1: "1200 Main St", postalCode: "78701" }, index),
    ).toHaveLength(0);
  });

  it("the same external id in a DIFFERENT system does not collide", () => {
    const matches = findMatches({ name: "Unknown", externalIds: parseExternalIdCell("angus=P-1052") }, index);
    expect(matches).toHaveLength(0);
  });

  it("a wholly new property matches nothing", () => {
    const matches = findMatches(
      { name: "Store #9999", customerPropertyId: "STORE-9999", addressLine1: "5 New Rd", city: "Reno", state: "NV", postalCode: "89501" },
      index,
    );
    expect(matches).toHaveLength(0);
    expect(verdictFor(matches[0] ?? null)).toBe("NEW");
  });

  it("an empty subject does not match everything — blank fields must not be treated as equal", () => {
    // The bug this guards: "" === "" is true, so a row with no address would
    // match every property that also has none.
    const blanks: DedupCandidate[] = [
      { id: "a", name: "", customerPropertyId: null, externalIds: [], addressLine1: "", city: "", state: "", postalCode: "" },
    ];
    expect(findMatches({ name: "" }, indexCandidates(blanks))).toHaveLength(0);
    expect(findMatches({ name: "", addressLine1: "", postalCode: "" }, indexCandidates(blanks))).toHaveLength(0);
  });

  it("reports every colliding property, not just the best one", () => {
    // Two existing properties sharing a customer ID is a data-quality problem
    // the customer has to see, not something to pick a winner for.
    const twins = indexCandidates([
      { ...existing[0], id: "twin-a" },
      { ...existing[0], id: "twin-b", name: "Store 1052 (dup)" },
    ]);
    expect(findMatches({ name: "Store 1052", customerPropertyId: "STORE-1052" }, twins)).toHaveLength(2);
  });
});

describe("duplicates within the uploaded file itself", () => {
  it("collapses the spec's three spellings appearing as three rows", () => {
    const rows = [
      { name: "Store 1052", city: "Dallas", state: "TX" },
      { name: "Store #1052", city: "Dallas", state: "TX" },
      { name: "Store-1052", city: "Dallas", state: "TX" },
    ];
    const dupes = findIntraFileDuplicates(rows);
    // Rows 1 and 2 both point back to row 0 — one canonical row, two repeats.
    expect(dupes.get(1)).toBe(0);
    expect(dupes.get(2)).toBe(0);
    expect(dupes.has(0)).toBe(false);
  });

  it("catches a repeat via customer ID even when the names differ entirely", () => {
    const dupes = findIntraFileDuplicates([
      { name: "Main Street Store", customerPropertyId: "STORE-1052" },
      { name: "Dallas Flagship", customerPropertyId: "store 1052" },
    ]);
    expect(dupes.get(1)).toBe(0);
  });

  it("leaves genuinely distinct rows alone", () => {
    const dupes = findIntraFileDuplicates([
      { name: "Store 1052", customerPropertyId: "STORE-1052", city: "Dallas" },
      { name: "Store 1053", customerPropertyId: "STORE-1053", city: "Dallas" },
      { name: "Store 1054", customerPropertyId: "STORE-1054", city: "Austin" },
    ]);
    expect(dupes.size).toBe(0);
  });

  it("does not pair rows that are merely both incomplete", () => {
    const dupes = findIntraFileDuplicates([{ name: "" }, { name: "" }]);
    expect(dupes.size).toBe(0);
  });
});

describe("normalisation building blocks", () => {
  it("keeps distinct store numbers distinct", () => {
    expect(normalizeName("Store 1052")).not.toBe(normalizeName("Store 10520"));
    expect(normalizeName("Store 1052")).not.toBe(normalizeName("Storefront 1052"));
  });

  it("folds accents so Café and Cafe agree", () => {
    expect(normalizeName("Café Downtown")).toBe(normalizeName("Cafe Downtown"));
  });

  it("expands street suffixes and drops unit designators", () => {
    expect(normalizeAddress("1200 Main St, Suite 4")).toBe(normalizeAddress("1200 Main Street"));
    expect(normalizeAddress("1200 N Main Ave")).toBe("1200 north main avenue");
  });

  it("keeps a leading-zero ZIP intact and ignores +4", () => {
    expect(normalizePostalCode("07030")).toBe("07030");
    expect(normalizePostalCode("75201-4432")).toBe("75201");
  });
});
