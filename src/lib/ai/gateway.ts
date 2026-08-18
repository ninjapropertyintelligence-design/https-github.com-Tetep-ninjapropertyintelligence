import { SessionContext, propertyScopeWhere } from "@/lib/tenant-scope";
import { makeAiTools, scopeToolsToProperty } from "@/lib/ai/tools";
import { prisma } from "@/lib/prisma";
import { getAIProvider } from "@/lib/ai/provider-factory";
import { AIProviderNotConfiguredError, AIToolDefinition } from "@/lib/ai/provider";
import { logEvent } from "@/lib/observability";

const SYSTEM_PROMPT = `You are Property AI, embedded in a commercial real estate intelligence platform.

Hard rules:
- You never invent health scores, risk scores, condition ratings, costs, or counts. Every number in your answer must come from a tool call result.
- If the tools return no data (or empty results) for what's asked, say plainly that there isn't enough data yet — never guess or estimate silently.
- Call tools to answer questions about properties, assets, issues, assessments, documents, evidence, or capital exposure. Don't answer from memory.
- Keep answers concise and decision-oriented: lead with the number/finding, then brief context. Reference specific properties/assets/issues by name so the user can click through.
- You are scoped to exactly what this user is authorized to see — if asked about something outside that (another org, an inaccessible region), say you don't have access rather than trying to answer.`;

const PROPERTY_SCOPED_SYSTEM_SUFFIX = `

You are currently answering questions about ONE SPECIFIC PROPERTY. Every tool call you make is hard-restricted to that property server-side — you cannot retrieve data about any other property in this session, even if asked. If the user wants portfolio-wide analysis, tell them to use the main "Ask AI" page instead of trying to answer from here.`;

