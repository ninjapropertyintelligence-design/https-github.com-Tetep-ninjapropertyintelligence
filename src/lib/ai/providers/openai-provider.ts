import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionFunctionTool, ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import { AIProvider, AIToolCallRecord, AIToolDefinition, AIToolExecutor, AIToolLoopResult } from "@/lib/ai/provider";

const MODEL = "gpt-5.5";
const MAX_ITERATIONS = 8;

/**
 * Uses the Chat Completions API rather than the newer Responses API: it's
 * the long-term-supported, narrower surface ("supported indefinitely" per
 * the OpenAI SDK), which is the safer choice for an integration nobody in
 * this environment has credentials to exercise against the live API yet.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  supportsVision(): boolean {
    return true;
  }

  supportsStructuredOutput(): boolean {
    return true;
  }

  async generateResponse(params: { system: string; prompt: string }): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.prompt },
      ],
    });
    return completion.choices[0]?.message?.content?.trim() ?? "";
  }

  async runToolLoop(params: {
    system: string;
    userMessage: string;
    tools: AIToolDefinition[];
    executeTool: AIToolExecutor;
    maxIterations?: number;
  }): Promise<AIToolLoopResult> {
    const openaiTools: ChatCompletionFunctionTool[] = params.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters as unknown as Record<string, unknown> },
    }));

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: params.system },
      { role: "user", content: params.userMessage },
    ];
    const toolCalls: AIToolCallRecord[] = [];
    const maxIterations = params.maxIterations ?? MAX_ITERATIONS;

    for (let i = 0; i < maxIterations; i++) {
      const completion = await this.client.chat.completions.create({
        model: MODEL,
        messages,
        tools: openaiTools,
      });

      const message = completion.choices[0]?.message;
      if (!message) {
        return { answer: "The AI provider returned no response.", toolCalls };
      }

      const functionCalls = (message.tool_calls ?? []).filter(
        (c): c is ChatCompletionMessageFunctionToolCall => c.type === "function",
      );

      if (functionCalls.length === 0) {
        return { answer: (message.content ?? "").trim(), toolCalls };
      }

      messages.push(message);

      for (const call of functionCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // Malformed JSON from the model — treat as empty args rather than crashing the loop.
        }
        toolCalls.push({ tool: call.function.name, args });
        try {
          const result = await params.executeTool(call.function.name, args);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        } catch (err) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: err instanceof Error ? err.message : "Tool execution failed" }),
          });
        }
      }
    }

    return { answer: "I wasn't able to finish answering within the allotted tool-call budget.", toolCalls };
  }
}
