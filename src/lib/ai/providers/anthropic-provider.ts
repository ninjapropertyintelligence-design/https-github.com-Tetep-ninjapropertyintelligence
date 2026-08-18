import Anthropic from "@anthropic-ai/sdk";
import { AIProvider, AIToolCallRecord, AIToolDefinition, AIToolExecutor, AIToolLoopResult } from "@/lib/ai/provider";

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

    for (let i = 0; i < maxIterations; i++) {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: params.system,
        tools: anthropicTools,
        messages,
      });

      if (response.stop_reason !== "tool_use") {
        const answer = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return { answer, toolCalls };
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

    return { answer: "I wasn't able to finish answering within the allotted tool-call budget.", toolCalls };
  }
}
