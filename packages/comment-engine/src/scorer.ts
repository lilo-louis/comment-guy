import type { AIProvider, TokenUsage } from "@cg/ai";
import { EMPTY_USAGE, addUsage } from "@cg/ai";
import type { Angle, PostScore, PostWithAuthor, ScoreComponents } from "@cg/domain";
import { ANGLES } from "@cg/domain";
import type { EngineConfig } from "./config.ts";
import { SCORER_SYSTEM } from "./prompts/scorer.ts";

/**
 * Freshness is computed here rather than asked of the model: it is a pure
 * function of post age, the model has no better information than the clock,
 * and every judgment we hand to the model costs tokens. 0-15.
 */
export function freshnessScore(createdAt: string, now: Date, maxAgeHours: number): number {
  const ageHours = (now.getTime() - new Date(createdAt).getTime()) / 3_600_000;
  if (ageHours < 0) return 15;
  const ratio = Math.min(1, ageHours / maxAgeHours);
  return Math.round(15 * (1 - ratio));
}

function clamp(n: unknown, max: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(max, Math.round(v)));
}

interface RawScore {
  postId: string;
  icpFit: number;
  authorRelevance: number;
  topicRelevance: number;
  replyOpportunity: number;
  valueAdd: number;
  reason: string;
  candidateAngles: string[];
}

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          postId: { type: "string" },
          icpFit: { type: "integer", minimum: 0, maximum: 25 },
          authorRelevance: { type: "integer", minimum: 0, maximum: 20 },
          topicRelevance: { type: "integer", minimum: 0, maximum: 20 },
          replyOpportunity: { type: "integer", minimum: 0, maximum: 10 },
          valueAdd: { type: "integer", minimum: 0, maximum: 10 },
          reason: { type: "string", description: "One sentence. Why this score." },
          candidateAngles: {
            type: "array",
            items: { type: "string", enum: [...ANGLES] },
            description: "1-3 angles that would work for this post.",
          },
        },
        required: [
          "postId", "icpFit", "authorRelevance", "topicRelevance",
          "replyOpportunity", "valueAdd", "reason", "candidateAngles",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["scores"],
  additionalProperties: false,
} as const;

function renderPost({ post, author }: PostWithAuthor): string {
  return [
    `<post id="${post.id}">`,
    `author: @${author.username} (${author.followersCount} followers)`,
    `bio: ${author.description.slice(0, 200)}`,
    `replies: ${post.metrics.replyCount} | likes: ${post.metrics.likeCount}`,
    `text: ${post.text}`,
    `</post>`,
  ].join("\n");
}

export interface ScoreResult {
  scores: PostScore[];
  usage: TokenUsage;
  model: string;
}

/**
 * Scores a batch of posts in one call. The rubric and ICP live in a cached
 * system prompt so repeated batches only pay for the posts themselves.
 */
export async function scorePosts(
  items: PostWithAuthor[],
  ai: AIProvider,
  config: EngineConfig,
  now: Date = new Date(),
): Promise<ScoreResult> {
  if (items.length === 0) {
    return { scores: [], usage: EMPTY_USAGE, model: config.models.scorer };
  }

  const batches: PostWithAuthor[][] = [];
  for (let i = 0; i < items.length; i += config.scoring.batchSize) {
    batches.push(items.slice(i, i + config.scoring.batchSize));
  }

  const byId = new Map(items.map((i) => [i.post.id, i]));
  const scores: PostScore[] = [];
  let usage = EMPTY_USAGE;

  for (const batch of batches) {
    const res = await ai.completeWithTool<{ scores: RawScore[] }>({
      model: config.models.scorer,
      system: SCORER_SYSTEM(config),
      cacheSystem: true,
      maxTokens: 4096,
      messages: [
        {
          role: "user",
          content: `Score these ${batch.length} posts.\n\n${batch.map(renderPost).join("\n\n")}`,
        },
      ],
      toolName: "submit_scores",
      toolDescription: "Submit a relevance score for every post in the batch.",
      schema: SCORE_SCHEMA as unknown as Record<string, unknown>,
      parse: (raw) => raw as { scores: RawScore[] },
    });

    usage = addUsage(usage, res.usage);

    for (const raw of res.value.scores ?? []) {
      const item = byId.get(raw.postId);
      if (!item) continue; // model invented an id; drop it rather than trust it
      const components: ScoreComponents = {
        icpFit: clamp(raw.icpFit, 25),
        authorRelevance: clamp(raw.authorRelevance, 20),
        topicRelevance: clamp(raw.topicRelevance, 20),
        freshness: freshnessScore(item.post.createdAt, now, config.prefilter.maxPostAgeHours),
        replyOpportunity: clamp(raw.replyOpportunity, 10),
        valueAdd: clamp(raw.valueAdd, 10),
      };
      const total =
        components.icpFit + components.authorRelevance + components.topicRelevance +
        components.freshness + components.replyOpportunity + components.valueAdd;

      const candidateAngles = (raw.candidateAngles ?? []).filter(
        (a): a is Angle => (ANGLES as readonly string[]).includes(a),
      );

      scores.push({
        postId: raw.postId,
        total,
        components,
        reason: raw.reason ?? "",
        candidateAngles: candidateAngles.length > 0 ? candidateAngles : ["USEFUL_EXTENSION"],
      });
    }
  }

  scores.sort((a, b) => b.total - a.total);
  return { scores, usage, model: config.models.scorer };
}

export function partitionByThreshold(scores: PostScore[], config: EngineConfig) {
  return {
    draft: scores.filter((s) => s.total >= config.scoring.draftThreshold),
    maybe: scores.filter(
      (s) => s.total >= config.scoring.maybeThreshold && s.total < config.scoring.draftThreshold,
    ),
    discard: scores.filter((s) => s.total < config.scoring.maybeThreshold),
  };
}
