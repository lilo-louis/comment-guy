import type {
  AIProvider,
  CompleteRequest,
  CompleteResult,
  ToolRequest,
  ToolResult,
  TokenUsage,
} from "./types.ts";

/** Cheap deterministic hash so stub output is stable across runs. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function fakeUsage(req: { system: string; messages: { content: string }[] }): TokenUsage {
  const chars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0);
  return {
    inputTokens: Math.ceil(chars / 4),
    outputTokens: 120,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export interface StubHandlers {
  /** Keyed by tool name. Return the value the tool call should yield. */
  tools?: Record<string, (req: ToolRequest<unknown>) => unknown>;
  text?: (req: CompleteRequest) => string;
}

/**
 * Costs nothing and touches no network. Used by unit tests and `cg run --dry`
 * to exercise the whole pipeline's wiring without spending money.
 */
export class StubProvider implements AIProvider {
  readonly name = "stub";
  calls: { kind: "complete" | "tool"; model: string; toolName?: string }[] = [];

  private handlers: StubHandlers;

  constructor(handlers: StubHandlers = {}) {
    this.handlers = handlers;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    this.calls.push({ kind: "complete", model: req.model });
    const text =
      this.handlers.text?.(req) ??
      `Stub draft ${hash(req.messages.map((m) => m.content).join("")) % 1000}. Specific, short, no link.`;
    return { text, usage: fakeUsage(req), model: req.model, stopReason: "end_turn", truncated: false };
  }

  async completeWithTool<T>(req: ToolRequest<T>): Promise<ToolResult<T>> {
    this.calls.push({ kind: "tool", model: req.model, toolName: req.toolName });
    const handler = this.handlers.tools?.[req.toolName];
    if (!handler) {
      throw new Error(
        `StubProvider has no handler for tool "${req.toolName}". Register one in StubHandlers.tools.`,
      );
    }
    return { value: req.parse(handler(req as ToolRequest<unknown>)), usage: fakeUsage(req), model: req.model };
  }
}
