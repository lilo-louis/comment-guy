import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  CompleteRequest,
  CompleteResult,
  ToolRequest,
  ToolResult,
  TokenUsage,
} from "./types.ts";

export interface BedrockProviderOptions {
  awsRegion?: string;
  /** AWS named profile, e.g. "shopgeist-admin". */
  awsProfile?: string;
  maxRetries?: number;
}

function readUsage(usage: Anthropic.Usage | undefined): TokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}

function buildSystem(system: string, cache: boolean): Anthropic.TextBlockParam[] {
  const block: Anthropic.TextBlockParam = { type: "text", text: system };
  if (cache) block.cache_control = { type: "ephemeral" };
  return [block];
}

export class BedrockProvider implements AIProvider {
  readonly name = "bedrock";
  private client: AnthropicBedrockMantle;

  constructor(opts: BedrockProviderOptions = {}) {
    this.client = new AnthropicBedrockMantle({
      ...(opts.awsRegion ? { awsRegion: opts.awsRegion } : {}),
      ...(opts.awsProfile ? { awsProfile: opts.awsProfile } : {}),
      maxRetries: opts.maxRetries ?? 3,
    });
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const res = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: buildSystem(req.system, req.cacheSystem ?? false),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(req.thinking ? { thinking: { type: "adaptive" as const } } : {}),
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return { text, usage: readUsage(res.usage), model: req.model };
  }

  /**
   * Bedrock does not support structured outputs, so JSON comes back by forcing
   * a tool call and reading its validated input. Thinking is deliberately not
   * enabled here — forced tool choice and thinking are not compatible.
   */
  async completeWithTool<T>(req: ToolRequest<T>): Promise<ToolResult<T>> {
    const res = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: buildSystem(req.system, req.cacheSystem ?? false),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: [
        {
          name: req.toolName,
          description: req.toolDescription,
          input_schema: req.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: req.toolName },
    });

    const call = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === req.toolName,
    );
    if (!call) {
      throw new Error(
        `Model ${req.model} returned no ${req.toolName} tool call (stop_reason=${res.stop_reason})`,
      );
    }

    return { value: req.parse(call.input), usage: readUsage(res.usage), model: req.model };
  }
}