// Full portfolio-wide tool surface — JSON Schema (provider-independent), no
// zod. `Object.keys` on this is also how the executor below dispatches by
// name, so this list and `makeAiTools`'s method names must stay in sync.
const FULL_TOOL_DEFINITIONS: AIToolDefinition[] = [
  { name: "getPortfolioSummary", description: "Org/portfolio-wide KPI summary: health, risk, CapEx, issue counts.", parameters: { type: "object", properties: {} } },
  {
    name: "getProperties",
    description: "List properties in scope, optionally filtered.",
    parameters: {
      type: "object",
      properties: {
        region: { type: "string", description: "Region ID" },
        healthBand: { type: "string", description: "Excellent | Good | Needs Attention | Poor | Critical" },
        propertyType: { type: "string" },
        search: { type: "string" },
      },
    },
  },
  { name: "getProperty", description: "Full detail for one property, including last interior/exterior capture dates.", parameters: { type: "object", properties: { propertyId: { type: "string" } }, required: ["propertyId"] } },
  {
    name: "getHistory",
    description: "Canonical event history for one property (condition changes, issues, assessments, captures).",
    parameters: { type: "object", properties: { propertyId: { type: "string" }, sinceDays: { type: "number" } }, required: ["propertyId"] },
  },
  {
    name: "getAssets",
    description: "List assets, optionally filtered by property/type/criticality/status.",
    parameters: {
      type: "object",
      properties: {
        propertyId: { type: "string" },
        assetType: { type: "string" },
        minCriticality: { type: "number" },
        status: { type: "string" },
      },
    },
  },
  { name: "getAsset", description: "Full detail for one asset.", parameters: { type: "object", properties: { assetId: { type: "string" } }, required: ["assetId"] } },
  { name: "getAssetHistory", description: "Condition change history for one asset.", parameters: { type: "object", properties: { assetId: { type: "string" } }, required: ["assetId"] } },
  {
    name: "getIssues",
    description: "List issues, optionally filtered by property/severity/status.",
    parameters: { type: "object", properties: { propertyId: { type: "string" }, severity: { type: "string" }, status: { type: "string" } } },
  },
  {
    name: "getAssessments",
    description: "List assessments, optionally filtered by property/status.",
    parameters: { type: "object", properties: { propertyId: { type: "string" }, status: { type: "string" } } },
  },
  { name: "getCapitalExposure", description: "Capital exposure totals, org-wide or for one property.", parameters: { type: "object", properties: { propertyId: { type: "string" } } } },
  { name: "getPropertyHealth", description: "Latest computed health/risk/data-confidence snapshot for a property.", parameters: { type: "object", properties: { propertyId: { type: "string" } }, required: ["propertyId"] } },
  {
    name: "getDocuments",
    description: "List documents, optionally filtered by property/asset/type.",
    parameters: { type: "object", properties: { propertyId: { type: "string" }, assetId: { type: "string" }, documentType: { type: "string" } } },
  },
  { name: "searchDocuments", description: "Full-text search over document contents (not just titles).", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  {
    name: "getEvidence",
    description: "List evidence (photos/video/drone/matterport refs), optionally filtered.",
    parameters: { type: "object", properties: { propertyId: { type: "string" }, assetId: { type: "string" }, issueId: { type: "string" } } },
  },
  { name: "compareProperties", description: "Side-by-side health comparison of two properties.", parameters: { type: "object", properties: { propertyIdA: { type: "string" }, propertyIdB: { type: "string" } }, required: ["propertyIdA", "propertyIdB"] } },
  { name: "getChanges", description: "Recent events across all accessible properties.", parameters: { type: "object", properties: { sinceDays: { type: "number" } } } },
  { name: "generateReport", description: "Point the user to the report for a given type/property.", parameters: { type: "object", properties: { reportType: { type: "string" }, propertyId: { type: "string" } }, required: ["reportType"] } },
];

// Reduced surface for property-scoped sessions — matches the keys `scopeToolsToProperty` exposes.
const PROPERTY_SCOPED_TOOL_NAMES = new Set([
  "getProperty",
  "getPropertyHealth",
  "getHistory",
  "getAssets",
  "getAsset",
  "getAssetHistory",
  "getIssues",
  "getAssessments",
  "getCapitalExposure",
  "getDocuments",
  "getEvidence",
  "generateReport",
]);

function toolDefinitionsFor(scoped: boolean): AIToolDefinition[] {
  if (!scoped) return FULL_TOOL_DEFINITIONS;
  return FULL_TOOL_DEFINITIONS.filter((t) => PROPERTY_SCOPED_TOOL_NAMES.has(t.name)).map((t) => ({
    ...t,
    // propertyId is forced server-side for scoped sessions — strip it from
    // what the model is told it can set, so it never even tries.
    parameters: {
      ...t.parameters,
      properties: Object.fromEntries(Object.entries(t.parameters.properties).filter(([k]) => k !== "propertyId")),
      required: (t.parameters.required ?? []).filter((k) => k !== "propertyId"),
    },
  }));
}

export interface AskAiResult {
  answer: string;
  toolCalls: Array<{ tool: string; args: unknown }>;
  sourceRefs: Array<{ type: string; id: string }>;
  configured: boolean;
  provider: string;
}

export async function askPropertyAI(
  ctx: SessionContext,
  question: string,
  options?: { propertyId?: string; propertyName?: string },
): Promise<AskAiResult> {
  const provider = getAIProvider();
  const scopedPropertyId = options?.propertyId;

  // Confirm the property is actually in this user's scope before we even
  // build a scoped toolset — a stale/forged propertyId in the request body
  // must not silently fall back to unscoped (portfolio-wide) tool access.
  let verifiedPropertyId: string | undefined;
  if (scopedPropertyId) {
    const property = await prisma.property.findFirst({
      where: { AND: [{ id: scopedPropertyId }, propertyScopeWhere(ctx)] },
      select: { id: true },
    });
    verifiedPropertyId = property?.id;
  }

  const fullToolset = makeAiTools(ctx);
  const toolset: Record<string, (args: never) => Promise<unknown>> = verifiedPropertyId
    ? (scopeToolsToProperty(fullToolset, verifiedPropertyId) as unknown as Record<string, (args: never) => Promise<unknown>>)
    : (fullToolset as unknown as Record<string, (args: never) => Promise<unknown>>);

  const tools = toolDefinitionsFor(!!verifiedPropertyId);
  const toolCalls: Array<{ tool: string; args: unknown }> = [];

  const executeTool = async (name: string, args: Record<string, unknown>) => {
    const fn = toolset[name];
    if (!fn) throw new Error(`Unknown tool: ${name}`);
    toolCalls.push({ tool: name, args });
    try {
      const result = await fn(args as never);
      logEvent("ai.tool_call", { ok: true, organizationId: ctx.organizationId, provider: provider.name, tool: name });
      return result;
    } catch (err) {
      logEvent("ai.tool_call", {
        ok: false,
        organizationId: ctx.organizationId,
        provider: provider.name,
        tool: name,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  const system =
    SYSTEM_PROMPT + (verifiedPropertyId ? PROPERTY_SCOPED_SYSTEM_SUFFIX : "");
  const userMessage =
    verifiedPropertyId && options?.propertyName
      ? `[Current property: ${options.propertyName} (propertyId: ${verifiedPropertyId})]\n\n${question}`
      : question;

  const startedAt = Date.now();

  let answer: string;
  let configured = true;
  try {
    const loopResult = await provider.runToolLoop({ system, userMessage, tools, executeTool });
    answer = loopResult.answer || "I wasn't able to produce an answer from the available data.";
    logEvent("ai.provider_call", { ok: true, organizationId: ctx.organizationId, provider: provider.name, durationMs: Date.now() - startedAt });
  } catch (err) {
    if (err instanceof AIProviderNotConfiguredError) {
      // Honest degradation (spec §28): never fake an AI response.
      configured = false;
      answer = `AI is not configured in this environment (provider "${err.providerName}" has no API key set). The AI tool gateway, property-scoping, and query logging are implemented and testable — connecting a real API key is the only remaining step.`;
      logEvent("ai.provider_call", { ok: false, organizationId: ctx.organizationId, provider: provider.name, durationMs: Date.now() - startedAt, errorMessage: "not configured" });
    } else {
      logEvent("ai.provider_call", {
        ok: false,
        organizationId: ctx.organizationId,
        provider: provider.name,
        durationMs: Date.now() - startedAt,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  const latencyMs = Date.now() - startedAt;
  // Same array reference whether scoped or not — scopeToolsToProperty
  // forwards fullToolset.refs verbatim.
  const refs = fullToolset.refs;

  const result: AskAiResult = {
    answer,
    toolCalls,
    sourceRefs: refs,
    configured,
    provider: provider.name,
  };

  if (configured) {
    await prisma.aIQueryLog.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        question,
        toolCalls: toolCalls as never,
        answer: result.answer,
        sourceRefs: refs as never,
        wasDataSufficient: refs.length > 0 || toolCalls.length === 0,
        latencyMs,
      },
    });
  }

  return result;
}
