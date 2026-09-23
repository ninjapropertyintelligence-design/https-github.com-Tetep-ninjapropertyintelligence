import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { getPropertyExteriorData } from "@/lib/drone-service";
import type { SessionContext } from "@/lib/tenant-scope";

/**
 * Which capture the Exterior tab works on.
 *
 * This matters more than it looks: the tab is where imagery is uploaded and
 * markers are placed. Selecting the wrong capture does not throw — it
 * silently attaches this week's photos to last year's flight, and puts
 * markers on the wrong orthomosaic.
 *
 * The rule is: the URL's choice if it belongs to this property, else a
 * capture still in flight, else the most recent one BY FLIGHT DATE.
 */

const suffix = `ecs${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let org: { id: string };
let otherOrg: { id: string };
let user: { id: string };
let property: { id: string };
let newest: { id: string };
let oldest: { id: string };
let backfilled: { id: string };
let foreignCapture: { id: string };

function ctxFor(orgId: string): SessionContext {
  return {
    userId: user.id,
    userName: "ECS User",
    userEmail: `${suffix}@example.com`,
    isPlatformAdmin: false,
    organizationId: orgId,
    organizationName: "ECS Org",
    membershipId: "irrelevant",
    role: Role.OWNER,
    vendorId: null,
    grants: [],
    permissions: [],
    mfaRequired: false,
    mfaEnrolled: false,
    impersonation: null,
  };
}

beforeAll(async () => {
  org = await prisma.organization.create({ data: { name: `ECS Org ${suffix}`, slug: `ecs-org-${suffix}` } });
  otherOrg = await prisma.organization.create({ data: { name: `ECS Other ${suffix}`, slug: `ecs-other-${suffix}` } });
  user = await prisma.user.create({ data: { email: `${suffix}@example.com`, passwordHash: "x", name: "ECS" } });

  const pf = await prisma.portfolio.create({ data: { organizationId: org.id, name: "PF" } });
  const otherPf = await prisma.portfolio.create({ data: { organizationId: otherOrg.id, name: "OPF" } });

  property = await prisma.property.create({
    data: {
      organizationId: org.id, portfolioId: pf.id, name: `ecs-site-${suffix}`,
      addressLine1: "1 Main St", city: "Testville", state: "TX", postalCode: "75001",
    },
  });
  const foreignProperty = await prisma.property.create({
    data: {
      organizationId: otherOrg.id, portfolioId: otherPf.id, name: `ecs-foreign-${suffix}`,
      addressLine1: "9 Other St", city: "Elsewhere", state: "CA", postalCode: "90001",
    },
  });

  oldest = await prisma.droneCapture.create({
    data: { propertyId: property.id, capturedAt: new Date("2024-05-01T00:00:00Z"), capturedById: user.id, status: "READY" },
  });
  newest = await prisma.droneCapture.create({
    data: { propertyId: property.id, capturedAt: new Date("2026-06-01T00:00:00Z"), capturedById: user.id, status: "READY" },
  });
  // Created LAST but flown in 2023: the row is newest, the flight is oldest.
  // Ordering by createdAt would call this the most recent survey.
  backfilled = await prisma.droneCapture.create({
    data: { propertyId: property.id, capturedAt: new Date("2023-01-01T00:00:00Z"), capturedById: user.id, status: "READY" },
  });

  foreignCapture = await prisma.droneCapture.create({
    data: { propertyId: foreignProperty.id, capturedAt: new Date("2026-08-01T00:00:00Z"), capturedById: user.id, status: "READY" },
  });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.organization.delete({ where: { id: otherOrg.id } });
  await prisma.user.delete({ where: { id: user.id } });
});

describe("Exterior tab capture selection", () => {
  it("orders captures by flight date, not by when the row was created", async () => {
    const { captures } = await getPropertyExteriorData(ctxFor(org.id), property.id);
    expect(captures.map((c) => c.id)).toEqual([newest.id, oldest.id, backfilled.id]);
  });

  it("defaults to the most recent flight, not the most recently created row", async () => {
    const { selectedCaptureId } = await getPropertyExteriorData(ctxFor(org.id), property.id);
    expect(selectedCaptureId).toBe(newest.id);
    expect(selectedCaptureId).not.toBe(backfilled.id);
  });

  it("honours an explicit capture choice", async () => {
    const { selectedCaptureId } = await getPropertyExteriorData(ctxFor(org.id), property.id, oldest.id);
    expect(selectedCaptureId).toBe(oldest.id);
  });

  it("ignores a capture id from another organization", async () => {
    // Real id, real capture, wrong tenant. It must not be selected, and its
    // imagery must never appear under this property.
    const { selectedCaptureId, captures } = await getPropertyExteriorData(ctxFor(org.id), property.id, foreignCapture.id);
    expect(selectedCaptureId).toBe(newest.id);
    expect(captures.map((c) => c.id)).not.toContain(foreignCapture.id);
  });

  it("ignores a capture id that does not exist", async () => {
    const { selectedCaptureId } = await getPropertyExteriorData(ctxFor(org.id), property.id, "nope");
    expect(selectedCaptureId).toBe(newest.id);
  });

  it("prefers a capture still in flight over the newest finished one", async () => {
    // This tab is where uploading and processing happen, so work in progress
    // outranks history. It was the tab's original behaviour and is kept.
    const uploading = await prisma.droneCapture.create({
      data: { propertyId: property.id, capturedAt: new Date("2025-02-02T00:00:00Z"), capturedById: user.id, status: "UPLOADING" },
    });
    try {
      const { selectedCaptureId } = await getPropertyExteriorData(ctxFor(org.id), property.id);
      expect(selectedCaptureId).toBe(uploading.id);

      // ...but an explicit choice still wins over it.
      const explicit = await getPropertyExteriorData(ctxFor(org.id), property.id, oldest.id);
      expect(explicit.selectedCaptureId).toBe(oldest.id);
    } finally {
      await prisma.droneCapture.delete({ where: { id: uploading.id } });
    }
  });

  it("refuses a property in another organization outright", async () => {
    await expect(getPropertyExteriorData(ctxFor(otherOrg.id), property.id)).rejects.toThrow(/not found/i);
  });
});
