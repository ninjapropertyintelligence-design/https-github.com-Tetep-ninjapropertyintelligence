import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import {
  createExpiry,
  dismissExpiry,
  listExpiries,
  renewExpiry,
  runExpiryReminders,
  updateExpiry,
} from "@/lib/expiry-service";
import { readExpiryTag } from "@/lib/ai/expiry-reader";
import { createEvidence } from "@/lib/evidence-service";
import { getStorageProvider } from "@/lib/storage";
import { __setAIProviderForTest } from "@/lib/ai/provider-factory";
import type { AIProvider } from "@/lib/ai/provider";
import { NullProvider } from "@/lib/ai/providers/null-provider";
import { setEmailProviderForTesting, type EmailMessage } from "@/lib/email";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Expiry tracking. What goes wrong without these rules: a reminder sent
 * twice because two runs overlapped; a store nobody looks after being marked
 * as told; an email per item instead of one per store; a changed date still
 * counting down from the old one; a contractor emailed without anyone asking;
 * and a date misread off a tag being trusted as if a person had entered it.
 */

const suffix = `ex${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NOW = new Date("2026-12-01T13:00:00Z"); // 7 AM in Chicago, Dec 1
let sent: EmailMessage[] = [];

let org: { id: string };
let otherOrg: { id: string };
let store: { id: string };
let otherStore: { id: string };
let emptyStore: { id: string };
let owner: { id: string; email: string };
let viewer: { id: string };
let vendorUser: { id: string };
let inspector: { id: string };
let asset: { id: string };
let vendor: { id: string };

function ctx(userId: string, role: Role, extra: Partial<SessionContext> = {}): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Expiry Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
    ...extra,
  };
}
const asOwner = () => ctx(owner.id, Role.OWNER);
const asViewer = () => ctx(viewer.id, Role.VIEWER);
const asVendor = () => ctx(vendorUser.id, Role.VENDOR, { vendorId: "v" });
const asInspector = () =>
  ctx(inspector.id, Role.INSPECTOR, { grants: [{ scopeType: "PROPERTY", propertyId: store.id, portfolioId: null, regionId: null }] });

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** An expiry written straight to the table, so a test controls its dates and state. */
function item(data: { propertyId?: string; assetId?: string | null; kind?: string; expiresAt: string } & Record<string, unknown>) {
  const { propertyId, expiresAt, kind, assetId, ...rest } = data;
  return prisma.expiryItem.create({
    data: {
      organizationId: org.id,
      propertyId: propertyId ?? store.id,
      assetId: assetId ?? null,
      kind: kind ?? "Fire extinguisher inspection",
      expiresAt: day(expiresAt),
      ...rest,
    },
  });
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `EX ${suffix}`, slug: `ex-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `EX other ${suffix}`, slug: `ex-o-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const pfOther = await prisma.portfolio.create({ data: { organizationId: otherOrg.id, name: "PF2" } });
  const mk = (organizationId: string, portfolioId: string, name: string) =>
    prisma.property.create({
      data: { organizationId, portfolioId, name: `${name}-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
    });
  store = await mk(org.id, pf.id, "store");
  otherStore = await mk(org.id, pf.id, "other-store");
  emptyStore = await mk(otherOrg.id, pfOther.id, "nobody-home");
  const user = (label: string) => prisma.user.create({ data: { email: `${label}-${suffix}@example.com`, name: label, passwordHash: "x" } });
  owner = await user("owner");
  viewer = await user("viewer");
  vendorUser = await user("vendor");
  inspector = await user("inspector");
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });
  asset = await prisma.asset.create({
    data: { organizationId: org.id, propertyId: store.id, name: "Extinguisher by the back door", assetType: "Fire extinguisher" },
  });
  vendor = await prisma.vendor.create({
    data: {
      organizationId: org.id,
      name: "SafeHood",
      trade: "Fire suppression",
      contactName: "Priya",
      contactEmail: `office-${suffix}@safehood.example`,
      contactPhone: "(913) 555-0163",
      servesAllProperties: true,
    },
  });
});

