import { describe, expect, it } from "vitest";
import { targetTierFor, tierRequiresRestore } from "@/lib/storage-tiering";
import { StorageTier } from "@/generated/prisma/client";

/**
 * `targetTierFor` is pure so the threshold arithmetic can be pinned down
 * without a database or an object store. Off-by-one behaviour at each
 * boundary is the whole substance of a tiering policy: the difference between
 * ">= 90 days" and "> 90 days" is a day's worth of storage class for every
 * object a customer owns.
 */

const POLICY = {
  infrequentAccessAfterDays: 90,
  archiveAfterDays: 365,
  deepArchiveAfterDays: 1095,
};

describe("targetTierFor", () => {
  it("leaves a brand-new object alone", () => {
    expect(targetTierFor(0, POLICY)).toBeNull();
  });

  it("leaves an object alone the day before it qualifies", () => {
    expect(targetTierFor(89, POLICY)).toBeNull();
  });

  it("moves to infrequent access exactly on the threshold day", () => {
    // Inclusive: an object is "90 days old" for the whole of day 90.
    expect(targetTierFor(90, POLICY)).toBe(StorageTier.INFREQUENT_ACCESS);
  });

  it("stays at infrequent access until the archive threshold", () => {
    expect(targetTierFor(364, POLICY)).toBe(StorageTier.INFREQUENT_ACCESS);
  });

  it("moves to archive exactly on its threshold day", () => {
    expect(targetTierFor(365, POLICY)).toBe(StorageTier.ARCHIVE);
  });

  it("moves to deep archive exactly on its threshold day", () => {
    expect(targetTierFor(1095, POLICY)).toBe(StorageTier.DEEP_ARCHIVE);
  });

  it("returns the coldest qualifying tier, not the first one matched", () => {
    // A very old object qualifies for all three; only the coldest is correct,
    // or it would walk one tier per run and be billed for each copy.
    expect(targetTierFor(99_999, POLICY)).toBe(StorageTier.DEEP_ARCHIVE);
  });

  it("treats a null threshold as 'never move there'", () => {
    const noDeep = { ...POLICY, deepArchiveAfterDays: null };
    expect(targetTierFor(99_999, noDeep)).toBe(StorageTier.ARCHIVE);

    const noneAtAll = {
      infrequentAccessAfterDays: null,
      archiveAfterDays: null,
      deepArchiveAfterDays: null,
    };
    expect(targetTierFor(99_999, noneAtAll)).toBeNull();
  });

  it("honours a policy that skips the middle tier entirely", () => {
    const skipIa = { ...POLICY, infrequentAccessAfterDays: null };
    expect(targetTierFor(100, skipIa)).toBeNull();
    expect(targetTierFor(365, skipIa)).toBe(StorageTier.ARCHIVE);
  });

  it("handles a zero-day threshold as immediately eligible", () => {
    expect(targetTierFor(0, { ...POLICY, infrequentAccessAfterDays: 0 })).toBe(
      StorageTier.INFREQUENT_ACCESS,
    );
  });
});

describe("tierRequiresRestore", () => {
  /**
   * This is the property that makes tiering a customer-visible trade rather
   * than a pure saving. Only the coldest tier costs a restore step; if this
   * ever returned true for ARCHIVE the UI would start demanding restores for
   * objects that are directly readable.
   */
  it("is true only for deep archive", () => {
    expect(tierRequiresRestore(StorageTier.STANDARD)).toBe(false);
    expect(tierRequiresRestore(StorageTier.INFREQUENT_ACCESS)).toBe(false);
    expect(tierRequiresRestore(StorageTier.ARCHIVE)).toBe(false);
    expect(tierRequiresRestore(StorageTier.DEEP_ARCHIVE)).toBe(true);
  });
});
