import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { SessionContext } from "@/lib/session-context";
import { makeAiTools } from "@/lib/ai/tools";
import { prisma } from "@/lib/prisma";

const SYSTEM_PROMPT = `You are Property AI, embedded in a commercial real estate intelligence platform.

Hard rules:
- You never invent health scores, risk scores, condition ratings, costs, or counts. Every number in your answer must come from a tool call result.
- If the tools return no data (or empty results) for what's asked, say plainly that there isn't enough data yet — never guess or estimate silently.
- Call tools to answer questions about properties, assets, issues, assessments, documents, evidence, or capital exposure. Don't answer from memory.
- Keep answers concise and decision-oriented: lead with the number/finding, then brief context. Reference specific properties/assets/issues by name so the user can click through.
- You are scoped to exactly what this user is authorized to see — if asked about something outside that (another org, an inaccessible region), say you don't have access rather than trying to answer.`;

export interface AskAiResult {
  answer: string;
  toolCalls: Array<{ tool: string; args: unknown }>;
  sourceRefs: Array<{ type: string; id: string }>;
  configured: boolean;
}

export async function askPropertyAI(
  ctx: SessionContext,
  question: string,
  propertyContext?: string,
): Promise<AskAiResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Honest degradation (spec §28): never fake an AI response. Configuration
    // is itself a form of "not enough data" the user needs to see plainly.
    return {
      answer:
        "AI is not configured in this environment (no ANTHROPIC_API_KEY set). The AI tool gateway, permission scoping, and query logging are implemented and unit-testable — connecting a real API key is the only remaining step.",
      toolCalls: [],
      sourceRefs: [],
      configured: false,
    };
  }

  const client = new Anthropic({ apiKey });
  const toolset = makeAiTools(ctx);
  const toolCalls: Array<{ tool: string; args: unknown }> = [];

  const wrap = <S extends z.ZodTypeAny>(name: string, description: string, schema: S, fn: (args: z.infer<S>) => Promise<unknown>) =>
    betaZodTool({
      name,
      description,
      inputSchema: schema,
      run: async (input: z.infer<S>) => {
        toolCalls.push({ tool: name, args: input });
        const result = await fn(input);
        return JSON.stringify(result);
      },
    });

  const tools = [
    wrap("getPortfolioSummary", "Org/portfolio-wide KPI summary: health, risk, CapEx, issue counts.", z.object({}), () => toolset.getPortfolioSummary()),
    wrap(
      "getProperties",
      "List properties in scope, optionally filtered.",
      z.object({
        region: z.string().optional().describe("Region ID"),
        healthBand: z.string().optional().describe("Excellent | Good | Needs Attention | Poor | Critical"),
        propertyType: z.string().optional(),
        search: z.string().optional(),
      }),
      (a) => toolset.getProperties(a),
    ),
    wrap("getProperty", "Full detail for one property.", z.object({ propertyId: z.string() }), (a) => toolset.getProperty(a)),
    wrap(
      "getAssets",
      "List assets, optionally filtered by property/type/criticality/status.",
      z.object({
        propertyId: z.string().optional(),
        assetType: z.string().optional(),
        minCriticality: z.number().int().min(1).max(5).optional(),
        status: z.string().optional(),
      }),
      (a) => toolset.getAssets(a),
    ),
    wrap("getAsset", "Full detail for one asset.", z.object({ assetId: z.string() }), (a) => toolset.getAsset(a)),
    wrap("getAssetHistory", "Condition change history for one asset.", z.object({ assetId: z.string() }), (a) => toolset.getAssetHistory(a)),
    wrap(
      "getIssues",
      "List issues, optionally filtered by property/severity/status.",
      z.object({ propertyId: z.string().optional(), severity: z.string().optional(), status: z.string().optional() }),
      (a) => toolset.getIssues(a),
    ),
    wrap(
      "getAssessments",
      "List assessments, optionally filtered by property/status.",
      z.object({ propertyId: z.string().optional(), status: z.string().optional() }),
      (a) => toolset.getAssessments(a),
    ),
    wrap("getCapitalExposure", "Capital exposure totals, org-wide or for one property.", z.object({ propertyId: z.string().optional() }), (a) => toolset.getCapitalExposure(a)),
    wrap("getPropertyHealth", "Latest computed health/risk/data-confidence snapshot for a property.", z.object({ propertyId: z.string() }), (a) => toolset.getPropertyHealth(a)),
    wrap(
      "getDocuments",
      "List documents, optionally filtered by property/asset/type.",
      z.object({ propertyId: z.string().optional(), assetId: z.string().optional(), documentType: z.string().optional() }),
      (a) => toolset.getDocuments(a),
    ),
    wrap("searchDocuments", "Keyword search over document titles.", z.object({ query: z.string() }), (a) => toolset.searchDocuments(a)),
    wrap(
      "getEvidence",
      "List evidence (photos/video/drone/matterport refs), optionally filtered.",
      z.object({ propertyId: z.string().optional(), assetId: z.string().optional(), issueId: z.string().optional() }),
      (a) => toolset.getEvidence(a),
    ),
    wrap("compareProperties", "Side-by-side health comparison of two properties.", z.object({ propertyIdA: z.string(), propertyIdB: z.string() }), (a) => toolset.compareProperties(a)),
    wrap("getChanges", "Recent events across accessible properties.", z.object({ sinceDays: z.number().int().positive().optional() }), (a) => toolset.getChanges(a)),
    wrap("generateReport", "Point the user to the report for a given type/property.", z.object({ reportType: z.string(), propertyId: z.string().optional() }), (a) => toolset.generateReport(a)),
  ];

  const startedAt = Date.now();
  const userMessage = propertyContext
    ? `[Current property context: ${propertyContext}]\n\n${question}`
    : question;

  const finalMessage = await client.beta.messages.toolRunner({
    model: "claude-opus-5",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools,
    messages: [{ role: "user", content: userMessage }],
  });

  const answer = finalMessage.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const latencyMs = Date.now() - startedAt;

  const result: AskAiResult = {
    answer: answer || "I wasn't able to produce an answer from the available data.",
    toolCalls,
    sourceRefs: toolset.refs,
    configured: true,
  };

  await prisma.aIQueryLog.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      question,
      toolCalls: toolCalls as never,
      answer: result.answer,
      sourceRefs: toolset.refs as never,
      wasDataSufficient: toolset.refs.length > 0 || toolCalls.length === 0,
      latencyMs,
    },
  });

  return result;
}
