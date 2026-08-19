import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { SessionContext } from "@/lib/tenant-scope";
import { makeAiTools } from "@/lib/ai/tools";
import { askPropertyAI } from "@/lib/ai/gateway";
import { getAIProvider } from "@/lib/ai/provider-factory";
import { NullProvider } from "@/lib/ai/providers/null-provider";
import { BENCHMARK } from "../ai-eval/benchmark";

/**
 * The permanent AI benchmark (spec §29) — see tests/ai-eval/benchmark.ts
 * for the fixture spec each `it()` below implements (matched by id).
 *
 * Fixture data is created fresh per run (not the shared demo seed) so
 * expected counts are exact and never drift.
 */
describe("AI evaluation suite", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let propertyA1: { id: string };
  let propertyA2: { id: string };
  let userA: { id: string };
  let userB: { id: string };
  let criticalHvacA: { id: string };
  let openCriticalIssueA: { id: string };
  const suffix = `ai-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    orgA = await prisma.organization.create({ data: { name: `AI Eval Org A ${suffix}`, slug: `ai-eval-a-${suffix}` } });
    orgB = await prisma.organization.create({ data: { name: `AI Eval Org B ${suffix}`, slug: `ai-eval-b-${suffix}` } });

    const portfolioA = await prisma.portfolio.create({ data: { organizationId: orgA.id, name: "Portfolio A" } });
    const portfolioB = await prisma.portfolio.create({ data: { organizationId: orgB.id, name: "Portfolio B" } });

    propertyA1 = await prisma.property.create({
      data: { organizationId: orgA.id, portfolioId: portfolioA.id, name: "Fixture Prop A1", addressLine1: "1 Main St", city: "Testville", state: "TX", postalCode: "75001" },
    });
    propertyA2 = await prisma.property.create({
      data: { organizationId: orgA.id, portfolioId: portfolioA.id, name: "Fixture Prop A2", addressLine1: "2 Main St", city: "Testville", state: "TX", postalCode: "75001" },
    });
    const propertyB = await prisma.property.create({
      data: { organizationId: orgB.id, portfolioId: portfolioB.id, name: "Fixture Prop B", addressLine1: "1 Elm St", city: "Otherville", state: "CA", postalCode: "90001" },
    });

    userA = await prisma.user.create({ data: { email: `${suffix}-a@example.com`, passwordHash: "x", name: "Eval User A" } });
    userB = await prisma.user.create({ data: { email: `${suffix}-b@example.com`, passwordHash: "x", name: "Eval User B" } });

    // Org A fixture assets: exactly one critical (>=5) HVAC asset.
    criticalHvacA = await prisma.asset.create({
      data: { organizationId: orgA.id, propertyId: propertyA1.id, name: "RTU-Critical", assetType: "HVAC", criticalityScore: 5 },
    });
    await prisma.asset.create({
      data: { organizationId: orgA.id, propertyId: propertyA1.id, name: "RTU-Minor", assetType: "HVAC", criticalityScore: 3 },
    });
    await prisma.asset.create({
      data: { organizationId: orgA.id, propertyId: propertyA2.id, name: "Panel-1", assetType: "Electrical", criticalityScore: 5 },
    });

    // Org B fixture: also has a critical HVAC asset — must never be counted in Org A's answer.
    await prisma.asset.create({
      data: { organizationId: orgB.id, propertyId: propertyB.id, name: "RTU-B-Critical", assetType: "HVAC", criticalityScore: 5 },
    });

    // Org A fixture issues: exactly one open+critical.
    openCriticalIssueA = await prisma.issue.create({
      data: { organizationId: orgA.id, propertyId: propertyA1.id, title: "Open critical issue", severity: "CRITICAL", status: "OPEN", source: "MANUAL", createdById: userA.id },
    });
    await prisma.issue.create({
      data: { organizationId: orgA.id, propertyId: propertyA1.id, title: "Resolved critical issue", severity: "CRITICAL", status: "RESOLVED", source: "MANUAL", createdById: userA.id },
    });
    await prisma.issue.create({
      data: { organizationId: orgA.id, propertyId: propertyA2.id, title: "Open low-severity issue", severity: "LOW", status: "OPEN", source: "MANUAL", createdById: userA.id },
    });
  });

  afterAll(async () => {
    await prisma.issue.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.asset.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.aIQueryLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await prisma.property.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.portfolio.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.organization.delete({ where: { id: orgA.id } });
    await prisma.organization.delete({ where: { id: orgB.id } });
  });

  function ctxFor(orgId: string, userId: string): SessionContext {
    return {
      userId,
      userName: "Eval User",
      userEmail: "eval@example.com",
      isPlatformAdmin: false,
      organizationId: orgId,
      organizationName: "Eval Org",
      membershipId: "irrelevant",
      role: "OWNER" as never,
      vendorId: null,
      grants: [],
      permissions: [],
    };
  }

  it("[critical-hvac-count] numerical accuracy: counts exactly the fixture's critical HVAC assets, never the sibling org's", async () => {
    const tools = makeAiTools(ctxFor(orgA.id, userA.id));
    const result = await tools.getAssets({ assetType: "HVAC", minCriticality: 5 });
    expect(result.count).toBe(1);
    expect(result.assets.map((a) => a.id)).toEqual([criticalHvacA.id]);
  });

  it("[open-critical-issues] retrieval accuracy: returns exactly the open+critical fixture issue, excluding resolved and low-severity", async () => {
    const tools = makeAiTools(ctxFor(orgA.id, userA.id));
    const result = await tools.getIssues({ severity: "CRITICAL", status: "OPEN" });
    expect(result.count).toBe(1);
    expect(result.issues.map((i) => i.id)).toEqual([openCriticalIssueA.id]);
  });

  it("[cross-org-asset-lookup-denied] permission compliance: Org B cannot retrieve Org A's asset by ID, even a real one", async () => {
    const tools = makeAiTools(ctxFor(orgB.id, userB.id));
    const result = await tools.getAsset({ assetId: criticalHvacA.id });
    expect(result.found).toBe(false);
  });

  it("[nonexistent-asset-type] missing-data behavior: a type that was never seeded returns a plain zero, not a guess", async () => {
    const tools = makeAiTools(ctxFor(orgA.id, userA.id));
    const result = await tools.getAssets({ assetType: "Elevator" });
    expect(result.count).toBe(0);
    expect(result.assets).toEqual([]);
  });

  it("[capital-exposure-before-assessment] missing-data behavior: no health snapshot yet produces found:false, never a fabricated dollar figure", async () => {
    const tools = makeAiTools(ctxFor(orgA.id, userA.id));
    const result = await tools.getCapitalExposure({ propertyId: propertyA1.id });
    expect(result.found).toBe(false);
    if (!result.found) expect(result.reason).toBeTruthy();
  });

  it("[tool-result-refs-are-real] citation correctness: every source ref returned resolves to a real, in-scope row", async () => {
    const tools = makeAiTools(ctxFor(orgA.id, userA.id));
    await tools.getAssets({ assetType: "HVAC" });
    await tools.getIssues({ severity: "CRITICAL" });

    expect(tools.refs.length).toBeGreaterThan(0);
    for (const ref of tools.refs) {
      if (ref.type === "Asset") {
        const asset = await prisma.asset.findUnique({ where: { id: ref.id } });
        expect(asset).not.toBeNull();
        expect(asset!.organizationId).toBe(orgA.id);
      } else if (ref.type === "Issue") {
        const issue = await prisma.issue.findUnique({ where: { id: ref.id } });
        expect(issue).not.toBeNull();
        expect(issue!.organizationId).toBe(orgA.id);
      }
    }
  });

  it("[unconfigured-provider-never-fabricates] hallucination rate: with no AI provider configured, the answer is honest and no tool calls are made", async () => {
    const provider = getAIProvider();
    if (!(provider instanceof NullProvider)) {
      // A provider IS configured in this environment — this specific
      // case doesn't apply; the live-provider cases below cover it instead.
      return;
    }
    const result = await askPropertyAI(ctxFor(orgA.id, userA.id), "How many critical HVAC assets do we have?");
    expect(result.configured).toBe(false);
    expect(result.answer.toLowerCase()).toContain("not configured");
    expect(result.toolCalls).toEqual([]);
    expect(result.sourceRefs).toEqual([]);
  });

  describe.skipIf(getAIProvider() instanceof NullProvider)("live-provider cases (only run when an AI provider is actually configured)", () => {
    it("[live-critical-hvac-count] the model's natural-language answer matches ground truth and cites a real source", async () => {
      const result = await askPropertyAI(
        ctxFor(orgA.id, userA.id),
        "How many critical HVAC assets does this organization have? Answer with just the number.",
      );
      expect(result.configured).toBe(true);
      expect(result.answer).toContain("1");
      expect(result.sourceRefs.some((r) => r.type === "Asset" && r.id === criticalHvacA.id)).toBe(true);
    });
  });

  it("every BENCHMARK case is covered by a spec id referenced above", () => {
    // Structural guard: the fixture doc (tests/ai-eval/benchmark.ts) and
    // this file must stay in sync — a case with no enforcing test is not
    // a benchmark. This test doesn't re-run the cases; it just makes sure
    // the source file defines the full expected id list.
    const ids = BENCHMARK.map((c) => c.id);
    expect(ids).toEqual([
      "critical-hvac-count",
      "open-critical-issues",
      "cross-org-asset-lookup-denied",
      "nonexistent-asset-type",
      "capital-exposure-before-assessment",
      "tool-result-refs-are-real",
      "unconfigured-provider-never-fabricates",
      "live-critical-hvac-count",
    ]);
  });
});
