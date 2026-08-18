import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { SessionContext } from "@/lib/tenant-scope";
import { getPropertyInteriorStatus, linkSpaceToProperty, syncPropertyInterior, disconnectPropertyInterior } from "@/lib/matterport-service";
import { ApiError } from "@/lib/api-error";
import { MatterportProvider } from "@/lib/integrations/matterport-provider";

/**
 * Matterport permission boundaries (spec Phase 2 §20):
 * - Org A cannot see/act on Org B's Matterport spaces/links.
 * - Failed credentials produce a clean ERROR state, not a crash or a fake success.
 */
describe("Matterport tenant isolation", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let propertyA: { id: string };
  let propertyB: { id: string };
  let userA: { id: string };
  let userB: { id: string };
  let connectionA: { id: string };
  let spaceA: { id: string; externalSpaceId: string };
  const suffix = `t${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    orgA = await prisma.organization.create({ data: { name: `MP Org A ${suffix}`, slug: `mp-org-a-${suffix}` } });
    orgB = await prisma.organization.create({ data: { name: `MP Org B ${suffix}`, slug: `mp-org-b-${suffix}` } });

    const portfolioA = await prisma.portfolio.create({ data: { organizationId: orgA.id, name: "P" } });
    const portfolioB = await prisma.portfolio.create({ data: { organizationId: orgB.id, name: "P" } });

    const baseProp = { addressLine1: "1 Main St", city: "Testville", state: "TX", postalCode: "75001" };
    propertyA = await prisma.property.create({ data: { ...baseProp, organizationId: orgA.id, portfolioId: portfolioA.id, name: "Prop A" } });
    propertyB = await prisma.property.create({ data: { ...baseProp, organizationId: orgB.id, portfolioId: portfolioB.id, name: "Prop B" } });

    userA = await prisma.user.create({ data: { email: `mp-a-${suffix}@example.com`, passwordHash: "x", name: "User A" } });
    userB = await prisma.user.create({ data: { email: `mp-b-${suffix}@example.com`, passwordHash: "x", name: "User B" } });

    connectionA = await prisma.matterportConnection.create({ data: { organizationId: orgA.id, status: "CONNECTED" } });
    spaceA = await prisma.matterportSpace.create({ data: { connectionId: connectionA.id, externalSpaceId: `space-${suffix}`, name: "Space A", status: "READY" } });
    await prisma.matterportPropertyLink.create({ data: { propertyId: propertyA.id, spaceId: spaceA.id, operator: "Test" } });
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

  it("Org B cannot read Org A's linked Matterport space via getPropertyInteriorStatus", async () => {
    await expect(getPropertyInteriorStatus(ctxFor(orgB.id, userB.id), propertyA.id)).rejects.toThrow(ApiError);
  });

  it("Org B cannot link a space to Org A's property (or vice versa across org boundary)", async () => {
    await expect(linkSpaceToProperty(ctxFor(orgB.id, userB.id), propertyA.id, spaceA.externalSpaceId)).rejects.toThrow(ApiError);
  });

  it("Org B cannot sync or disconnect Org A's property interior link", async () => {
    await expect(syncPropertyInterior(ctxFor(orgB.id, userB.id), propertyA.id)).rejects.toThrow(ApiError);
    await expect(disconnectPropertyInterior(ctxFor(orgB.id, userB.id), propertyA.id)).rejects.toThrow(ApiError);
  });

  it("Org A can read its own linked space", async () => {
    const status = await getPropertyInteriorStatus(ctxFor(orgA.id, userA.id), propertyA.id);
    expect(status.link?.space.externalSpaceId).toBe(spaceA.externalSpaceId);
  });

  it("Org B has no Matterport connection yet — shows NOT_CONFIGURED, not Org A's connection", async () => {
    const status = await getPropertyInteriorStatus(ctxFor(orgB.id, userB.id), propertyB.id);
    expect(status.connectionStatus).toBe("NOT_CONFIGURED");
    expect(status.link).toBeNull();
  });
});

describe("MatterportProvider error handling (no live credentials in this environment)", () => {
  it("isConfigured() is false with no token/secret — never attempts a network call", () => {
    const provider = new MatterportProvider(undefined, undefined, undefined);
    expect(provider.isConfigured()).toBe(false);
  });

  it("connect() with configured-but-invalid credentials against an unreachable endpoint returns a clean ERROR state, not a thrown exception or a fake CONNECTED", async () => {
    const provider = new MatterportProvider("fake-token", "fake-secret", undefined, "http://127.0.0.1:1/unreachable-matterport-endpoint");
    const result = await provider.connect();
    expect(result.status).toBe("ERROR");
    expect(result.errorMessage).toBeTruthy();
  });
});
