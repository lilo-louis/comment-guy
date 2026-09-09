import type { AIProvider, TokenUsage } from "@cg/ai";
import { EMPTY_USAGE, addUsage } from "@cg/ai";
import type { Angle, Draft, PostWithAuthor, SlopGateResult } from "@cg/domain";
import type { EngineConfig } from "./config.ts";
import { diversityPenalty, fingerprint, type ReplyFingerprint } from "./diversity.ts";
import { DRAFTER_SYSTEM, DRAFTER_USER } from "./prompts/drafter.ts";
import { runSlopGate } from "./slop-gate.ts";

export interface DraftAttempt {
  text: string;
  angle: Angle;
  slop: SlopGateResult;
  diversity: number;
  generationReason: Draft["generationReason"];
}

export interface DraftOutcome {
  /** The chosen draft, or null when every attempt failed the gate. */
  best: DraftAttempt | null;
  attempts: DraftAttempt[];
  usage: TokenUsage;
  model: string;
}

export interface DraftOptions {
  voiceContext: string;
  voiceProfileVersion: string;
  recent: readonly ReplyFingerprint[];
  /** Steers the drafter away from repeating recent openings. */
  recentOpenings: string[];
  /** Extra instruction from the Regenerate button, e.g. "shorter", "funnier". */
  steer?: string;
}

async function generateOne(
  item: PostWithAuthor,
  angle: Angle,
  ai: AIProvider,
  config: EngineConfig,
  opts: DraftOptions,
): Promise<{ text: string; usage: TokenUsage }> {
  const user = DRAFTER_USER(
    item.post.text,
    item.author.username,
    item.author.description,
    angle,
    opts.recentOpenings,
  );
  const res = await ai.complete({
    model: config.models.drafter,
    system: DRAFTER_SYSTEM(config, opts.voiceContext),
    cacheSystem: true,
    maxTokens: 512,
    thinking: true,
    messages: [{ role: "user", content: opts.steer ? `${user}\n\nAdditionally: ${opts.steer}` : user }],
  });
  // Models like to wrap replies in quotes despite being told not to.
  const text = res.text.trim().replace(/^["“](.*)["”]$/s, "$1").trim();
  return { text, usage: res.usage };
}

/**
 * Generates candidates, gates them, and returns the best survivor.
 *
 * "Best" is the passing draft with the lowest structural similarity to recent
 * replies — quality is already enforced by the gate, so the remaining axis
 * worth optimising is not sounding like the last twenty comments.
 */
export async function draftReply(
  item: PostWithAuthor,
  angle: Angle,
  ai: AIProvider,
  config: EngineConfig,
  opts: DraftOptions,
): Promise<DraftOutcome> {
  const attempts: DraftAttempt[] = [];
  let usage = EMPTY_USAGE;

  const rounds = 1 + config.drafting.maxSlopRetries;
  for (let round = 0; round < rounds; round++) {
    const reason: Draft["generationReason"] =
      opts.steer ? "USER_REGENERATE" : round === 0 ? "INITIAL" : "SLOP_RETRY";

    const wanted = round === 0 ? config.drafting.candidatesPerPost : 1;
    const generated = await Promise.all(
      Array.from({ length: wanted }, () => generateOne(item, angle, ai, config, opts)),
    );

    for (const g of generated) {
      usage = addUsage(usage, g.usage);
      const gate = await runSlopGate(g.text, item.post.text, ai, config);
      usage = addUsage(usage, gate.usage);

      const penalty = diversityPenalty(fingerprint(g.text, angle), opts.recent, config.diversity.recentWindow);
      const tooSimilar = penalty > config.diversity.rejectAbove;
      const slop: SlopGateResult = tooSimilar
        ? {
            passed: false,
            failures: [...gate.result.failures, "REPETITIVE"],
            notes: [gate.result.notes, `structurally ${(penalty * 100).toFixed(0)}% similar to a recent reply`]
              .filter(Boolean)
              .join("; "),
          }
        : gate.result;

      attempts.push({ text: g.text, angle, slop, diversity: penalty, generationReason: reason });
    }

    const passing = attempts.filter((a) => a.slop.passed);
    if (passing.length > 0) {
      passing.sort((a, b) => a.diversity - b.diversity);
      return { best: passing[0] ?? null, attempts, usage, model: config.models.drafter };
    }
  }

  return { best: null, attempts, usage, model: config.models.drafter };
}
