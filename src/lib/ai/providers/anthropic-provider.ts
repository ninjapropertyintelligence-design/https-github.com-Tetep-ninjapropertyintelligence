import Anthropic from "@anthropic-ai/sdk";
import {
  AIImageInput,
  AIProvider,
  AIStructuredImageResult,
  AIToolCallRecord,
  AIToolDefinition,
  AIToolExecutor,
  AIToolLoopResult,
  JSONSchemaObject,
} from "@/lib/ai/provider";

const MODEL = "claude-opus-5";
const MAX_ITERATIONS = 8;

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  supportsVision(): boolean {
    return true;
  }

  supportsStructuredOutput(): boolean {
    return true;
  }

  async generateResponse(params: { system: string; prompt: string }): Promise<string> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: params.system,
      messages: [{ role: "user", content: params.prompt }],
    });
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }

  async analyzeImage(params: {
    system: string;
    prompt: string;
    image: AIImageInput;
    schema: JSONSchemaObject;
  }): Promise<AIStructuredImageResult> {
    // Structured outputs constrain the reply to the schema, so the text block
    // is the JSON itself — no tool call needed to get a machine-readable answer.
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: params.system,
      output_config: { format: { type: "json_schema", schema: params.schema as unknown as Record<string, unknown> } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: params.image.mediaType as Anthropic.Base64ImageSource["media_type"],
                data: params.image.base64,
              },
            },
            { type: "text", text: params.prompt },
          ],
        },
      ],
    });

    const usage = response.usage
      ? { inputTokens: response.usage.input_tokens ?? 0, outputTokens: response.usage.output_tokens ?? 0 }
      : undefined;

    // A refusal or a truncated reply has no complete JSON in it. Said
    // plainly rather than handed to JSON.parse to fail on.
    if (response.stop_reason === "refusal") throw new Error("The AI provider declined to analyse this image");
    if (response.stop_reason === "max_tokens") throw new Error("The AI provider's answer was cut off");

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { output: JSON.parse(text), usage };
  }

  async runToolLoop(params: {
    system: string;
    userMessage: string;
    tools: AIToolDefinition[];
    executeTool: AIToolExecutor;
    maxIterations?: number;
  }): Promise<AIToolLoopResult> {
    const anthropicTools: Anthropic.Tool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: params.userMessage }];
    const toolCalls: AIToolCallRecord[] = [];
    const maxIterations = params.maxIterations ?? MAX_ITERATIONS;
    // Accumulated across iterations, and returned on every exit path below —
    // an early return that forgot it would report a long conversation as free.
    let inputTokens = 0;
    let outputTokens = 0;
    let sawUsage = false;
    const usage = () => (sawUsage ? { inputTokens, outputTokens } : undefined);

    for (let i = 0; i < maxIterations; i++) {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: params.system,
        tools: anthropicTools,
        messages,
      });

      if (response.usage) {
        inputTokens += response.usage.input_tokens ?? 0;
        outputTokens += response.usage.output_tokens ?? 0;
        sawUsage = true;
      }

      if (response.stop_reason !== "tool_use") {
        const answer = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return { answer, toolCalls, usage: usage() };
      }

      messages.push({ role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const args = (block.input ?? {}) as Record<string, unknown>;
        toolCalls.push({ tool: block.name, args });
        try {
          const result = await params.executeTool(block.name, args);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ error: err instanceof Error ? err.message : "Tool execution failed" }),
            is_error: true,
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }

    return { answer: "I wasn't able to finish answering within the allotted tool-call budget.", toolCalls, usage: usage() };
  }
}
