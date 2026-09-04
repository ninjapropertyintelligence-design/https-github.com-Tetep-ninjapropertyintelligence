import { normalizeName } from "@/lib/import/normalize";

/**
 * Target field definitions and column auto-mapping (spec §68 "Field
 * mapping").
 *
 * Everything about an importable field lives in one declarative record —
 * its aliases, whether it is required, how a cell is coerced, and how it is
 * validated. Adding a field is a data change, not new branching logic, and
 * the UI renders its mapping dropdown straight from this list.
 */

export type ImportEntity = "PROPERTIES" | "ASSETS";

export interface CoercionResult {
  ok: boolean;
  value?: string | number | null;
  error?: string;
}

export interface TargetField {
  key: string;
  label: string;
  required: boolean;
  /** Header spellings seen in the wild, matched after normalisation. */
  aliases: string[];
  help?: string;
  coerce: (raw: string) => CoercionResult;
}

const text = (max = 500) => (raw: string): CoercionResult => {
  const value = raw.trim();
  if (value.length > max) return { ok: false, error: `Longer than ${max} characters` };
  return { ok: true, value };
};

const integer = (min: number, max: number) => (raw: string): CoercionResult => {
  const cleaned = raw.trim().replace(/[,_\s]/g, "");
  if (cleaned === "") return { ok: true, value: null };
  // Accept "42000.00" from spreadsheets that format integers as decimals,
  // but reject a genuinely fractional value rather than silently truncating.
  const asNumber = Number(cleaned);
  if (!Number.isFinite(asNumber)) return { ok: false, error: `"${raw}" is not a number` };
  if (!Number.isInteger(asNumber)) return { ok: false, error: `"${raw}" must be a whole number` };
  if (asNumber < min || asNumber > max) return { ok: false, error: `Must be between ${min} and ${max}` };
  return { ok: true, value: asNumber };
};

const decimal = (min: number, max: number) => (raw: string): CoercionResult => {
  const cleaned = raw.trim().replace(/[,_\s]/g, "");
  if (cleaned === "") return { ok: true, value: null };
  const asNumber = Number(cleaned);
  if (!Number.isFinite(asNumber)) return { ok: false, error: `"${raw}" is not a number` };
  if (asNumber < min || asNumber > max) return { ok: false, error: `Must be between ${min} and ${max}` };
  return { ok: true, value: asNumber };
};

/** Money arrives as "$1,250.00" or "1250" and is stored in cents. */
const money = (raw: string): CoercionResult => {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (cleaned === "") return { ok: true, value: null };
  const asNumber = Number(cleaned);
  if (!Number.isFinite(asNumber)) return { ok: false, error: `"${raw}" is not an amount` };
  if (asNumber < 0) return { ok: false, error: "Cannot be negative" };
  return { ok: true, value: Math.round(asNumber * 100) };
};

/**
 * US state, accepted as a two-letter code or a full name. Rejecting
 * "Texas" would fail a large share of real files for no good reason.
 */
const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  newhampshire: "NH", newjersey: "NJ", newmexico: "NM", newyork: "NY", northcarolina: "NC",
  northdakota: "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  rhodeisland: "RI", southcarolina: "SC", southdakota: "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", westvirginia: "WV",
  wisconsin: "WI", wyoming: "WY", districtofcolumbia: "DC",
};
const STATE_CODES = new Set(Object.values(US_STATES));

const state = (raw: string): CoercionResult => {
  const value = raw.trim();
  if (value === "") return { ok: true, value: "" };
  const upper = value.toUpperCase();
  if (STATE_CODES.has(upper)) return { ok: true, value: upper };
  const mapped = US_STATES[normalizeName(value)];
  if (mapped) return { ok: true, value: mapped };
  return { ok: false, error: `"${raw}" is not a US state` };
};

/**
 * Postal code kept as a string, never a number — 07030 must stay 07030.
 * Accepts ZIP and ZIP+4.
 */
const postalCode = (raw: string): CoercionResult => {
  const value = raw.trim();
  if (value === "") return { ok: true, value: "" };
  if (!/^\d{5}(-\d{4})?$/.test(value)) return { ok: false, error: `"${raw}" is not a 5-digit ZIP code` };
  return { ok: true, value };
};

