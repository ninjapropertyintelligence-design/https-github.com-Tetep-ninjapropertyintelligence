import { AIProvider } from "@/lib/ai/provider";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic-provider";
import { OpenAIProvider } from "@/lib/ai/providers/openai-provider";
import { NullProvider } from "@/lib/ai/providers/null-provider";

/**
 * Provider selection: `AI_PROVIDER` env var today ("anthropic" | "openai" |
 * "none"), defaulting to "anthropic". Organization-level override is the
 * natural next step (a column on Organization read here before the env
 * var) — not built yet since nothing in the product surfaces it, but this
 * is the single choke point where that would plug in without touching any
 * caller.
 */
export function getAIProvider(): AIProvider {
  const selected = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();

  if (selected === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    return apiKey ? new OpenAIProvider(apiKey) : new NullProvider("openai");
  }

  if (selected === "none") {
    return new NullProvider("none");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new AnthropicProvider(apiKey) : new NullProvider("anthropic");
}
