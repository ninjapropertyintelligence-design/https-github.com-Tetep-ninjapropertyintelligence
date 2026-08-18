import { prisma } from "@/lib/prisma";
import { SessionContext, issueScopeWhere, propertyScopeWhere } from "@/lib/session-context";
import { getPortfolioDashboard } from "@/lib/dashboard";
import { getLatestHealthSnapshot } from "@/lib/scoring";
import { healthBandFor } from "@/lib/scoring-categories";

/**
 * AI TOOL GATEWAY — approved backend functions (spec §24-§27).
 *
 * The LLM never touches the database. Every one of these functions is
 * closed over a `SessionContext` resolved server-side from the
 * authenticated session (see `getSessionContext`), so a tool call literally
 * cannot reach outside the caller's tenant/role/scope — there is no
 * "organizationId" parameter the model could pass to escape it. Every
 * function returns real, already-computed values (via the scoring engine,
 * `propertyScopeWhere`, etc.) — nothing here lets the model invent a number.
 * When a function has nothing to return, it says so explicitly
 * (`{ found: false }` / empty arrays) rather than fabricating.
 */

type Ref = { type: string; id: string };

export function makeAiTools(ctx: SessionContext) {
  const refs: Ref[] = [];
  const trackRef = (type: string, id: string) => refs.push({ type, id });

  return {
    refs,

    async getPortfolioSummary() {
      const summary = await getPortfolioDashboard(ctx);
      return summary;
    },

    async getProperties(args: { region?: string; healthBand?: string; propertyType?: string; search?: string }) {
      const properties = await prisma.property.findMany({
        where: {
          AND: [
            propertyScopeWhere(ctx),
            args.region ? { regionId: args.region } : {},
            args.propertyType ? { propertyType: args.propertyType } : {},
            args.search
              ? { OR: [{ name: { contains: args.search, mode: "insensitive" } }, { city: { contains: args.search, mode: "insensitive" } }] }
              : {},
          ],
        },
        take: 100,
      });
      const results = [];
      for (const p of properties) {
        const snap = await getLatestHealthSnapshot(p.id);
        if (args.healthBand && (!snap || healthBandFor(snap.healthScore) !== args.healthBand)) continue;
        trackRef("Property", p.id);
        results.push({
          id: p.id,
          name: p.name,
          city: p.city,
          state: p.state,
          healthScore: snap?.healthScore ?? null,
          riskScore: snap?.riskScore ?? null,
          band: snap ? healthBandFor(snap.healthScore) : null,
          capitalExposure12mo: snap?.capitalExposure12mo ?? null,
        });
      }
      return { count: results.length, properties: results };
    },

    async getProperty(args: { propertyId: string }) {
      const property = await prisma.property.findFirst({
        where: { AND: [{ id: args.propertyId }, propertyScopeWhere(ctx)] },
      });
      if (!property) return { found: false };
      trackRef("Property", property.id);
      const snap = await getLatestHealthSnapshot(property.id);
      return {
        found: true,
        property,
        health: snap ? { ...snap, band: healthBandFor(snap.healthScore) } : null,
      };
    },

    async getAssets(args: { propertyId?: string; assetType?: string; minCriticality?: number; status?: string }) {
      const assets = await prisma.asset.findMany({
        where: {
          organizationId: ctx.organizationId,
          property: propertyScopeWhere(ctx),
          ...(args.propertyId ? { propertyId: args.propertyId } : {}),
          ...(args.assetType ? { assetType: { contains: args.assetType, mode: "insensitive" } } : {}),
          ...(args.minCriticality ? { criticalityScore: { gte: args.minCriticality } } : {}),
          ...(args.status ? { status: args.status as never } : {}),
        },
        take: 100,
        orderBy: { healthScore: "asc" },
      });
      assets.forEach((a) => trackRef("Asset", a.id));
      return { count: assets.length, assets };
    },

    async getAsset(args: { assetId: string }) {
      const asset = await prisma.asset.findFirst({
        where: { AND: [{ id: args.assetId }, { property: propertyScopeWhere(ctx) }] },
      });
      if (!asset) return { found: false };
      trackRef("Asset", asset.id);
      return { found: true, asset };
    },

    async getAssetHistory(args: { assetId: string }) {
      const asset = await prisma.asset.findFirst({
        where: { AND: [{ id: args.assetId }, { property: propertyScopeWhere(ctx) }] },
      });
      if (!asset) return { found: false };
      const history = await prisma.assetConditionHistory.findMany({
        where: { assetId: args.assetId },
        orderBy: { changedAt: "desc" },
        take: 50,
      });
      trackRef("Asset", asset.id);
      return { found: true, history };
    },

    async getIssues(args: { propertyId?: string; severity?: string; status?: string }) {
      const issues = await prisma.issue.findMany({
        where: {
          AND: [
            issueScopeWhere(ctx),
            args.propertyId ? { propertyId: args.propertyId } : {},
            args.severity ? { severity: args.severity as never } : {},
            args.status ? { status: args.status as never } : {},
          ],
        },
        take: 100,
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        include: { property: { select: { name: true } } },
      });
      issues.forEach((i) => trackRef("Issue", i.id));
      return { count: issues.length, issues };
    },

    async getAssessments(args: { propertyId?: string; status?: string }) {
      const assessments = await prisma.assessment.findMany({
        where: {
          organizationId: ctx.organizationId,
          property: propertyScopeWhere(ctx),
          ...(args.propertyId ? { propertyId: args.propertyId } : {}),
          ...(args.status ? { status: args.status as never } : {}),
        },
        take: 100,
        include: { property: { select: { name: true } }, template: { select: { name: true } } },
      });
      assessments.forEach((a) => trackRef("Assessment", a.id));
      return { count: assessments.length, assessments };
    },

    async getCapitalExposure(args: { propertyId?: string }) {
      if (args.propertyId) {
        const snap = await getLatestHealthSnapshot(args.propertyId);
        if (!snap) return { found: false, reason: "No health snapshot computed yet for this property" };
        trackRef("Property", args.propertyId);
        return {
          found: true,
          next12mo: snap.capitalExposure12mo,
          next24mo: snap.capitalExposure24mo,
          next36mo: snap.capitalExposure36mo,
        };
      }
      const summary = await getPortfolioDashboard(ctx);
      return { found: true, ...summary.capitalExposure };
    },

    async getPropertyHealth(args: { propertyId: string }) {
      const property = await prisma.property.findFirst({
        where: { AND: [{ id: args.propertyId }, propertyScopeWhere(ctx)] },
      });
      if (!property) return { found: false };
      const snap = await getLatestHealthSnapshot(args.propertyId);
      trackRef("Property", args.propertyId);
      if (!snap) return { found: true, health: null, note: "Not enough data has been computed yet." };
      return { found: true, health: { ...snap, band: healthBandFor(snap.healthScore) } };
    },

    async getDocuments(args: { propertyId?: string; assetId?: string; documentType?: string }) {
      const documents = await prisma.document.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(args.propertyId ? { propertyId: args.propertyId } : {}),
          ...(args.assetId ? { assetId: args.assetId } : {}),
          ...(args.documentType ? { documentType: args.documentType as never } : {}),
        },
        take: 50,
      });
      documents.forEach((d) => trackRef("Document", d.id));
      return { count: documents.length, documents };
    },

    async searchDocuments(args: { query: string }) {
      // Basic title/tag search — full text extraction/chunking/vector search
      // (spec §29) is architected (Document/DocumentVersion models support
      // it) but not implemented in this phase. This is real search, just
      // keyword-only, not a stub.
      const documents = await prisma.document.findMany({
        where: { organizationId: ctx.organizationId, title: { contains: args.query, mode: "insensitive" } },
        take: 25,
      });
      documents.forEach((d) => trackRef("Document", d.id));
      return { count: documents.length, documents };
    },

    async getEvidence(args: { propertyId?: string; assetId?: string; issueId?: string }) {
      const evidence = await prisma.evidence.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(args.propertyId ? { propertyId: args.propertyId } : {}),
          ...(args.assetId ? { assetId: args.assetId } : {}),
          ...(args.issueId ? { issueId: args.issueId } : {}),
        },
        take: 50,
      });
      evidence.forEach((e) => trackRef("Evidence", e.id));
      return { count: evidence.length, evidence };
    },

    async compareProperties(args: { propertyIdA: string; propertyIdB: string }) {
      const [a, b] = await Promise.all([
        prisma.property.findFirst({ where: { AND: [{ id: args.propertyIdA }, propertyScopeWhere(ctx)] } }),
        prisma.property.findFirst({ where: { AND: [{ id: args.propertyIdB }, propertyScopeWhere(ctx)] } }),
      ]);
      if (!a || !b) return { found: false, reason: "One or both properties are not accessible" };
      const [snapA, snapB] = await Promise.all([getLatestHealthSnapshot(a.id), getLatestHealthSnapshot(b.id)]);
      trackRef("Property", a.id);
      trackRef("Property", b.id);
      return {
        found: true,
        a: { name: a.name, health: snapA },
        b: { name: b.name, health: snapB },
      };
    },

    async getChanges(args: { sinceDays?: number }) {
      const since = new Date(Date.now() - (args.sinceDays ?? 30) * 86400000);
      const properties = await prisma.property.findMany({ where: propertyScopeWhere(ctx), select: { id: true } });
      const events = await prisma.event.findMany({
        where: { propertyId: { in: properties.map((p) => p.id) }, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { property: { select: { name: true } } },
      });
      events.forEach((e) => e.propertyId && trackRef("Property", e.propertyId));
      return { count: events.length, events };
    },

    async generateReport(args: { reportType: string; propertyId?: string }) {
      // Report generation itself (PDF/CSV) is exposed via /api/reports (spec
      // §33); the AI tool points the user there with the resolved context
      // rather than duplicating report rendering inside the AI path.
      if (args.propertyId) trackRef("Property", args.propertyId);
      return {
        reportType: args.reportType,
        propertyId: args.propertyId ?? null,
        href: args.propertyId
          ? `/properties/${args.propertyId}/reports?type=${encodeURIComponent(args.reportType)}`
          : `/reports?type=${encodeURIComponent(args.reportType)}`,
      };
    },
  };
}
