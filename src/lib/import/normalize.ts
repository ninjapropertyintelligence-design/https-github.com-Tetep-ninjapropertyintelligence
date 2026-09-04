/**
 * Normalisation for duplicate detection (spec §69).
 *
 * The spec's own example is the whole problem statement:
 *
 *     Store 1052
 *     Store #1052
 *     Store-1052
 *
 * must not become three properties. These functions produce a comparison
 * key that collapses exactly those differences — punctuation, separators,
 * case, and spacing — while keeping the parts that genuinely distinguish
 * one property from another.
 *
 * Kept deliberately free of database access so the matching rules can be
 * unit-tested exhaustively against the spec's examples.
 */

/**
 * Case-folds, strips punctuation, and collapses whitespace. Digits are kept
 * adjacent to their words so "Store 1052" and "Store-1052" agree, while
 * "Store 1052" and "Store 1053" still differ.
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    // Drop combining marks so "Café" and "Cafe" match.
    .replace(/[\u0300-\u036f]/g, "")
    // Any run of non-alphanumerics becomes a single space: this is what
    // makes "#", "-", "_" and "." equivalent to a space.
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    // Then remove the spaces entirely: "store 1052" -> "store1052", which
    // is what finally unifies the spec's three spellings.
    .replace(/\s+/g, "");
}

/**
 * Customer property IDs are the strongest signal (§69 lists it first, and
 * §70 makes it a first-class identity field), so they get the same
 * treatment: "STORE-1052", "store 1052" and "Store#1052" are one ID.
 */
export function normalizeIdentifier(value: string): string {
  return normalizeName(value);
}

/** US-centric but explicit: 5-digit ZIP, ignoring any +4 extension. */
export function normalizePostalCode(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : digits;
}

/**
 * Street-address normalisation. Expands the abbreviations that actually
 * cause false negatives in retail portfolios ("1200 Main St" vs "1200 Main
 * Street") and drops unit/suite designators, which are frequently recorded
 * on one row and omitted on another for the same building.
 */
const STREET_SUFFIXES: Record<string, string> = {
  st: "street", str: "street", street: "street",
  ave: "avenue", av: "avenue", avenue: "avenue",
  rd: "road", road: "road",
  blvd: "boulevard", boulevard: "boulevard",
  dr: "drive", drive: "drive",
  ln: "lane", lane: "lane",
  ct: "court", court: "court",
  pl: "place", place: "place",
  pkwy: "parkway", pkwy_: "parkway", parkway: "parkway",
  hwy: "highway", highway: "highway",
  ter: "terrace", terrace: "terrace",
  cir: "circle", circle: "circle",
  sq: "square", square: "square",
  trl: "trail", trail: "trail",
  n: "north", s: "south", e: "east", w: "west",
  ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
};

/** Unit designators dropped before comparison — see normalizeAddress. */
const UNIT_MARKERS = new Set(["suite", "ste", "unit", "apt", "apartment", "bldg", "building", "fl", "floor", "rm", "room", "#"]);

export function normalizeAddress(value: string): string {
  const cleaned = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (cleaned === "") return "";

  const tokens = cleaned.split(" ");
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // Everything from a unit marker onwards is dropped: "1200 main st suite
    // 4" and "1200 main street" are the same building.
    if (UNIT_MARKERS.has(token)) break;
    out.push(STREET_SUFFIXES[token] ?? token);
  }

  return out.join(" ").trim();
}

/**
 * External system IDs (§69/§70) arrive as a JSON array on Property. Compared
 * as `system:id` pairs so the same id in two different systems doesn't
 * collide.
 */
export interface ExternalId {
  system: string;
  id: string;
}

export function normalizeExternalIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys: string[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && "system" in entry && "id" in entry) {
      const { system, id } = entry as ExternalId;
      if (typeof system === "string" && typeof id === "string" && id.trim() !== "") {
        keys.push(`${normalizeIdentifier(system)}:${normalizeIdentifier(id)}`);
      }
    }
  }
  return keys;
}

/**
 * Parses the free-text external-ID column an import may carry, e.g.
 * "yardi=P-1052; angus=1052". Tolerant of `=` or `:` and `;` or `,`.
 */
export function parseExternalIdCell(value: string): ExternalId[] {
  if (!value.trim()) return [];
  return value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^([^=:]+)[=:](.+)$/);
      // A bare value with no system is still worth keeping, attributed to a
      // generic "external" system rather than discarded.
      if (!match) return { system: "external", id: part.trim() };
      return { system: match[1].trim(), id: match[2].trim() };
    })
    .filter((e) => e.id !== "");
}
