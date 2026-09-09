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
   * Cache the system prompt. Prompt caching IS supported on Bedrock and the
   * scoring rubric is identical across every call, so this is close to free money.
   */
  cacheSystem?: boolean;
  thinking?: boolean;
}

export interface CompleteResult {
  text: string;
  usage: TokenUsage;
  model: string;
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
