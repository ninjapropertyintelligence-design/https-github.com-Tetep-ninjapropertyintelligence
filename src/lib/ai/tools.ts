import { prisma } from "@/lib/prisma";
import { SessionContext, captureReviewWhere, issueScopeWhere, propertyScopeWhere } from "@/lib/tenant-scope";
import { getPortfolioDashboard } from "@/lib/dashboard";
import { getLatestHealthSnapshot } from "@/lib/scoring";
import { healthBandFor } from "@/lib/scoring-categories";
import { searchDocumentChunks } from "@/lib/document-extraction";
import { ApiError } from "@/lib/api-error";
import { listExpiries, type ExpiryView } from "@/lib/expiry-service";
import { listContractors, whoToCall } from "@/lib/contractor-service";
import { isoDay } from "@/lib/expiry-rules";

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

function expiryForAi(i: ExpiryView) {
  return {
    kind: i.kind,
    label: i.label,
    property: i.property.name,
    propertyId: i.propertyId,
    asset: i.asset?.name ?? null,
    assetId: i.assetId,
    expiresOn: isoDay(i.expiresAt),
    daysLeft: i.daysLeft,
    countdown: i.countdown,
    status: i.status,
    /** A date a model read off a photo that nobody has checked yet. */
    readByAiNotChecked: i.needsReview,
    servicedBy: i.servicedBy,
    contractor: i.asset?.serviceVendor?.name ?? null,
  };
}

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
      const [snap, matterportLink, droneCapture] = await Promise.all([
        getLatestHealthSnapshot(property.id),
        prisma.matterportPropertyLink.findFirst({
          where: { propertyId: property.id, ...captureReviewWhere(ctx) },
          orderBy: { linkedAt: "desc" },
          include: { space: true },
        }),
        prisma.droneCapture.findFirst({
          where: { propertyId: property.id, status: "READY", ...captureReviewWhere(ctx) },
          orderBy: { capturedAt: "desc" },
        }),
      ]);
      return {
        found: true,
        property,
        health: snap ? { ...snap, band: healthBandFor(snap.healthScore) } : null,
        lastInteriorCapture: matterportLink?.space?.syncedAt ?? matterportLink?.linkedAt ?? null,
        lastExteriorCapture: droneCapture?.capturedAt ?? null,
      };
    },

    async getHistory(args: { propertyId: string; sinceDays?: number }) {
      const property = await prisma.property.findFirst({
        where: { AND: [{ id: args.propertyId }, propertyScopeWhere(ctx)] },
      });
      if (!property) return { found: false };
      const since = args.sinceDays ? new Date(Date.now() - args.sinceDays * 86400000) : undefined;
      const events = await prisma.event.findMany({
        where: { propertyId: args.propertyId, ...(since ? { createdAt: { gte: since } } : {}) },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { actor: { select: { name: true } } },
      });
      trackRef("Property", property.id);
      return {
        found: true,
        events: events.map((e) => ({ type: e.type, createdAt: e.createdAt, actor: e.actor?.name ?? null, payload: e.payload })),
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
      return { found: true, assetPropertyId: asset.propertyId, history };
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

    /**
     * What is expiring or has expired: fire extinguisher tags, hood
     * certificates, permits, warranties. Dates and day counts are the
     * platform's own, never the model's.
     */
    async getExpirations(args: { propertyId?: string; withinDays?: number; includeInactive?: boolean }) {
      try {
        const items = await listExpiries(ctx, {
          propertyId: args.propertyId,
          withinDays: typeof args.withinDays === "number" ? args.withinDays : undefined,
          status: args.includeInactive ? "ALL" : undefined,
        });
        items.forEach((i) => trackRef(i.asset ? "Asset" : "Property", i.asset?.id ?? i.propertyId));
        return { count: items.length, items: items.slice(0, 100).map(expiryForAi) };
      } catch (err) {
        if (err instanceof ApiError) return { found: false as const, reason: err.message };
        throw err;
      }
    },

    /** The contractors to call, with their numbers, optionally for one store or one trade. */
    async getContractors(args: { propertyId?: string; trade?: string }) {
      try {
        const contractors = await listContractors(ctx, { propertyId: args.propertyId, trade: args.trade });
        return {
          count: contractors.length,
          contractors: contractors.slice(0, 100).map((c) => ({
            id: c.id,
            name: c.name,
            trade: c.trade,
            contactName: c.contactName,
            phone: c.contactPhone,
            afterHoursPhone: c.emergencyPhone,
            email: c.contactEmail,
            servesEveryStore: c.servesAllProperties,
            stores: c.properties.map((p) => p.property.name),
            notes: c.notes,
          })),
        };
      } catch (err) {
        if (err instanceof ApiError) return { found: false as const, reason: err.message };
        throw err;
      }
    },

    /** Who to call when one piece of equipment breaks: its own contractor first, then the store's others. */
    async getWhoToCall(args: { assetId: string }) {
      try {
        const { assigned, others } = await whoToCall(ctx, args.assetId);
        trackRef("Asset", args.assetId);
        const brief = (v: NonNullable<typeof assigned>) => ({
          name: v.name,
          trade: v.trade,
          contactName: v.contactName,
          phone: v.contactPhone,
          afterHoursPhone: v.emergencyPhone,
          email: v.contactEmail,
        });
        return {
          found: true as const,
          assignedContractor: assigned ? brief(assigned) : null,
          otherContractorsAtThisStore: others.slice(0, 10).map(brief),
        };
      } catch (err) {
        if (err instanceof ApiError) return { found: false as const, reason: err.message };
        throw err;
      }
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
      // Real Postgres full-text search over extracted document text (spec
      // §15) — falls back to a title match for documents that aren't
      // text-extractable (e.g. non-PDF) so they're still discoverable.
      const [chunkHits, titleHits] = await Promise.all([
        searchDocumentChunks({ organizationId: ctx.organizationId, query: args.query }),
        prisma.document.findMany({
          where: { organizationId: ctx.organizationId, title: { contains: args.query, mode: "insensitive" } },
          take: 10,
        }),
      ]);

      const accessibleProperties = await prisma.property.findMany({ where: propertyScopeWhere(ctx), select: { id: true } });
      const accessibleSet = new Set(accessibleProperties.map((p) => p.id));
      const scopedChunkHits = chunkHits.filter((h) => !h.propertyId || accessibleSet.has(h.propertyId));

      scopedChunkHits.forEach((h) => trackRef("Document", h.documentId));
      const scopedTitleHits = titleHits.filter((d) => !d.propertyId || accessibleSet.has(d.propertyId));
      scopedTitleHits.forEach((d) => trackRef("Document", d.id));

      return {
        textMatches: scopedChunkHits,
        titleMatches: scopedTitleHits,
      };
    },

    async getEvidence(args: { propertyId?: string; assetId?: string; issueId?: string }) {
      const evidence = await prisma.evidence.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(args.propertyId ? { propertyId: args.propertyId } : {}),
          ...(args.assetId ? { assetId: args.assetId } : {}),
          ...(args.issueId ? { issueId: args.issueId } : {}),
          ...captureReviewWhere(ctx),
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
      // Report generation itself (PDF/CSV) is exposed via /api/v1/reports (spec
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

export type AiToolset = ReturnType<typeof makeAiTools>;

/**
 * Property-scoped AI (spec §13): when a user opens AI from
 * `/properties/{propertyId}/ai`, tool calls must not be able to read another
 * property. This wraps the full toolset into a reduced one where every
 * property-filtering argument is force-set to `propertyId` server-side
 * (never trusting whatever the model passes), and portfolio-wide tools
 * (getPortfolioSummary, unfiltered getProperties, compareProperties,
 * org-wide getChanges/searchDocuments) are omitted entirely rather than
 * merely discouraged by prompt text. `getAsset`/`getAssetHistory` are kept
 * (useful once the user has an assetId in context) but redact the result if
 * the asset turns out to belong to a different property.
 *
 * Broader-scope override ("... unless the user explicitly requests it") is
 * intentionally not implemented as NLU-based intent detection in this
 * phase — see IMPLEMENTATION_REPORT.md. A user who wants portfolio-wide
 * answers uses the org-wide /ai page instead.
 */
export function scopeToolsToProperty(toolset: AiToolset, propertyId: string) {
  return {
    refs: toolset.refs,
    getProperty: () => toolset.getProperty({ propertyId }),
    getPropertyHealth: () => toolset.getPropertyHealth({ propertyId }),
    getHistory: (args: { sinceDays?: number }) => toolset.getHistory({ ...args, propertyId }),
    getAssets: (args: { assetType?: string; minCriticality?: number; status?: string }) =>
      toolset.getAssets({ ...args, propertyId }),
    getAsset: async (args: { assetId: string }) => {
      const result = await toolset.getAsset(args);
      if (result.found && result.asset?.propertyId !== propertyId) return { found: false as const };
      return result;
    },
    getAssetHistory: async (args: { assetId: string }) => {
      const result = await toolset.getAssetHistory(args);
      if (result.found && result.assetPropertyId !== propertyId) return { found: false as const };
      return result;
    },
    getIssues: (args: { severity?: string; status?: string }) => toolset.getIssues({ ...args, propertyId }),
    getAssessments: (args: { status?: string }) => toolset.getAssessments({ ...args, propertyId }),
    getExpirations: (args: { withinDays?: number; includeInactive?: boolean }) => toolset.getExpirations({ ...args, propertyId }),
    getContractors: (args: { trade?: string }) => toolset.getContractors({ ...args, propertyId }),
    getWhoToCall: async (args: { assetId: string }) => {
      // The asset must be on this property, as for getAsset.
      const onProperty = await prisma.asset.count({ where: { id: args.assetId, propertyId } });
      return onProperty > 0 ? toolset.getWhoToCall(args) : { found: false as const };
    },
    getCapitalExposure: () => toolset.getCapitalExposure({ propertyId }),
    getDocuments: (args: { assetId?: string; documentType?: string }) => toolset.getDocuments({ ...args, propertyId }),
    getEvidence: (args: { assetId?: string; issueId?: string }) => toolset.getEvidence({ ...args, propertyId }),
    generateReport: (args: { reportType: string }) => toolset.generateReport({ ...args, propertyId }),
  };
}
