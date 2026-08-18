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

export interface AIToolLoopResult {
  answer: string;
  toolCalls: AIToolCallRecord[];
}

export type AIToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface AIProvider {
  readonly name: string;
  supportsVision(): boolean;
  supportsStructuredOutput(): boolean;
  /** Single-shot text generation, no tools. */
  generateResponse(params: { system: string; prompt: string }): Promise<string>;
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
