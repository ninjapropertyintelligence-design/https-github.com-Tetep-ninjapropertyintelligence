import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { SessionContext } from "@/lib/tenant-scope";
import { makeAiTools, scopeToolsToProperty } from "@/lib/ai/tools";
import { searchDocumentChunks } from "@/lib/document-extraction";
import { getPropertyReportData } from "@/lib/reports/property-report-data";
import { ApiError } from "@/lib/api-error";

describe("Phase 2: property-scoped AI tools, document search, and report scoping", () => {
  let org: { id: string };
  let otherOrg: { id: string };
  let propertyA: { id: string };
  let propertyB: { id: string };
  let assetInA: { id: string };
  let assetInB: { id: string };
  let user: { id: string };
  const suffix = `t${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: `AI Org ${suffix}`, slug: `ai-org-${suffix}` } });
    otherOrg = await prisma.organization.create({ data: { name: `AI Other Org ${suffix}`, slug: `ai-other-org-${suffix}` } });
    const portfolio = await prisma.portfolio.create({ data: { organizationId: org.id, name: "P" } });
    const otherPortfolio = await prisma.portfolio.create({ data: { organizationId: otherOrg.id, name: "P" } });

    const base = { addressLine1: "1 Main St", city: "Testville", state: "TX", postalCode: "75001" };
    propertyA = await prisma.property.create({ data: { ...base, organizationId: org.id, portfolioId: portfolio.id, name: "Property A" } });
    propertyB = await prisma.property.create({ data: { ...base, organizationId: org.id, portfolioId: portfolio.id, name: "Property B" } });
    const propertyInOtherOrg = await prisma.property.create({ data: { ...base, organizationId: otherOrg.id, portfolioId: otherPortfolio.id, name: "Other Org Property" } });

    user = await prisma.user.create({ data: { email: `ai-tools-${suffix}@example.com`, passwordHash: "x", name: "AI Tester" } });

    assetInA = await prisma.asset.create({ data: { organizationId: org.id, propertyId: propertyA.id, name: "RTU-01", assetType: "HVAC" } });
    assetInB = await prisma.asset.create({ data: { organizationId: org.id, propertyId: propertyB.id, name: "RTU-02", assetType: "HVAC" } });

    // A document + chunk in each org, to prove tenant isolation in full-text search.
    const docOrg = await prisma.document.create({ data: { organizationId: org.id, propertyId: propertyA.id, title: "Roof Warranty A" } });
    await prisma.documentChunk.create({
      data: { organizationId: org.id, documentId: docOrg.id, propertyId: propertyA.id, chunkIndex: 0, content: "The roof compressor unit warranty covers ten years of coverage." },
    });
    const docOther = await prisma.document.create({ data: { organizationId: otherOrg.id, propertyId: propertyInOtherOrg.id, title: "Roof Warranty Other Org" } });
    await prisma.documentChunk.create({
      data: { organizationId: otherOrg.id, documentId: docOther.id, propertyId: propertyInOtherOrg.id, chunkIndex: 0, content: "The roof compressor unit warranty covers five years of coverage." },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });

  function ctxFor(organizationId: string): SessionContext {
    return {
      userId: user.id,
      userName: "AI Tester",
      userEmail: "ai-tester@example.com",
      isPlatformAdmin: false,
      organizationId,
      organizationName: "Test Org",
      membershipId: "irrelevant",
      role: "OWNER" as never, // org-wide role: unscoped tools see the whole org
      vendorId: null,
      grants: [],
      permissions: [],
    };
  }

  it("owner (org-wide, unscoped) can retrieve the entire organization's properties", async () => {
    const toolset = makeAiTools(ctxFor(org.id));
    const result = await toolset.getProperties({});
    const names = result.properties.map((p) => p.name);
    expect(names).toContain("Property A");
    expect(names).toContain("Property B");
  });

  it("property-scoped AI cannot retrieve another property's assets, even via getAssets({}) with no filter", async () => {
    const toolset = makeAiTools(ctxFor(org.id));
    const scoped = scopeToolsToProperty(toolset, propertyA.id);
    const result = await scoped.getAssets({});
    const names = result.assets.map((a) => a.name);
    expect(names).toContain("RTU-01");
    expect(names).not.toContain("RTU-02");
  });

  it("property-scoped AI redacts an asset lookup by ID if the asset belongs to a different property", async () => {
    const toolset = makeAiTools(ctxFor(org.id));
    const scoped = scopeToolsToProperty(toolset, propertyA.id);
    const result = await scoped.getAsset({ assetId: assetInB.id });
    expect(result.found).toBe(false);
  });

  it("property-scoped AI still resolves an asset that does belong to the scoped property, and records a source ref", async () => {
    const toolset = makeAiTools(ctxFor(org.id));
    const scoped = scopeToolsToProperty(toolset, propertyA.id);
    const result = await scoped.getAsset({ assetId: assetInA.id });
    expect(result.found).toBe(true);
    expect(toolset.refs.some((r) => r.type === "Asset" && r.id === assetInA.id)).toBe(true);
    // Never a ref to the out-of-scope asset it never actually returned.
    expect(toolset.refs.some((r) => r.type === "Asset" && r.id === assetInB.id)).toBe(false);
  });

  it("full-text document search never returns another organization's chunks", async () => {
    const hits = await searchDocumentChunks({ organizationId: org.id, query: "compressor warranty" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.documentTitle !== "Roof Warranty Other Org")).toBe(true);
  });

  it("property report generation refuses a property outside the caller's organization", async () => {
    const otherOrgProperty = await prisma.property.findFirstOrThrow({ where: { organizationId: otherOrg.id } });
    await expect(getPropertyReportData(ctxFor(org.id), otherOrgProperty.id)).rejects.toThrow(ApiError);
  });

  it("property report generation succeeds for a property within scope and only includes that property's assets", async () => {
    const data = await getPropertyReportData(ctxFor(org.id), propertyA.id);
    expect(data.property.id).toBe(propertyA.id);
    expect(data.assets.every((a) => a.propertyId === propertyA.id)).toBe(true);
  });
});
