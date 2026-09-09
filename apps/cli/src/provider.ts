import { BedrockProvider, MODELS, StubProvider, type AIProvider } from "@cg/ai";
import type { EngineConfig } from "@cg/comment-engine";

export interface ProviderChoice {
  ai: AIProvider;
  label: string;
  /** True when no request will leave the machine and nothing will be billed. */
  free: boolean;
}

/**
 * Deterministic canned output for `--dry`. Enough to exercise every stage; the
 * drafts are obviously placeholder so a dry run can never be mistaken for a
 * quality signal.
 */
function dryStub(): StubProvider {
  let n = 0;
  return new StubProvider({
    text: () => {
      n++;
      const variants = [
        "Worth checking whether that split is exchanges or genuine faults first. Changes the fix entirely.",
        "We saw the same jump after a courier change. Took a month to connect the two.",
        "What does the timeline look like from request to restock? That number usually explains the rest.",
        "Dimensional weight, probably. It catches almost everyone at that order volume.",
      ];
      return `[DRY] ${variants[n % variants.length]}`;
    },
    tools: {
      submit_scores: (req) => {
        const ids = [...String(req.messages[0]?.content ?? "").matchAll(/<post id="([^"]+)"/g)].map(
          (m) => m[1],
        );
        return {
          scores: ids.map((id, i) => ({
            postId: id,
            icpFit: 18 + (i % 7),
            authorRelevance: 12 + (i % 8),
            topicRelevance: 14 + (i % 6),
            replyOpportunity: 6 + (i % 4),
            valueAdd: 5 + (i % 5),
            reason: "[DRY] canned score — not a real judgement",
            candidateAngles: ["OPERATOR_INSIGHT", "SHARP_QUESTION"],
          })),
        };
      },
      submit_verdict: () => ({ verdict: "PASS", failures: [], notes: "[DRY] canned pass" }),
      submit_voice_profile: () => ({
        tone: "[DRY] terse, concrete", sentenceLength: "short", vocabulary: ["ops", "returns"],
        punctuationHabits: "minimal", humorStyle: "dry", directness: "high",
        questionHabits: "occasional", howIDisagree: "narrowly", phrasingToAvoid: ["great post"],
        strongExamples: ["[DRY] example"], weakExamples: [],
      }),
    },
  });
}

export function makeProvider(dry: boolean, config: EngineConfig): ProviderChoice {
  if (dry) {
    return { ai: dryStub(), label: "stub (--dry, nothing billed)", free: true };
  }

  const region = process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"] ?? "us-east-1";
  const profile = process.env["AWS_PROFILE"];
  const backend = process.env["BEDROCK_BACKEND"] === "mantle" ? "mantle" : "invoke";
  return {
    ai: new BedrockProvider({
      awsRegion: region,
      backend,
      ...(profile ? { awsProfile: profile } : {}),
    }),
    label: `bedrock:${backend} ${region}${profile ? ` (${profile})` : ""}\n             scoring ${config.models.scorer}\n             drafting ${config.models.drafter}`,
    free: false,
  };
}

/** Applies model overrides from the environment, e.g. when Opus 5 access is pending. */
export function applyModelOverrides(config: EngineConfig): EngineConfig {
  const drafter = process.env["DRAFT_MODEL"];
  const scorer = process.env["SCORE_MODEL"];
  if (!drafter && !scorer) return config;
  return {
    ...config,
    models: {
      ...config.models,
      ...(drafter ? { drafter } : {}),
      ...(scorer ? { scorer, slopGate: scorer } : {}),
    },
  };
}

export { MODELS };
