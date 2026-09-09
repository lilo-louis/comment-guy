/**
 * Bedrock exposes Claude through two different surfaces, and which model IDs
 * work depends on which one the account is enabled for:
 *
 *  - "mantle"  — the newer Messages-API endpoint (bedrock-mantle). Short IDs
 *                like `anthropic.claude-opus-5`. Needs separate enablement;
 *                on an account without it every model returns 403
 *                "not available for this account", even open-access ones.
 *  - "invoke"  — the classic bedrock-runtime InvokeModel path. Dated IDs behind
 *                a cross-region inference profile (`us.` / `global.` prefix).
 *
 * Verified against account 139830186180 on 2026-09-09: Mantle is NOT enabled,
 * and on the invoke path Sonnet 5 / Opus 5 / Opus 4.8 / Opus 4.7 are all denied.
 * The IDs below are the ones that actually answered.
 */
export const MODELS = {
  /** Cheap high-volume classifier. Scoring and the slop gate. */
  haiku: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  /** Newest-generation model available here. Drafting default. */
  sonnet: "global.anthropic.claude-sonnet-4-6",
  /** Higher tier but an older generation. Alternative drafting model. */
  opus: "us.anthropic.claude-opus-4-5-20251101-v1:0",
} as const;

/** Mantle IDs, for when the account is enabled for that endpoint. */
export const MANTLE_MODELS = {
  haiku: "anthropic.claude-haiku-4-5",
  sonnet: "anthropic.claude-sonnet-5",
  opus: "anthropic.claude-opus-5",
} as const;

/**
 * Adaptive thinking is only valid on 4.6-and-later models. Older models take a
 * `budget_tokens` config instead, and sending them `{type:"adaptive"}` is a 400.
 * Anything not listed here simply runs without thinking.
 */
const ADAPTIVE_THINKING = [
  "claude-sonnet-4-6", "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8",
  "claude-sonnet-5", "claude-opus-5", "claude-fable-5",
];

export function supportsAdaptiveThinking(model: string): boolean {
  return ADAPTIVE_THINKING.some((m) => model.includes(m));
}

export interface ModelRates {
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * ESTIMATES, keyed by a substring of the model id so inference-profile prefixes
 * and date suffixes both match. Bedrock's published rates for the newest models
 * are not on the public pricing page; these are first-party rates. Correct this
 * table from the console — every cost figure the CLI prints comes from here.
 */
const RATE_TABLE: [string, ModelRates][] = [
  ["claude-haiku-4-5", { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 }],
  ["claude-sonnet-4-6", { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 }],
  ["claude-sonnet-4-5", { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 }],
  ["claude-sonnet-5", { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 }],
  ["claude-opus-4-5", { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 }],
  ["claude-opus-4-7", { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 }],
  ["claude-opus-4-8", { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 }],
  ["claude-opus-5", { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 }],
];

export function ratesFor(model: string): ModelRates | undefined {
  return RATE_TABLE.find(([key]) => model.includes(key))?.[1];
}

export function estimateCostUsd(model: string, usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): number {
  const r = ratesFor(model);
  if (!r) return 0;
  return (
    (usage.inputTokens * r.input +
      usage.outputTokens * r.output +
      usage.cacheReadTokens * r.cacheRead +
      usage.cacheWriteTokens * r.cacheWrite) /
    1_000_000
  );
}
