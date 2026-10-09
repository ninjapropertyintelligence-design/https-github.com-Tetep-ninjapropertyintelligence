/**
 * Provider-independent AI abstraction (Phase 2 §1). The property tool
 * gateway (`src/lib/ai/tools.ts`) and everything that calls it stay
 * completely unaware of which LLM vendor is answering — they only ever see
 * this interface. Swapping providers, or falling back to "not configured",
 * never touches `tools.ts` or the API routes that call `askPropertyAI`.
 */

export interface JSONSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** A tool exposed to the model. Plain JSON Schema — no provider-specific SDK types leak into this layer. */
export interface AIToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchemaObject;
}

export interface AIToolCallRecord {
  tool: string;
  args: unknown;
}

/**
 * Token usage for a whole tool loop, summed across every iteration.
 *
 * Summing matters: each iteration resends the entire conversation so far, so
 * a five-step agentic answer costs far more than its last request reports.
 * Reading usage off the final response alone would undercount badly, and the
 * undercount grows with exactly the long tool-using conversations that cost
 * the most.
 */
export interface AITokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIToolLoopResult {
  answer: string;
  toolCalls: AIToolCallRecord[];
  /**
   * Undefined when the provider reported no usage at all. Undefined is not
   * zero: zero would be metered as a free call, when in truth the cost is
   * simply unknown. Callers must preserve that distinction.
   */
  usage?: AITokenUsage;
}

/** An image handed to a vision call, already read into memory by the caller. */
export interface AIImageInput {
  /** e.g. "image/jpeg". Providers accept jpeg, png, gif and webp. */
  mediaType: string;
  base64: string;
}

export interface AIStructuredImageResult {
  /** Parsed JSON, not yet validated — the caller owns validating it against its schema. */
  output: unknown;
  /** Undefined when the provider reported none; see `AITokenUsage`. */
  usage?: AITokenUsage;
}

export type AIToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface AIProvider {
  readonly name: string;
  supportsVision(): boolean;
  supportsStructuredOutput(): boolean;
  /** Single-shot text generation, no tools. */
  generateResponse(params: { system: string; prompt: string }): Promise<string>;
  /**
   * One image plus a prompt in, JSON matching `schema` out. Used by photo
   * analysis, which needs a machine-readable answer (a score, a severity),
   * not prose. The schema is plain JSON Schema with every property required
   * and `additionalProperties: false`, which is the strictest form all three
   * vendors accept.
   */
  analyzeImage(params: {
    system: string;
    prompt: string;
    image: AIImageInput;
    schema: JSONSchemaObject;
  }): Promise<AIStructuredImageResult>;
  /** Agentic tool-calling loop: the model calls tools, the caller's `executeTool` runs them, repeat until the model stops. */
  runToolLoop(params: {
    system: string;
    userMessage: string;
    tools: AIToolDefinition[];
    executeTool: AIToolExecutor;
    maxIterations?: number;
  }): Promise<AIToolLoopResult>;
}

/** Thrown by every method on the null/fallback provider — callers catch this to show an honest "not configured" state instead of fabricating an answer. */
export class AIProviderNotConfiguredError extends Error {
  constructor(public providerName: string) {
    super(`AI provider "${providerName}" is not configured (missing API key or unsupported).`);
    this.name = "AIProviderNotConfiguredError";
  }
}
