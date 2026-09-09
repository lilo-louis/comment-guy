import type { AIProvider, TokenUsage } from "@cg/ai";
import { EMPTY_USAGE } from "@cg/ai";
import type { SlopFailure, SlopGateResult } from "@cg/domain";
import type { EngineConfig } from "./config.ts";
import { SLOP_SYSTEM, SLOP_USER } from "./prompts/slop.ts";

const URL_RE = /https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}/i;

/**
 * Free checks. These catch the failures that are decidable without a model —
 * links, banned phrases, length, product mentions — so the model call is only
 * spent on the judgment calls it is actually needed for.
 */
export function deterministicSlopCheck(
  text: string,
  config: EngineConfig,
): { failures: SlopFailure[]; notes: string[] } {
  const failures: SlopFailure[] = [];
  const notes: string[] = [];
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (trimmed.length === 0) {
    return { failures: ["EMPTY"], notes: ["draft was empty"] };
  }
  if (URL_RE.test(trimmed)) {
    failures.push("CONTAINS_LINK");
    notes.push("contains a URL");
  }
  if (trimmed.length > config.drafting.maxReplyChars) {
    failures.push("TOO_LONG");
    notes.push(`${trimmed.length} chars, limit ${config.drafting.maxReplyChars}`);
  }
  for (const term of config.slop.forbiddenTerms) {
    if (lower.includes(term.toLowerCase())) {
      failures.push("MENTIONS_SHOPGEIST");
      notes.push(`mentions "${term}"`);
    }
  }
  for (const phrase of config.slop.bannedPhrases) {
    if (lower.includes(phrase.toLowerCase())) {
      failures.push("BANNED_PHRASE");
      notes.push(`banned phrase "${phrase}"`);
      break;
    }
  }
  // "Not X, but Y" — the single most recognisable AI construction.
  if (/\bnot\s+[^.,;]{2,40},?\s+but\s+/i.test(trimmed)) {
    failures.push("CORPORATE_TONE");
    notes.push('uses the "not X, but Y" construction');
  }

  return { failures: [...new Set(failures)], notes };
}

const SLOP_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["PASS", "FAIL"] },
    failures: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "GENERIC_PRAISE", "RESTATES_POST", "PROMOTIONAL", "MENTIONS_SHOPGEIST",
          "CONTAINS_LINK", "CORPORATE_TONE", "FAKE_ANECDOTE", "TOO_LONG",
          "BANNED_PHRASE", "REPETITIVE", "NOT_SPECIFIC", "EMPTY",
        ],
      },
    },
    notes: { type: "string", description: "One sentence on what is actually wrong, or why it passes." },
  },
  required: ["verdict", "failures", "notes"],
  additionalProperties: false,
} as const;

interface RawSlop {
  verdict: "PASS" | "FAIL";
  failures: SlopFailure[];
  notes: string;
}

export interface SlopCheckResult {
  result: SlopGateResult;
  usage: TokenUsage;
}

/**
 * Deterministic checks first; the model only sees drafts that survived them.
 * A draft that fails for free never costs a token.
 */
export async function runSlopGate(
  draftText: string,
  postText: string,
  ai: AIProvider,
  config: EngineConfig,
): Promise<SlopCheckResult> {
  const cheap = deterministicSlopCheck(draftText, config);
  if (cheap.failures.length > 0) {
    return {
      result: { passed: false, failures: cheap.failures, notes: cheap.notes.join("; ") },
      usage: EMPTY_USAGE,
    };
  }

  const res = await ai.completeWithTool<RawSlop>({
    model: config.models.slopGate,
    system: SLOP_SYSTEM(config),
    cacheSystem: true,
    maxTokens: 512,
    messages: [{ role: "user", content: SLOP_USER(postText, draftText) }],
    toolName: "submit_verdict",
    toolDescription: "Return whether this reply may be posted.",
    schema: SLOP_SCHEMA as unknown as Record<string, unknown>,
    parse: (raw) => raw as RawSlop,
  });

  const failures = res.value.failures ?? [];
  const passed = res.value.verdict === "PASS" && failures.length === 0;
  return {
    result: { passed, failures, notes: res.value.notes ?? "" },
    usage: res.usage,
  };
}
