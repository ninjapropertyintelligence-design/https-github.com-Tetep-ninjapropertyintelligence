import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { SessionContext } from "@/lib/tenant-scope";
import { createDroneCapture, createDroneDataset, registerDroneImage, registerDroneOutput, getPropertyExteriorData } from "@/lib/drone-service";
import { ApiError } from "@/lib/api-error";

/**
 * Drone dataset pipeline permission boundaries (spec Phase 2 §20):
 * - Cross-tenant capture access denied.
 * - Output/image registration only succeeds when the dataset's capture's
 *   property is in the caller's tenant scope.
 */
describe("Drone pipeline tenant isolation", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let propertyA: { id: string };
  let userA: { id: string };
  let userB: { id: string };
  const suffix = `t${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    orgA = await prisma.organization.create({ data: { name: `Drone Org A ${suffix}`, slug: `drone-org-a-${suffix}` } });
    orgB = await prisma.organization.create({ data: { name: `Drone Org B ${suffix}`, slug: `drone-org-b-${suffix}` } });
    const portfolioA = await prisma.portfolio.create({ data: { organizationId: orgA.id, name: "P" } });
    propertyA = await prisma.property.create({
      data: { organizationId: orgA.id, portfolioId: portfolioA.id, name: "Prop A", addressLine1: "1 Main St", city: "Testville", state: "TX", postalCode: "75001" },
    });
    userA = await prisma.user.create({ data: { email: `drone-a-${suffix}@example.com`, passwordHash: "x", name: "User A" } });
    userB = await prisma.user.create({ data: { email: `drone-b-${suffix}@example.com`, passwordHash: "x", name: "User B" } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await prisma.organization.delete({ where: { id: orgA.id } });
    await prisma.organization.delete({ where: { id: orgB.id } });
  });

  function ctxFor(orgId: string, userId: string): SessionContext {
    return {
      userId,
      userName: "Test",
      userEmail: "test@example.com",
      isPlatformAdmin: false,
      organizationId: orgId,
      organizationName: "Test Org",
      membershipId: "irrelevant",
      role: "OWNER" as never,
      vendorId: null,
      grants: [],
      permissions: [],
    };
  }

  it("Org B cannot create a drone capture on Org A's property", async () => {
    await expect(createDroneCapture(ctxFor(orgB.id, userB.id), propertyA.id, {})).rejects.toThrow(ApiError);
  });

  it("Org B cannot create a dataset under Org A's capture, and Org B cannot read Org A's exterior data", async () => {
    const capture = await createDroneCapture(ctxFor(orgA.id, userA.id), propertyA.id, { droneModel: "DJI Mavic 3" });
    await expect(createDroneDataset(ctxFor(orgB.id, userB.id), capture.id)).rejects.toThrow(ApiError);
    await expect(getPropertyExteriorData(ctxFor(orgB.id, userB.id), propertyA.id)).rejects.toThrow(ApiError);
  });

  it("Org B cannot register an image/output onto Org A's dataset (output attached only to authorized property)", async () => {
    const capture = await createDroneCapture(ctxFor(orgA.id, userA.id), propertyA.id, {});
    const dataset = await createDroneDataset(ctxFor(orgA.id, userA.id), capture.id);

    await expect(
      registerDroneImage(ctxFor(orgB.id, userB.id), dataset.id, { storageKey: "fake/photo.jpg" }),
    ).rejects.toThrow(ApiError);

    await expect(
      registerDroneOutput(ctxFor(orgB.id, userB.id), dataset.id, { outputType: "ORTHOMOSAIC", storageKey: "fake/ortho.tif" }),
    ).rejects.toThrow(ApiError);
  });

  it("registering an image with no uploaded file at the storage key fails cleanly (integrity check, not a crash)", async () => {
    const capture = await createDroneCapture(ctxFor(orgA.id, userA.id), propertyA.id, {});
    const dataset = await createDroneDataset(ctxFor(orgA.id, userA.id), capture.id);
    await expect(
      registerDroneImage(ctxFor(orgA.id, userA.id), dataset.id, { storageKey: "nonexistent/photo.jpg" }),
    ).rejects.toThrow(ApiError);
  });

  it("rejects an unsupported file extension for the requested output type", async () => {
    const capture = await createDroneCapture(ctxFor(orgA.id, userA.id), propertyA.id, {});
    const dataset = await createDroneDataset(ctxFor(orgA.id, userA.id), capture.id);
    await expect(
      registerDroneOutput(ctxFor(orgA.id, userA.id), dataset.id, { outputType: "POINT_CLOUD", storageKey: "fake/cloud.exe" }),
    ).rejects.toThrow(ApiError);
  });
});