beforeEach(async () => {
  sent = [];
  setEmailProviderForTesting({ name: "recording", send: async (m) => void sent.push(m) });
  await prisma.expiryItem.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
  await prisma.notification.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } });
  await prisma.asset.update({ where: { id: asset.id }, data: { serviceVendorId: null } });
});

afterEach(() => {
  __setAIProviderForTest(null);
  setEmailProviderForTesting({ name: "silent", send: async () => {} });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, viewer.id, vendorUser.id, inspector.id] } } });
});

describe("recording and changing expirations", () => {
  it("files an expiry under the equipment's store, and refuses a viewer", async () => {
    const created = await createExpiry(asOwner(), { assetId: asset.id, kind: "Fire extinguisher inspection", expiresAt: "2027-03-31" });
    expect(created.propertyId).toBe(store.id);
    expect(created.source).toBe("MANUAL");
    await expect(createExpiry(asViewer(), { assetId: asset.id, kind: "X", expiresAt: "2027-03-31" })).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a bad date, a missing target, and a store the manager cannot see", async () => {
    await expect(createExpiry(asOwner(), { propertyId: store.id, kind: "X", expiresAt: "2027-02-30" })).rejects.toThrow();
    await expect(createExpiry(asOwner(), { kind: "X", expiresAt: "2027-03-31" })).rejects.toThrow();
    await expect(createExpiry(asOwner(), { propertyId: emptyStore.id, kind: "X", expiresAt: "2027-03-31" })).rejects.toMatchObject({ status: 404 });
  });

  it("keeps a contractor's own login out of the list", async () => {
    await expect(listExpiries(asVendor())).rejects.toMatchObject({ status: 403 });
  });

  it("counts down from the store's today, soonest first", async () => {
    await item({ expiresAt: "2026-12-11", kind: "Health permit" });
    await item({ expiresAt: "2026-11-28", kind: "Hood cleaning" });
    const list = await listExpiries(asOwner(), { now: NOW });
    expect(list.map((i) => [i.kind, i.daysLeft, i.urgency])).toEqual([
      ["Hood cleaning", -3, "expired"],
      ["Health permit", 10, "urgent"],
    ]);
  });

  it("starts a new countdown when the date changes, and treats the person's date as checked", async () => {
    const read = await item({ expiresAt: "2026-12-20", lastReminderDays: 30, lastOverdueNoticeAt: NOW, needsReview: true, source: "AI_PHOTO" });
    const updated = await updateExpiry(asOwner(), read.id, { expiresAt: "2027-12-20" });
    expect(updated.lastReminderDays).toBeNull();
    expect(updated.lastOverdueNoticeAt).toBeNull();
    expect(updated.needsReview).toBe(false);
  });

  it("confirming a read date clears the flag and leaves the countdown alone", async () => {
    const read = await item({ expiresAt: "2026-12-20", lastReminderDays: 30, needsReview: true, source: "AI_PHOTO" });
    const updated = await updateExpiry(asOwner(), read.id, { confirmed: true });
    expect(updated.needsReview).toBe(false);
    expect(updated.lastReminderDays).toBe(30);
  });

  it("renews by keeping the old record and starting a new one", async () => {
    const old = await item({ assetId: asset.id, expiresAt: "2026-12-20", label: "back door", notifyContractor: true });
    await expect(renewExpiry(asOwner(), old.id, { expiresAt: "2026-12-01" })).rejects.toMatchObject({ status: 400 });
    const renewed = await renewExpiry(asOwner(), old.id, { expiresAt: "2027-12-20" });
    expect(renewed.status).toBe("ACTIVE");
    expect(renewed.label).toBe("back door");
    expect(renewed.notifyContractor).toBe(true);
    expect(renewed.lastReminderDays).toBeNull();
    expect((await prisma.expiryItem.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("RENEWED");
    await expect(renewExpiry(asOwner(), old.id, { expiresAt: "2028-12-20" })).rejects.toMatchObject({ status: 409 });
  });

  it("stops reminding about something dismissed", async () => {
    const gone = await item({ expiresAt: "2026-12-05" });
    await dismissExpiry(asOwner(), gone.id);
    const run = await runExpiryReminders({ now: NOW });
    expect(run.reminded).toBe(0);
    expect(await prisma.notification.count({ where: { organizationId: org.id } })).toBe(0);
  });
});

describe("the daily reminders", () => {
  it("tells the people responsible, in the app and by email, once per threshold", async () => {
    const i = await item({ expiresAt: "2026-12-21", kind: "Hood suppression (Ansul) inspection" }); // 20 days: the 30-day notice
    const first = await runExpiryReminders({ now: NOW });
    expect(first.reminded).toBe(1);

    const rows = await prisma.notification.findMany({ where: { organizationId: org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: owner.id, type: "EXPIRY_UPCOMING" });
    expect(rows[0].title).toContain("Hood suppression (Ansul) inspection");
    expect(sent.map((m) => m.to)).toEqual([owner.email]);
    expect((await prisma.expiryItem.findUniqueOrThrow({ where: { id: i.id } })).lastReminderDays).toBe(30);

    // The same day, again: nothing more.
    const second = await runExpiryReminders({ now: NOW });
    expect(second.reminded).toBe(0);
    expect(await prisma.notification.count({ where: { organizationId: org.id } })).toBe(1);

    // A week and a half on it is 10 days out: the 14-day notice.
    const later = await runExpiryReminders({ now: new Date("2026-12-11T13:00:00Z") });
    expect(later.reminded).toBe(1);
    expect((await prisma.expiryItem.findUniqueOrThrow({ where: { id: i.id } })).lastReminderDays).toBe(14);
  });

  it("sends one notice per store, listing everything, not one per item", async () => {
    await item({ expiresAt: "2026-12-10", kind: "Health permit" });
    await item({ expiresAt: "2026-12-12", kind: "Backflow preventer test" });
    await item({ expiresAt: "2026-12-14", kind: "Grease trap service", propertyId: otherStore.id });
    const run = await runExpiryReminders({ now: NOW });
    expect(run.reminded).toBe(3);
    const rows = await prisma.notification.findMany({ where: { organizationId: org.id }, orderBy: { title: "asc" } });
    expect(rows).toHaveLength(2); // two stores
    const forStore = rows.find((r) => r.title.startsWith("2 items"));
    expect(forStore?.body).toContain("Health permit");
    expect(forStore?.body).toContain("Backflow preventer test");
    expect(sent).toHaveLength(2);
  });

  it("tells them what has expired, then again weekly, never daily", async () => {
    const lapsed = await item({ expiresAt: "2026-11-28", kind: "Hood cleaning" });
    expect((await runExpiryReminders({ now: NOW })).overdue).toBe(1);
    expect((await prisma.notification.findFirstOrThrow({ where: { organizationId: org.id } })).type).toBe("EXPIRY_OVERDUE");

    expect((await runExpiryReminders({ now: new Date("2026-12-05T13:00:00Z") })).reminded).toBe(0);
    expect((await runExpiryReminders({ now: new Date("2026-12-08T13:00:00Z") })).overdue).toBe(1);
    expect(await prisma.notification.count({ where: { organizationId: org.id } })).toBe(2);

    // Renewing ends it.
    await renewExpiry(asOwner(), lapsed.id, { expiresAt: "2027-11-28" });
    expect((await runExpiryReminders({ now: new Date("2026-12-15T13:00:00Z") })).reminded).toBe(0);
  });

  it("does not send the same reminder twice when two runs overlap", async () => {
    await item({ expiresAt: "2026-12-08" });
    await Promise.all([runExpiryReminders({ now: NOW }), runExpiryReminders({ now: NOW })]);
    expect(await prisma.notification.count({ where: { organizationId: org.id } })).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("does not mark a store nobody is responsible for as told", async () => {
    const orphan = await prisma.expiryItem.create({
      data: { organizationId: otherOrg.id, propertyId: emptyStore.id, kind: "Health permit", expiresAt: day("2026-12-05") },
    });
    const run = await runExpiryReminders({ now: NOW });
    expect(run.noRecipients).toBe(1);
    expect((await prisma.expiryItem.findUniqueOrThrow({ where: { id: orphan.id } })).lastReminderDays).toBeNull();
    // Someone is given the store; the next run tells them.
    const admin = await prisma.user.create({ data: { email: `late-${suffix}@example.com`, name: "Late", passwordHash: "x" } });
    await prisma.membership.create({ data: { userId: admin.id, organizationId: otherOrg.id, role: Role.OWNER } });
    expect((await runExpiryReminders({ now: NOW })).reminded).toBe(1);
    await prisma.user.delete({ where: { id: admin.id } });
  });

  it("respects a person's email opt-out but still records the in-app notice", async () => {
    await prisma.notificationPreference.create({ data: { userId: owner.id, type: "EXPIRY_UPCOMING", email: false } });
    await item({ expiresAt: "2026-12-08" });
    await runExpiryReminders({ now: NOW });
    expect(await prisma.notification.count({ where: { organizationId: org.id, userId: owner.id } })).toBe(1);
    expect(sent).toHaveLength(0);
    await prisma.notificationPreference.deleteMany({ where: { userId: owner.id } });
  });

  it("names the contractor to call, and emails them only if asked", async () => {
    await prisma.asset.update({ where: { id: asset.id }, data: { serviceVendorId: vendor.id } });
    await item({ assetId: asset.id, expiresAt: "2026-12-08" });
    await runExpiryReminders({ now: NOW });
    expect(sent.map((m) => m.to)).toEqual([owner.email]); // not the contractor
    expect((await prisma.notification.findFirstOrThrow({ where: { organizationId: org.id } })).body).toContain("Call SafeHood (913) 555-0163");

    await prisma.expiryItem.deleteMany({ where: { organizationId: org.id } });
    await prisma.notification.deleteMany({ where: { organizationId: org.id } });
    sent = [];
    await item({ assetId: asset.id, expiresAt: "2026-12-08", notifyContractor: true });
    const run = await runExpiryReminders({ now: NOW });
    expect(run.contractorEmails).toBe(1);
    const toVendor = sent.find((m) => m.to === `office-${suffix}@safehood.example`);
    expect(toVendor?.text).toContain("Fire extinguisher inspection");
    expect(toVendor?.text).toContain("Hi Priya");
  });

  it("says when a date was read by a model and not yet checked", async () => {
    await item({ expiresAt: "2026-12-08", needsReview: true, source: "AI_PHOTO" });
    await runExpiryReminders({ now: NOW });
    expect((await prisma.notification.findFirstOrThrow({ where: { organizationId: org.id } })).body).toContain("please check the date");
  });
});

/* -------------------------------------------------- reading a photographed tag */

function fakeProvider(output: unknown): AIProvider & { calls: number } {
  const p = {
    name: "fake",
    calls: 0,
    supportsVision: () => true,
    supportsStructuredOutput: () => true,
    generateResponse: async () => "",
    runToolLoop: async () => ({ answer: "", toolCalls: [] }),
    analyzeImage: async () => {
      p.calls += 1;
      return { output, usage: { inputTokens: 900, outputTokens: 80 } };
    },
  };
  return p;
}

const TAG = {
  isTagReadable: true,
  kind: "Fire extinguisher inspection",
  otherKind: "",
  expiryYear: 2027,
  expiryMonth: 3,
  expiryDay: 0,
  lastInspectedYear: 2026,
  lastInspectedMonth: 3,
  lastInspectedDay: 12,
  servicedBy: "SafeHood Fire & Grease",
  confidence: 0.92,
  notes: "March 2027 punched.",
};

async function tagPhoto(opts: { type?: "PHOTO" | "IMAGE_360"; mimeType?: string; propertyId?: string } = {}) {
  const key = `${org.id}/${suffix}/${Math.random().toString(36).slice(2)}.jpg`;
  await getStorageProvider().writeBytes(key, Buffer.from("fake-jpeg-bytes"));
  if (opts.type === "IMAGE_360") {
    // Registering a panorama through the service needs the 360 feature on the
    // plan; the row itself is all this test needs.
    return prisma.evidence.create({
      data: {
        organizationId: org.id,
        propertyId: opts.propertyId ?? store.id,
        assetId: asset.id,
        type: "IMAGE_360",
        storageKey: key,
        mimeType: "image/jpeg",
        uploadedById: owner.id,
      },
    });
  }
  return createEvidence(asOwner(), {
    type: opts.type ?? "PHOTO",
    storageKey: key,
    mimeType: opts.mimeType ?? "image/jpeg",
    sizeBytes: 15,
    propertyId: opts.propertyId ?? store.id,
    assetId: asset.id,
  });
}

describe("reading a tag from a photo", () => {
  it("records the date, treating month-and-year as good through the month's end, and flags it for a check", async () => {
    const provider = fakeProvider(TAG);
    __setAIProviderForTest(provider);
    const photo = await tagPhoto();
    const result = await readExpiryTag(asOwner(), { assetId: asset.id, evidenceId: photo.id });
    expect(result).toMatchObject({ created: true, alreadyExpired: false });
    const saved = await prisma.expiryItem.findFirstOrThrow({ where: { assetId: asset.id } });
    expect(saved).toMatchObject({
      kind: "Fire extinguisher inspection",
      source: "AI_PHOTO",
      needsReview: true,
      confidence: 0.92,
      evidenceId: photo.id,
      servicedBy: "SafeHood Fire & Grease",
      propertyId: store.id,
    });
    expect(saved.expiresAt).toEqual(day("2027-03-31"));
    expect(saved.lastInspectedAt).toEqual(day("2026-03-12"));
    // Metered, like every other AI call.
    expect(await prisma.usageRecord.count({ where: { organizationId: org.id, source: "expiry-read" } })).toBeGreaterThanOrEqual(1);
  });

  it("does not track the same tag twice", async () => {
    __setAIProviderForTest(fakeProvider(TAG));
    const a = await tagPhoto();
    const b = await tagPhoto();
    await readExpiryTag(asOwner(), { assetId: asset.id, evidenceId: a.id });
    const again = await readExpiryTag(asOwner(), { assetId: asset.id, evidenceId: b.id });
    expect(again).toMatchObject({ created: false, reason: "duplicate" });
    expect(await prisma.expiryItem.count({ where: { assetId: asset.id } })).toBe(1);
  });

  it("saves nothing it cannot read, and says so", async () => {
    __setAIProviderForTest(fakeProvider({ ...TAG, isTagReadable: false, notes: "Glare over the date." }));
    const photo = await tagPhoto();
    const result = await readExpiryTag(asOwner(), { assetId: asset.id, evidenceId: photo.id });
    expect(result).toMatchObject({ created: false, reason: "unreadable", message: "Glare over the date." });
    expect(await prisma.expiryItem.count({ where: { assetId: asset.id } })).toBe(0);
  });

  it("saves nothing when the model is guessing", async () => {
    __setAIProviderForTest(fakeProvider({ ...TAG, confidence: 0.3 }));
    const photo = await tagPhoto();
    const result = await readExpiryTag(asOwner(), { assetId: asset.id, evidenceId: photo.id });
    expect(result).toMatchObject({ created: false, reason: "low_confidence" });
    expect(await prisma.expiryItem.count({ where: { assetId: asset.id } })).toBe(0);
  });

  it("does not turn an inspection date into a due date", async () => {
    __setAIProviderForTest(fakeProvider({ ...TAG, expiryYear: 0, expiryMonth: 0, expiryDay: 0 }));
    const photo = await tagPhoto();
    const result = await readExpiryTag(asOwner(), { assetId: asset.id, evidenceId: photo.id });
    expect(result).toMatchObject({ created: false, reason: "no_date", reading: { expiresOn: null, lastInspectedOn: "2026-03-12" } });
    expect(await prisma.expiryItem.count({ where: { assetId: asset.id } })).toBe(0);
  });

  it("refuses an impossible date from the model", async () => {
    __setAIProviderForTest(fakeProvider({ ...TAG, expiryYear: 2027, expiryMonth: 2, expiryDay: 30 }));
    const photo = await tagPhoto();
    expect(await readExpiryTag(asOwner(), { assetId: asset.id, evidenceId: photo.id })).toMatchObject({ created: false, reason: "no_date" });
  });

  it("records an already-expired tag as expired", async () => {
    __setAIProviderForTest(fakeProvider({ ...TAG, expiryYear: 2025, expiryMonth: 6, expiryDay: 15 }));
    const photo = await tagPhoto();
    expect(await readExpiryTag(asOwner(), { assetId: asset.id, evidenceId: photo.id })).toMatchObject({ created: true, alreadyExpired: true });
  });

  it("will not read a 360 panorama, and says why", async () => {
    const provider = fakeProvider(TAG);
    __setAIProviderForTest(provider);
    const pano = await tagPhoto({ type: "IMAGE_360" });
    await expect(readExpiryTag(asOwner(), { assetId: asset.id, evidenceId: pano.id })).rejects.toMatchObject({ status: 400 });
    expect(provider.calls).toBe(0);
  });

  it("will not use a photo from another store, or let a viewer or a contractor read tags", async () => {
    const provider = fakeProvider(TAG);
    __setAIProviderForTest(provider);
    const photo = await tagPhoto();
    const elsewhere = await prisma.evidence.create({
      data: {
        organizationId: org.id,
        propertyId: otherStore.id,
        type: "PHOTO",
        storageKey: photo.storageKey,
        mimeType: "image/jpeg",
        uploadedById: owner.id,
      },
    });
    await expect(readExpiryTag(asOwner(), { assetId: asset.id, evidenceId: elsewhere.id })).rejects.toMatchObject({ status: 404 });
    await expect(readExpiryTag(asViewer(), { assetId: asset.id, evidenceId: photo.id })).rejects.toMatchObject({ status: 403 });
    await expect(readExpiryTag(asVendor(), { assetId: asset.id, evidenceId: photo.id })).rejects.toMatchObject({ status: 403 });
    expect(provider.calls).toBe(0);
  });

  it("lets an inspector out photographing tags record them", async () => {
    __setAIProviderForTest(fakeProvider(TAG));
    const photo = await tagPhoto();
    expect(await readExpiryTag(asInspector(), { assetId: asset.id, evidenceId: photo.id })).toMatchObject({ created: true });
  });

  it("says plainly when no AI provider is set up", async () => {
    __setAIProviderForTest(new NullProvider("anthropic"));
    const photo = await tagPhoto();
    await expect(readExpiryTag(asOwner(), { assetId: asset.id, evidenceId: photo.id })).rejects.toMatchObject({ status: 503 });
  });

  it("rejects an answer in the wrong shape", async () => {
    __setAIProviderForTest(fakeProvider({ nonsense: true }));
    const photo = await tagPhoto();
    await expect(readExpiryTag(asOwner(), { assetId: asset.id, evidenceId: photo.id })).rejects.toMatchObject({ status: 502 });
  });
});
