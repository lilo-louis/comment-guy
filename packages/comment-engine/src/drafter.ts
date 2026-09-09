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
): Promise<{ text: string; usage: TokenUsage; truncated: boolean }> {
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
    maxTokens: config.drafting.maxTokens,
    // Thinking is deliberately off. Measured on Sonnet 4.6 with the real
    // system prompt: thinking spent 1229 output tokens to write a 280-char
    // reply (and at maxTokens 512 it consumed the whole budget and returned
    // nothing at all), versus 36 tokens without it — for a reply that matched
    // the voice better. Reasoning depth is not what makes a good short reply.
    thinking: false,
    messages: [{ role: "user", content: opts.steer ? `${user}\n\nAdditionally: ${opts.steer}` : user }],
  });
  // Models like to wrap replies in quotes despite being told not to.
  const text = res.text.trim().replace(/^["“](.*)["”]$/s, "$1").trim();
  return { text, usage: res.usage, truncated: res.truncated };
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

      // A truncated generation is a configuration problem, not a bad draft.
      // Report it as itself rather than letting it read as "the model wrote
      // nothing", and do not pay for a gate call on it.
      if (g.truncated && g.text.length === 0) {
        attempts.push({
          text: "",
          angle,
          slop: {
            passed: false,
            failures: ["TRUNCATED"],
            notes: `generation hit the ${config.drafting.maxTokens}-token limit before producing any text`,
          },
          diversity: 0,
          generationReason: reason,
        });
        continue;
      }

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
