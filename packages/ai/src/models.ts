/**
 * Model IDs carry the `anthropic.` prefix on Bedrock Mantle.
 *
 * Access notes (checked 2026-09-09):
 *  - Haiku 4.5 and Sonnet 5 are open to all Bedrock customers.
 *  - Opus 5 requires a model-access request in the Bedrock console. If that
 *    request is not approved for the deploy account, set DRAFT_MODEL to
 *    `anthropic.claude-sonnet-5` explicitly rather than silently substituting.
 */
export const MODELS = {
  haiku: "anthropic.claude-haiku-4-5",
  sonnet: "anthropic.claude-sonnet-5",
  opus: "anthropic.claude-opus-5",
} as const;

export interface ModelRates {
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * ESTIMATES. These are Anthropic first-party rates; Bedrock's own per-token
 * rates for these models are not on the public pricing page. Confirm in the
 * Bedrock console and correct this table — every cost figure the CLI prints
 * derives from here.
 *
 * Regional Bedrock endpoints also carry a 10% premium over the global endpoint.
 */
export const RATES: Record<string, ModelRates> = {
  "anthropic.claude-haiku-4-5": { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
  "anthropic.claude-sonnet-5": { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 },
  "anthropic.claude-opus-5": { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
};

export function estimateCostUsd(model: string, usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): number {
  const r = RATES[model];
  if (!r) return 0;
  return (
    (usage.inputTokens * r.input +
      usage.outputTokens * r.output +
      usage.cacheReadTokens * r.cacheRead +
      usage.cacheWriteTokens * r.cacheWrite) /
    1_000_000
  );
}
