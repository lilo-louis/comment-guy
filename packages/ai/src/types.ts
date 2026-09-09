export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompleteRequest {
  model: string;
  system: string;
  messages: AIMessage[];
  maxTokens: number;
  /**
   * Cache the system prompt.
   *
   * Verified working on Bedrock — but only above the model's minimum cacheable
   * prefix (2048 tokens on Haiku 4.5). Below that the cache is silently skipped.
   *
   * Measured on a live run: the drafter's system prompt (~2.2k tokens once the
   * voice profile is embedded) caches and reads back ~2.2k tokens per call. The
   * scorer's rubric (~875 tokens) is under the minimum and is NOT cached — it
   * costs roughly $0.80/month in re-billed tokens at target volume, which is
   * why padding it has not been worth doing.
   *
   * Check `usage.cacheReadTokens` in the run output rather than assuming.
   */
  cacheSystem?: boolean;
  thinking?: boolean;
}

export interface CompleteResult {
  text: string;
  usage: TokenUsage;
  model: string;
  /**
   * Why generation stopped. `max_tokens` with empty text means the budget was
   * spent before any text was emitted — surfaced explicitly because it is
   * otherwise indistinguishable from the model choosing to say nothing.
   */
  stopReason: string | null;
  truncated: boolean;
}

export interface ToolRequest<T> extends CompleteRequest {
  toolName: string;
  toolDescription: string;
  /** JSON Schema for the tool input. The model is forced to call this tool. */
  schema: Record<string, unknown>;
  /** Runtime validation — the API guarantees shape, not semantics. */
  parse: (raw: unknown) => T;
}

export interface ToolResult<T> {
  value: T;
  usage: TokenUsage;
  model: string;
}

/**
 * The seam between the engine and whichever model backend is configured.
 *
 * Bedrock does NOT support structured outputs, so JSON comes back through
 * forced tool use (`completeWithTool`) rather than `output_config.format`.
 */
export interface AIProvider {
  readonly name: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
  completeWithTool<T>(req: ToolRequest<T>): Promise<ToolResult<T>>;
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}
