import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { getComplianceReportData } from "@/lib/reports/compliance-report-data";
import { renderComplianceReportPdf } from "@/lib/reports/pdf-renderer";
import { getPropertyOnboardingStatus } from "@/lib/property-onboarding-status";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * The compliance and inspection record is handed to an insurer, so what goes
 * wrong without these rules is serious: a date read by software shown as if a
 * person had checked it; another store's items on this store's record; a
 * renewed or dismissed item still shown as current; and a contractor's login
 * generating the record.
 */

const suffix = `cr${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NOW = new Date("2026-12-01T13:00:00Z"); // Dec 1 in Chicago
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let org: { id: string };
let store: { id: string };
let other: { id: string };
let owner: { id: string };
let vendorUser: { id: string };
let hood: { id: string };
let vendor: { id: string };

function ctx(userId: string, role: Role): SessionContext {
  return {
    userId,
    userName: "Someone",
    userEmail: "x@example.com",
    isPlatformAdmin: false,
    organizationId: org.id,
    organizationName: "Compliance Org",
    membershipId: "irrelevant",
    role,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}
const asOwner = () => ctx(owner.id, Role.OWNER);
const asVendor = () => ctx(vendorUser.id, Role.VENDOR);

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `CR ${suffix}`, slug: `cr-${suffix}` } });
  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const mk = (name: string) =>
    prisma.property.create({
      data: { organizationId: org.id, portfolioId: pf.id, name: `${name}-${suffix}`, addressLine1: "1 Main", city: "Lenexa", state: "KS", postalCode: "66219" },
    });
  store = await mk("store");
  other = await mk("other");
  const user = (label: string) => prisma.user.create({ data: { email: `${label}-${suffix}@example.com`, name: label, passwordHash: "x" } });
  owner = await user("owner");
  vendorUser = await user("vendor");
  vendor = await prisma.vendor.create({
    data: { organizationId: org.id, name: "SafeHood", trade: "Hood cleaning", contactName: "Priya", contactPhone: "(913) 555-0163", emergencyPhone: "(913) 555-0164", servesAllProperties: true },
  });
  hood = await prisma.asset.create({
    data: {
      organizationId: org.id,
      propertyId: store.id,
      name: "Exhaust hood",
      assetType: "Exhaust Hood",
      manufacturer: "Captiveaire",
      model: "5424",
      serialNumber: "SN-123",
      serviceVendorId: vendor.id,
    },
  });
  const photo = await prisma.evidence.create({
    data: { organizationId: org.id, propertyId: store.id, assetId: hood.id, type: "PHOTO", storageKey: `${org.id}/${suffix}/t.jpg`, mimeType: "image/jpeg", uploadedById: owner.id },
  });
  const item = (data: Record<string, unknown> & { expiresAt: string }) => {
    const { expiresAt, ...rest } = data;
    return prisma.expiryItem.create({ data: { organizationId: org.id, propertyId: store.id, kind: "Fire extinguisher inspection", expiresAt: day(expiresAt), ...rest } });
  };
  await item({ expiresAt: "2026-11-20", kind: "Hood cleaning", assetId: hood.id, servicedBy: "SafeHood" }); // expired 11 days
  await item({ expiresAt: "2026-12-20", kind: "Fire extinguisher inspection", label: "By the fryers", source: "AI_PHOTO", needsReview: true, evidenceId: photo.id }); // due soon, unchecked
  await item({ expiresAt: "2027-06-15", kind: "Health permit", source: "MANUAL", evidenceId: photo.id }); // current
  await item({ expiresAt: "2026-10-01", kind: "Backflow test", status: "RENEWED" }); // renewed: not current
  await item({ expiresAt: "2026-12-05", kind: "Grease trap", status: "DISMISSED" }); // dismissed: not on the record
  await prisma.expiryItem.create({ data: { organizationId: org.id, propertyId: other.id, kind: "Other store's permit", expiresAt: day("2026-12-10") } });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, vendorUser.id] } } });
});

describe("the compliance record's data", () => {
  it("lists what is current, due soon and expired, soonest first, for this store only", async () => {
    const data = await getComplianceReportData(asOwner(), store.id, NOW);
    expect(data.register.map((r) => [r.kind, r.status])).toEqual([
      ["Hood cleaning", "Expired"],
      ["Fire extinguisher inspection", "Due soon"],
      ["Health permit", "Current"],
    ]);
    expect(data.summary).toEqual({ tracked: 3, current: 1, dueSoon: 1, expired: 1, unconfirmed: 1 });
    expect(data.asOf).toBe("2026-12-01");
  });

  it("says how each date came to be on record, and never calls an unchecked one verified", async () => {
    const data = await getComplianceReportData(asOwner(), store.id, NOW);
    const by = Object.fromEntries(data.register.map((r) => [r.kind, r]));
    expect(by["Fire extinguisher inspection"].basis).toBe("Read from a photo by software; not yet confirmed by a person");
    expect(by["Health permit"].basis).toBe("Entered by a person; photo of the tag on file");
    expect(by["Hood cleaning"].basis).toBe("Entered by a person");
    expect(by["Fire extinguisher inspection"].photoOnFile).toBe(true);
  });

  it("leaves out renewed and dismissed items, and shows the renewal in the history", async () => {
    const data = await getComplianceReportData(asOwner(), store.id, NOW);
    expect(data.register.map((r) => r.kind)).not.toContain("Backflow test");
    expect(data.register.map((r) => r.kind)).not.toContain("Grease trap");
    expect(data.history.map((h) => h.kind)).toEqual(["Backflow test"]);
  });

  it("carries the equipment register with make, model, serial and who services it", async () => {
    const data = await getComplianceReportData(asOwner(), store.id, NOW);
    expect(data.equipment).toEqual([
      expect.objectContaining({
        name: "Exhaust hood",
        manufacturer: "Captiveaire",
        model: "5424",
        serialNumber: "SN-123",
        servicedBy: { name: "SafeHood", phone: "(913) 555-0163", afterHours: "(913) 555-0164" },
      }),
    ]);
    expect(data.contractors.map((c) => c.name)).toEqual(["SafeHood"]);
    // The expired hood item names its servicer from the equipment's contractor.
    expect(data.register.find((r) => r.kind === "Hood cleaning")?.servicedBy).toBe("SafeHood");
  });

  it("does not hand the record to a contractor's login, or for a store out of scope", async () => {
    await expect(getComplianceReportData(asVendor(), store.id, NOW)).rejects.toMatchObject({ status: 403 });
    await expect(getComplianceReportData({ ...asOwner(), organizationId: "someone-else" }, store.id, NOW)).rejects.toMatchObject({ status: 404 });
  });

  it("renders a real PDF", async () => {
    const pdf = await renderComplianceReportPdf(await getComplianceReportData(asOwner(), store.id, NOW));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it("renders an empty store without failing", async () => {
    const empty = await prisma.property.create({
      data: { organizationId: org.id, portfolioId: (await prisma.portfolio.findFirstOrThrow({ where: { organizationId: org.id } })).id, name: `empty-${suffix}`, addressLine1: "1", city: "X", state: "KS", postalCode: "1" },
    });
    const data = await getComplianceReportData(asOwner(), empty.id, NOW);
    expect(data.summary.tracked).toBe(0);
    expect((await renderComplianceReportPdf(data)).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("Deep Property Setup", () => {
  it("counts contractors and expirations as steps, and says how many are expired", async () => {
    const status = await getPropertyOnboardingStatus(asOwner(), store.id, NOW);
    const step = (key: string) => status.steps.find((s) => s.key === key);
    expect(step("contractors")).toMatchObject({ done: true });
    expect(step("expirations")).toMatchObject({ done: true });
    expect(step("expirations")?.detail).toMatch(/3 tracked, 1 expired/);
  });

  it("shows both as not done for a store with neither", async () => {
    const empty = await prisma.property.findFirstOrThrow({ where: { organizationId: org.id, name: `empty-${suffix}` } });
    await prisma.vendor.update({ where: { id: vendor.id }, data: { servesAllProperties: false } });
    const status = await getPropertyOnboardingStatus(asOwner(), empty.id);
    expect(status.steps.find((s) => s.key === "contractors")?.done).toBe(false);
    expect(status.steps.find((s) => s.key === "expirations")?.done).toBe(false);
    await prisma.vendor.update({ where: { id: vendor.id }, data: { servesAllProperties: true } });
  });
});
