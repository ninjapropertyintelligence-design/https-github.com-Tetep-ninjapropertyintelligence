import {
  normalizeAddress,
  normalizeExternalIds,
  normalizeIdentifier,
  normalizeName,
  normalizePostalCode,
} from "@/lib/import/normalize";

/**
 * Duplicate detection (spec §69). The spec names four signals — customer
 * property ID, address, external IDs, matching rules — and this ranks them
 * by how much trust each deserves.
 *
 * Every match carries a *reason*, not just a score. "This looks like a
 * duplicate" is not actionable; "same customer property ID (STORE-1052)"
 * lets a human confirm or reject it in one glance, which is what the
 * preview step (§68) exists for.
 *
 * Pure functions, no database access — `findMatches` takes the candidate
 * set as an argument so the rules can be tested exhaustively.
 */

export type MatchRule =
  | "CUSTOMER_PROPERTY_ID"
  | "EXTERNAL_ID"
  | "ADDRESS"
  | "NAME_AND_LOCATION"
  | "NAME_ONLY";

export interface MatchEvidence {
  rule: MatchRule;
  confidence: number;
  detail: string;
}

export interface DedupCandidate {
  id: string;
  name: string;
  customerPropertyId: string | null;
  externalIds: unknown;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
}

/** The shape an import row is reduced to before matching. */
export interface DedupSubject {
  name: string;
  customerPropertyId?: string | null;
  externalIds?: Array<{ system: string; id: string }>;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

export interface DedupMatch {
  candidateId: string;
  candidateName: string;
  /** Highest-confidence rule that fired. */
  best: MatchEvidence;
  /** Every rule that fired, so the reviewer sees the full picture. */
  evidence: MatchEvidence[];
}

/**
 * At or above this, the row is treated as the same property — safe to update
 * in place rather than create a second one.
 */
export const DUPLICATE_THRESHOLD = 0.85;
/**
 * Between REVIEW_THRESHOLD and DUPLICATE_THRESHOLD the import stops and asks.
 * A name collision alone lands here: two genuinely different stores can share
 * a name across regions, so auto-merging on it would silently destroy data.
 */
export const REVIEW_THRESHOLD = 0.6;

export type DedupVerdict = "NEW" | "NEEDS_REVIEW" | "DUPLICATE";

export function verdictFor(match: DedupMatch | null): DedupVerdict {
  if (!match) return "NEW";
  if (match.best.confidence >= DUPLICATE_THRESHOLD) return "DUPLICATE";
  if (match.best.confidence >= REVIEW_THRESHOLD) return "NEEDS_REVIEW";
  return "NEW";
}

/** Precomputed keys for one candidate, so an N-row import is not O(N*M) work. */
interface CandidateKeys {
  candidate: DedupCandidate;
  customerId: string;
  externalIds: Set<string>;
  name: string;
  address: string;
  postal: string;
  cityState: string;
}

export function indexCandidates(candidates: DedupCandidate[]): CandidateKeys[] {
  return candidates.map((candidate) => ({
    candidate,
    customerId: candidate.customerPropertyId ? normalizeIdentifier(candidate.customerPropertyId) : "",
    externalIds: new Set(normalizeExternalIds(candidate.externalIds)),
    name: normalizeName(candidate.name),
    address: normalizeAddress(candidate.addressLine1),
    postal: normalizePostalCode(candidate.postalCode),
    cityState: `${normalizeName(candidate.city)}|${normalizeName(candidate.state)}`,
  }));
}

/**
 * Returns every candidate that matched, strongest first. Returning all of
 * them (rather than only the best) matters when an import row collides with
 * two existing properties — that is a data-quality problem the customer
 * needs to see, not something to silently pick a winner for.
 */
export function findMatches(subject: DedupSubject, index: CandidateKeys[]): DedupMatch[] {
  const subjectCustomerId = subject.customerPropertyId ? normalizeIdentifier(subject.customerPropertyId) : "";
  const subjectExternal = new Set(
    (subject.externalIds ?? [])
      .filter((e) => e.id?.trim())
      .map((e) => `${normalizeIdentifier(e.system)}:${normalizeIdentifier(e.id)}`),
  );
  const subjectName = normalizeName(subject.name ?? "");
  const subjectAddress = normalizeAddress(subject.addressLine1 ?? "");
  const subjectPostal = normalizePostalCode(subject.postalCode ?? "");
  const subjectCityState = `${normalizeName(subject.city ?? "")}|${normalizeName(subject.state ?? "")}`;

  const matches: DedupMatch[] = [];

  for (const entry of index) {
    const evidence: MatchEvidence[] = [];

    // 1. Customer property ID — §69 lists it first and §70 makes it an
    // identity field. If both sides carry one and they agree, that is the
    // customer telling us these are the same property.
    if (subjectCustomerId && entry.customerId && subjectCustomerId === entry.customerId) {
      evidence.push({
        rule: "CUSTOMER_PROPERTY_ID",
        confidence: 1,
        detail: `Same customer property ID (${subject.customerPropertyId})`,
      });
    }

    // 2. A shared external system ID.
    for (const key of subjectExternal) {
      if (entry.externalIds.has(key)) {
        evidence.push({ rule: "EXTERNAL_ID", confidence: 0.95, detail: `Shared external ID (${key})` });
        break;
      }
    }

    // 3. Address + ZIP. Strong, because a building has one street address.
    if (subjectAddress && subjectAddress === entry.address && subjectPostal && subjectPostal === entry.postal) {
      evidence.push({
        rule: "ADDRESS",
        confidence: 0.9,
        detail: `Same address (${subject.addressLine1}, ${subject.postalCode})`,
      });
    }

    // 4. Name plus city/state. This is the rule that catches the spec's
    // "Store 1052 / Store #1052 / Store-1052" case when no ID is supplied.
    if (subjectName && subjectName === entry.name && subjectCityState !== "|" && subjectCityState === entry.cityState) {
      evidence.push({
        rule: "NAME_AND_LOCATION",
        confidence: 0.88,
        detail: `Same name and city (${entry.candidate.name}, ${entry.candidate.city})`,
      });
    }

    // 5. Name alone. Deliberately below the auto-merge threshold: two real
    // stores in different states can share a name.
    if (subjectName && subjectName === entry.name) {
      evidence.push({
        rule: "NAME_ONLY",
        confidence: 0.6,
        detail: `Same name as an existing property (${entry.candidate.name})`,
      });
    }

    if (evidence.length > 0) {
      evidence.sort((a, b) => b.confidence - a.confidence);
      matches.push({ candidateId: entry.candidate.id, candidateName: entry.candidate.name, best: evidence[0], evidence });
    }
  }

  matches.sort((a, b) => b.best.confidence - a.best.confidence);
  return matches;
}

/**
 * Duplicates *within the uploaded file itself*. A spreadsheet listing the
 * same store twice under two spellings is at least as common as one that
 * collides with existing data, and importing it would create exactly the
 * three-properties-for-one-store outcome §69 is about.
 */
export function findIntraFileDuplicates(subjects: DedupSubject[]): Map<number, number> {
  const firstSeen = new Map<string, number>();
  const duplicates = new Map<number, number>();

  subjects.forEach((subject, rowIndex) => {
    for (const key of identityKeysFor(subject)) {
      const existing = firstSeen.get(key);
      if (existing !== undefined) {
        // Point at the earliest row so a reviewer sees one canonical row
        // plus its repeats, rather than a chain.
        if (!duplicates.has(rowIndex)) duplicates.set(rowIndex, existing);
      } else {
        firstSeen.set(key, rowIndex);
      }
    }
  });

  return duplicates;
}

/**
 * The keys under which a row claims an identity. Two rows sharing any one of
 * these are the same property — matching the rule priority above, minus
 * name-only, which is too weak to merge on without review.
 */
function identityKeysFor(subject: DedupSubject): string[] {
  const keys: string[] = [];
  if (subject.customerPropertyId?.trim()) {
    keys.push(`cid:${normalizeIdentifier(subject.customerPropertyId)}`);
  }
  for (const external of subject.externalIds ?? []) {
    if (external.id?.trim()) keys.push(`ext:${normalizeIdentifier(external.system)}:${normalizeIdentifier(external.id)}`);
  }
  const address = normalizeAddress(subject.addressLine1 ?? "");
  const postal = normalizePostalCode(subject.postalCode ?? "");
  if (address && postal) keys.push(`addr:${address}|${postal}`);

  const name = normalizeName(subject.name ?? "");
  const city = normalizeName(subject.city ?? "");
  if (name && city) keys.push(`namecity:${name}|${city}`);

  return keys;
}
