import { AnthropicBedrock, AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  CompleteRequest,
  CompleteResult,
  ToolRequest,
  ToolResult,
  TokenUsage,
} from "./types.ts";
import { supportsAdaptiveThinking } from "./models.ts";

export type BedrockBackend = "invoke" | "mantle";

export interface BedrockProviderOptions {
  awsRegion?: string;
  /**
   * AWS named profile, e.g. "shopgeist-admin". The Mantle client takes this
   * directly; the invoke client resolves it from the AWS credential chain, so
   * it is exported into the environment instead.
   */
  awsProfile?: string;
  /**
   * Which Bedrock surface to call. "invoke" is the classic bedrock-runtime path
   * and works on accounts without Mantle enablement, which includes this one.
   */
  backend?: BedrockBackend;
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
  readonly name: string;
  readonly backend: BedrockBackend;
  private client: AnthropicBedrockMantle | AnthropicBedrock;

  constructor(opts: BedrockProviderOptions = {}) {
    this.backend = opts.backend ?? "invoke";
    this.name = `bedrock:${this.backend}`;
    const maxRetries = opts.maxRetries ?? 3;

    if (this.backend === "mantle") {
      this.client = new AnthropicBedrockMantle({
        ...(opts.awsRegion ? { awsRegion: opts.awsRegion } : {}),
        ...(opts.awsProfile ? { awsProfile: opts.awsProfile } : {}),
        maxRetries,
      });
    } else {
      // The invoke client has no profile option; it reads the standard chain.
      if (opts.awsProfile) process.env["AWS_PROFILE"] = opts.awsProfile;
      this.client = new AnthropicBedrock({
        ...(opts.awsRegion ? { awsRegion: opts.awsRegion } : {}),
        maxRetries,
      });
    }
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const res = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: buildSystem(req.system, req.cacheSystem ?? false),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      // Adaptive thinking 400s on pre-4.6 models, so it is only sent where the
      // configured model actually supports it.
      ...(req.thinking && supportsAdaptiveThinking(req.model)
        ? { thinking: { type: "adaptive" as const } }
        : {}),
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return {
      text,
      usage: readUsage(res.usage),
      model: req.model,
      stopReason: res.stop_reason,
      truncated: res.stop_reason === "max_tokens",
    };
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