/** Accepts ISO, US, and spreadsheet-serialised dates; stores ISO date-only. */
const date = (raw: string): CoercionResult => {
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { ok: true, value: `${iso[1]}-${iso[2]}-${iso[3]}` };
  const us = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    const month = Number(m);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false, error: `"${raw}" is not a valid date` };
    return { ok: true, value: `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  }
  return { ok: false, error: `"${raw}" is not a date (use YYYY-MM-DD)` };
};

const CURRENT_YEAR = new Date().getFullYear();

export const PROPERTY_FIELDS: TargetField[] = [
  {
    key: "name",
    label: "Property name",
    required: true,
    aliases: ["name", "property name", "store name", "site name", "location name", "property", "store", "location"],
    coerce: (raw) => (raw.trim() === "" ? { ok: false, error: "Required" } : text(200)(raw)),
  },
  {
    key: "customerPropertyId",
    label: "Customer property ID",
    required: false,
    aliases: ["customer property id", "property id", "store number", "store no", "store id", "site id", "location id", "customer id", "property code"],
    help: "Your own identifier for this property. The strongest signal for matching against existing records.",
    coerce: text(100),
  },
  {
    key: "externalIds",
    label: "External system IDs",
    required: false,
    aliases: ["external ids", "external id", "system ids", "source id"],
    help: 'e.g. "yardi=P-1052; angus=1052"',
    coerce: text(500),
  },
  {
    key: "addressLine1",
    label: "Address",
    required: true,
    aliases: ["address", "address line 1", "address1", "street", "street address", "addr"],
    coerce: (raw) => (raw.trim() === "" ? { ok: false, error: "Required" } : text(300)(raw)),
  },
  { key: "addressLine2", label: "Address line 2", required: false, aliases: ["address line 2", "address2", "suite", "unit"], coerce: text(300) },
  {
    key: "city",
    label: "City",
    required: true,
    aliases: ["city", "town", "municipality"],
    coerce: (raw) => (raw.trim() === "" ? { ok: false, error: "Required" } : text(120)(raw)),
  },
  {
    key: "state",
    label: "State",
    required: true,
    aliases: ["state", "province", "st", "state code"],
    coerce: (raw) => (raw.trim() === "" ? { ok: false, error: "Required" } : state(raw)),
  },
  {
    key: "postalCode",
    label: "Postal code",
    required: true,
    aliases: ["zip", "zip code", "postal code", "postcode", "zipcode"],
    coerce: (raw) => (raw.trim() === "" ? { ok: false, error: "Required" } : postalCode(raw)),
  },
  { key: "country", label: "Country", required: false, aliases: ["country"], coerce: text(60) },
  { key: "latitude", label: "Latitude", required: false, aliases: ["latitude", "lat"], coerce: decimal(-90, 90) },
  { key: "longitude", label: "Longitude", required: false, aliases: ["longitude", "lng", "lon", "long"], coerce: decimal(-180, 180) },
  { key: "propertyType", label: "Property type", required: false, aliases: ["property type", "type", "asset class", "category"], coerce: text(60) },
  { key: "squareFootage", label: "Square footage", required: false, aliases: ["square footage", "sq ft", "sqft", "square feet", "size", "gla", "area"], coerce: integer(0, 100_000_000) },
  { key: "yearBuilt", label: "Year built", required: false, aliases: ["year built", "built", "construction year", "year"], coerce: integer(1600, CURRENT_YEAR + 5) },
  { key: "portfolio", label: "Portfolio", required: false, aliases: ["portfolio", "portfolio name", "group"], help: "Matched to an existing portfolio by name. Rows without one go to the portfolio chosen for this import.", coerce: text(200) },
  { key: "region", label: "Region", required: false, aliases: ["region", "region name", "market", "district", "division"], coerce: text(200) },
];

export const ASSET_FIELDS: TargetField[] = [
  {
    key: "propertyRef",
    label: "Property (ID or name)",
    required: true,
    aliases: ["property", "property id", "customer property id", "store number", "store", "site", "location", "property name"],
    help: "Matched to a property by customer property ID first, then by name.",
    coerce: (raw) => (raw.trim() === "" ? { ok: false, error: "Required" } : text(200)(raw)),
  },
  {
    key: "name",
    label: "Asset name",
    required: true,
    aliases: ["asset name", "name", "equipment name", "description", "asset"],
    coerce: (raw) => (raw.trim() === "" ? { ok: false, error: "Required" } : text(200)(raw)),
  },
  {
    key: "assetType",
    label: "Asset type",
    required: true,
    aliases: ["asset type", "type", "equipment type", "category", "class"],
    coerce: (raw) => (raw.trim() === "" ? { ok: false, error: "Required" } : text(100)(raw)),
  },
  { key: "customerAssetId", label: "Customer asset ID", required: false, aliases: ["customer asset id", "asset id", "asset tag", "tag", "equipment id", "asset number"], coerce: text(100) },
  { key: "externalIds", label: "External system IDs", required: false, aliases: ["external ids", "external id", "system ids"], coerce: text(500) },
  { key: "manufacturer", label: "Manufacturer", required: false, aliases: ["manufacturer", "make", "brand", "oem"], coerce: text(120) },
  { key: "model", label: "Model", required: false, aliases: ["model", "model number", "model no"], coerce: text(120) },
  { key: "serialNumber", label: "Serial number", required: false, aliases: ["serial number", "serial", "serial no", "sn"], coerce: text(120) },
  { key: "installedAt", label: "Installed date", required: false, aliases: ["installed", "installed date", "install date", "installation date", "in service date"], coerce: date },
  { key: "expectedUsefulLifeYears", label: "Expected useful life (years)", required: false, aliases: ["expected useful life", "useful life", "eul", "life expectancy", "expected life"], coerce: integer(0, 200) },
  { key: "conditionScore", label: "Condition score (0-100)", required: false, aliases: ["condition", "condition score", "condition rating"], coerce: decimal(0, 100) },
  { key: "criticalityScore", label: "Criticality (1-5)", required: false, aliases: ["criticality", "criticality score", "priority", "importance"], coerce: integer(1, 5) },
  { key: "replacementCost", label: "Replacement cost", required: false, aliases: ["replacement cost", "replacement value", "cost", "value", "rcv"], help: "Currency amount; stored in cents.", coerce: money },
];

export function fieldsFor(entity: ImportEntity): TargetField[] {
  return entity === "PROPERTIES" ? PROPERTY_FIELDS : ASSET_FIELDS;
}

export function fieldMap(entity: ImportEntity): Map<string, TargetField> {
  return new Map(fieldsFor(entity).map((f) => [f.key, f]));
}

/**
 * Suggests a column -> field mapping from the header row (spec §68 "Field
 * mapping"). A suggestion, never a decision: the user confirms it in the UI
 * before anything is imported, because a wrong auto-map that nobody reviews
 * is worse than no auto-map at all.
 *
 * Exact alias match wins over a containment match, and each target field is
 * claimed at most once — otherwise "Property ID" and "Customer Property ID"
 * in the same file both map to the same target and one silently wins.
 */
export function suggestMapping(headers: string[], entity: ImportEntity): Record<string, string> {
  const fields = fieldsFor(entity);
  const mapping: Record<string, string> = {};
  const claimed = new Set<string>();

  const normalizedHeaders = headers.map((h) => ({ header: h, key: normalizeName(h) }));

  // Pass 1: exact alias equality.
  for (const { header, key } of normalizedHeaders) {
    if (key === "") continue;
    const match = fields.find((f) => !claimed.has(f.key) && f.aliases.some((a) => normalizeName(a) === key));
    if (match) {
      mapping[header] = match.key;
      claimed.add(match.key);
    }
  }

  // Pass 2: containment, longest alias first so "customer property id" beats
  // "property id" when both could match.
  for (const { header, key } of normalizedHeaders) {
    if (mapping[header] || key === "") continue;
    let best: { field: TargetField; length: number } | null = null;
    for (const field of fields) {
      if (claimed.has(field.key)) continue;
      for (const alias of field.aliases) {
        const normalizedAlias = normalizeName(alias);
        // Require a real overlap, not a one-character coincidence.
        if (normalizedAlias.length < 3) continue;
        if (key.includes(normalizedAlias) || normalizedAlias.includes(key)) {
          if (!best || normalizedAlias.length > best.length) best = { field, length: normalizedAlias.length };
        }
      }
    }
    if (best) {
      mapping[header] = best.field.key;
      claimed.add(best.field.key);
    }
  }

  return mapping;
}

export function missingRequiredFields(mapping: Record<string, string>, entity: ImportEntity): TargetField[] {
  const mapped = new Set(Object.values(mapping));
  return fieldsFor(entity).filter((f) => f.required && !mapped.has(f.key));
}
