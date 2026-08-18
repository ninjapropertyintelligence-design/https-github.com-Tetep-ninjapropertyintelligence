import { AIProvider, AIProviderNotConfiguredError, AIToolLoopResult } from "@/lib/ai/provider";

/**
 * Fallback when no provider is configured (missing API key, or
 * AI_PROVIDER set to an unsupported value). Every method throws
 * `AIProviderNotConfiguredError` — callers are required to handle that and
 * show an honest state rather than a fabricated answer (spec: never
 * invent an AI response).
 */
export class NullProvider implements AIProvider {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  supportsVision(): boolean {
    return false;
  }

  supportsStructuredOutput(): boolean {
    return false;
  }

  async generateResponse(): Promise<string> {
    throw new AIProviderNotConfiguredError(this.name);
  }

  async runToolLoop(): Promise<AIToolLoopResult> {
    throw new AIProviderNotConfiguredError(this.name);
  }
}
