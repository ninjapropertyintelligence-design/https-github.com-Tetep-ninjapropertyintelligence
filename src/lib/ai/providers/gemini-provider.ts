import type {
  AIProvider,
  AIToolCallRecord,
  AIToolDefinition,
  AIToolExecutor,
  AIToolLoopResult,
  JSONSchemaObject,
} from "@/lib/ai/provider";

/**
 * Google Gemini, behind the same provider interface as Anthropic and OpenAI.
 *
 * Uses the REST endpoint through `fetch` rather than an SDK. The other two
 * providers use official SDKs, so this is the odd one out and the reason is
 * worth stating: `generateContent` is a small, stable surface, and calling it
 * directly avoids adding a dependency for one endpoint. If Gemini becomes the
 * primary provider, moving to @google/genai is a contained change behind this
 * same class.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Pinned to a specific model, not `gemini-flash-latest`. An auto-updating
 * alias means the model can change under a running deployment, which is
 * exactly the kind of silent behaviour change that makes an AI answer
 * suddenly different with no code change to point at.
 *
 * NOTE ON PICKING THIS: `models.list` is not a list of models you can call.
 * `gemini-2.5-flash` and `gemini-2.5-pro` are both returned by it and both
 * reject requests with "no longer available to new users" — the listing
 * includes models the key cannot actually use. Every candidate here was
 * verified with a real generateContent call before being chosen.
 */
const MODEL = "gemini-3.6-flash";

const MAX_ITERATIONS = 8;

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{ content?: GeminiContent; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
}

/**
 * Gemini accepts a SUBSET of JSON Schema and rejects the request outright on
 * fields it does not know — `additionalProperties` and `$schema` among them.
 * The tool definitions in this codebase are plain JSON Schema by design, so
 * they are trimmed here rather than weakened at the source for one vendor.
 */
function toGeminiSchema(schema: JSONSchemaObject): Record<string, unknown> {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === "additionalProperties" || k === "$schema") continue;
        out[k] = strip(v);
      }
      return out;
    }
    return value;
  };
  return strip(schema) as Record<string, unknown>;
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";

  constructor(private readonly apiKey: string) {}

  supportsVision(): boolean {
    return true;
  }

  supportsStructuredOutput(): boolean {
    return true;
  }

  private async call(body: Record<string, unknown>): Promise<GeminiResponse> {
    const res = await fetch(`${API_BASE}/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Header rather than ?key=, so the credential never lands in a URL
        // that might be logged by a proxy or an error reporter.
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) {
      throw new Error(
        `Gemini request failed (${res.status}): ${json.error?.message ?? "no message"}`,
      );
    }
    return json;
  }

  private static textOf(content: GeminiContent | undefined): string {
    return (content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
  }

  async generateResponse(params: { system: string; prompt: string }): Promise<string> {
    const json = await this.call({
      systemInstruction: { parts: [{ text: params.system }] },
      contents: [{ role: "user", parts: [{ text: params.prompt }] }],
    });
    return GeminiProvider.textOf(json.candidates?.[0]?.content);
  }

  async runToolLoop(params: {
    system: string;
    userMessage: string;
    tools: AIToolDefinition[];
    executeTool: AIToolExecutor;
    maxIterations?: number;
  }): Promise<AIToolLoopResult> {
    const functionDeclarations = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toGeminiSchema(t.parameters),
    }));

    const contents: GeminiContent[] = [
      { role: "user", parts: [{ text: params.userMessage }] },
    ];
    const toolCalls: AIToolCallRecord[] = [];
    const maxIterations = params.maxIterations ?? MAX_ITERATIONS;

    // Summed across iterations, like the other providers: each turn resends
    // the whole conversation, so reading usage off the final response alone
    // would undercount, and undercount most for long tool-using answers.
    let inputTokens = 0;
    let outputTokens = 0;
    let sawUsage = false;
    const usage = () => (sawUsage ? { inputTokens, outputTokens } : undefined);

    for (let i = 0; i < maxIterations; i += 1) {
      const json = await this.call({
        systemInstruction: { parts: [{ text: params.system }] },
        contents,
        ...(functionDeclarations.length > 0 ? { tools: [{ functionDeclarations }] } : {}),
      });

      if (json.usageMetadata) {
        inputTokens += json.usageMetadata.promptTokenCount ?? 0;
        outputTokens += json.usageMetadata.candidatesTokenCount ?? 0;
        sawUsage = true;
      }

      const content = json.candidates?.[0]?.content;
      const calls = (content?.parts ?? []).filter(
        (p): p is GeminiPart & { functionCall: { name: string; args?: Record<string, unknown> } } =>
          p.functionCall !== undefined,
      );

      if (calls.length === 0) {
        return { answer: GeminiProvider.textOf(content), toolCalls, usage: usage() };
      }

      // The model's own turn must be echoed back verbatim, or the follow-up
      // function responses have nothing to attach to.
      contents.push({ role: "model", parts: content?.parts ?? [] });

      const responseParts: GeminiPart[] = [];
      for (const call of calls) {
        const args = call.functionCall.args ?? {};
        toolCalls.push({ tool: call.functionCall.name, args });
        try {
          const result = await params.executeTool(call.functionCall.name, args);
          responseParts.push({
            functionResponse: {
              name: call.functionCall.name,
              // Gemini requires an object here; a bare array or scalar is
              // rejected, so anything else is wrapped.
              response:
                result !== null && typeof result === "object" && !Array.isArray(result)
                  ? (result as Record<string, unknown>)
                  : { result },
            },
          });
        } catch (err) {
          // Hand the failure back to the model rather than aborting: it can
          // often recover by asking for something else.
          responseParts.push({
            functionResponse: {
              name: call.functionCall.name,
              response: { error: err instanceof Error ? err.message : "Tool execution failed" },
            },
          });
        }
      }
      contents.push({ role: "user", parts: responseParts });
    }

    return {
      answer: "I wasn't able to finish answering within the allotted tool-call budget.",
      toolCalls,
      usage: usage(),
    };
  }
}

/** Exposed for tests: the schema trimming is where a vendor quirk silently bites. */
export { toGeminiSchema as __toGeminiSchemaForTest };
