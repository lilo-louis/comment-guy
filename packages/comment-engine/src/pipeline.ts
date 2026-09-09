import { randomUUID } from "node:crypto";
import type { AIProvider, TokenUsage } from "@cg/ai";
import { EMPTY_USAGE, addUsage, estimateCostUsd } from "@cg/ai";
import type { Angle, PostScore, PostWithAuthor, PrefilterReason, Target, Topic } from "@cg/domain";
import type { EngineConfig } from "./config.ts";
import { selectAngle } from "./angles.ts";
import { type DraftAttempt, draftReply } from "./drafter.ts";
import { fingerprint, type ReplyFingerprint } from "./diversity.ts";
import { prefilterAll } from "./prefilter.ts";
import { partitionByThreshold, scorePosts } from "./scorer.ts";

/** Minimal surface the pipeline needs from an XClient, so it stays testable. */
export interface DiscoverySource {
  searchPosts(query: string, opts: { maxResults: number; sinceHoursAgo?: number }): Promise<PostWithAuthor[]>;
  userTimeline(xUserId: string, opts: { maxResults: number; sinceHoursAgo?: number }): Promise<PostWithAuthor[]>;
}

export interface RunCandidate {
  candidateId: string;
  item: PostWithAuthor;
  score: PostScore;
  angle: Angle;
  draft: DraftAttempt | null;
  attempts: DraftAttempt[];
  sourceType: "TARGET" | "TOPIC";
  sourceId: string;
}

export interface RunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  /** Recorded so every decision derived from this run is attributable to a voice version. */
  voiceProfileVersion: string;
  promptVersion: string;
  discovered: number;
  deduped: number;
  prefilterKept: number;
  prefilterRejectedByReason: Record<string, number>;
  scored: PostScore[];
  aboveDraftThreshold: number;
  candidates: RunCandidate[];
  usageByModel: Record<string, TokenUsage>;
  /** False for stubbed runs. Token counts are then fabricated and cost is zero. */
  billed: boolean;
  llmCostUsd: number;
  notes: string[];
}

export interface RunOptions {
  targets: Target[];
  topics: Topic[];
  /** Hard cap on posts read this run. This is a spend cap. */
  maxPostsPerSource: number;
  /** Stop after drafting this many. */
  maxDrafts: number;
  voiceContext: string;
  voiceProfileVersion: string;
  recent: ReplyFingerprint[];
  /** Set false when the provider is a stub, so fabricated usage never books cost. */
  billed?: boolean;
  seenPostIds?: ReadonlySet<string>;
  repliedPostIds?: ReadonlySet<string>;
  now?: Date;
  onProgress?: (msg: string) => void;
}

function track(map: Record<string, TokenUsage>, model: string, usage: TokenUsage): void {
  map[model] = addUsage(map[model] ?? EMPTY_USAGE, usage);
}

/**
 * discovery -> dedupe -> prefilter -> score -> draft -> gate.
 *
 * Deliberately free of I/O beyond the injected client and provider, so Phase B
 * can split these stages across Lambdas without the logic changing.
 */
export async function runPipeline(
  x: DiscoverySource,
  ai: AIProvider,
  config: EngineConfig,
  opts: RunOptions,
): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const now = opts.now ?? new Date();
  const log = opts.onProgress ?? (() => {});
  const usageByModel: Record<string, TokenUsage> = {};
  const notes: string[] = [];

  // --- discovery -------------------------------------------------------
  const discovered: { item: PostWithAuthor; sourceType: "TARGET" | "TOPIC"; sourceId: string }[] = [];

  for (const target of opts.targets.filter((t) => t.enabled)) {
    const posts = await x.userTimeline(target.xUserId, {
      maxResults: opts.maxPostsPerSource,
      sinceHoursAgo: config.prefilter.maxPostAgeHours,
    });
    for (const item of posts) discovered.push({ item, sourceType: "TARGET", sourceId: target.username });
  }

  for (const topic of opts.topics.filter((t) => t.enabled)) {
    const posts = await x.searchPosts(topic.query, {
      maxResults: opts.maxPostsPerSource,
      sinceHoursAgo: config.prefilter.maxPostAgeHours,
    });
    for (const item of posts) discovered.push({ item, sourceType: "TOPIC", sourceId: topic.topicId });
  }

  const enabledTargets = opts.targets.filter((t) => t.enabled).length;
  const enabledTopics = opts.topics.filter((t) => t.enabled).length;
  log(`discovered ${discovered.length} posts from ${enabledTargets} targets + ${enabledTopics} topics`);

  // Topic searches overlap heavily; the first source to surface a post wins.
  const bySource = new Map<string, { sourceType: "TARGET" | "TOPIC"; sourceId: string }>();
  const uniqueItems: PostWithAuthor[] = [];
  for (const d of discovered) {
    if (bySource.has(d.item.post.id)) continue;
    bySource.set(d.item.post.id, { sourceType: d.sourceType, sourceId: d.sourceId });
    uniqueItems.push(d.item);
  }
  log(`${uniqueItems.length} unique after dedupe`);

  // --- prefilter (free) ------------------------------------------------
  const pre = prefilterAll(uniqueItems, config, {
    now,
    ...(opts.seenPostIds ? { seenPostIds: opts.seenPostIds } : {}),
    ...(opts.repliedPostIds ? { repliedPostIds: opts.repliedPostIds } : {}),
  });
  log(`${pre.kept.length} survived prefilter (${pre.rejected.length} rejected)`);

  if (pre.kept.length === 0) {
    notes.push("Nothing survived the prefilter. Loosen prefilter rules or widen discovery.");
  }

  // --- scoring ---------------------------------------------------------
  const scoreRes = await scorePosts(pre.kept, ai, config, now);
  track(usageByModel, scoreRes.model, scoreRes.usage);
  const partition = partitionByThreshold(scoreRes.scores, config);
  log(
    `scored ${scoreRes.scores.length}: ${partition.draft.length} >= ${config.scoring.draftThreshold}, ` +
      `${partition.maybe.length} maybe, ${partition.discard.length} discarded`,
  );

  // --- drafting --------------------------------------------------------
  const keptById = new Map(pre.kept.map((i) => [i.post.id, i]));
  const recent = [...opts.recent];
  const candidates: RunCandidate[] = [];

  const toDraft = partition.draft.slice(0, opts.maxDrafts);
  if (partition.draft.length > opts.maxDrafts) {
    notes.push(`${partition.draft.length - opts.maxDrafts} posts scored above threshold but were not drafted (maxDrafts=${opts.maxDrafts}).`);
  }

  for (const [index, score] of toDraft.entries()) {
    const item = keptById.get(score.postId);
    if (!item) continue;

    const angle = selectAngle(score, recent, config.diversity.recentWindow);
    log(`drafting ${index + 1}/${toDraft.length} — @${item.author.username} (${score.total}) via ${angle}`);

    const outcome = await draftReply(item, angle, ai, config, {
      voiceContext: opts.voiceContext,
      voiceProfileVersion: opts.voiceProfileVersion,
      recent,
      recentOpenings: recent.slice(-8).map((r) => r.opening).filter(Boolean),
    });
    // outcome.usage already includes the slop-gate calls made during drafting.
    track(usageByModel, outcome.model, outcome.usage);

    if (outcome.best) recent.push(fingerprint(outcome.best.text, angle));

    candidates.push({
      candidateId: randomUUID(),
      item,
      score,
      angle,
      draft: outcome.best,
      attempts: outcome.attempts,
      ...(bySource.get(item.post.id) ?? { sourceType: "TOPIC" as const, sourceId: "unknown" }),
    });
  }

  const failed = candidates.filter((c) => !c.draft).length;
  if (failed > 0) {
    notes.push(`${failed} candidate(s) produced no draft that passed the slop gate.`);
  }

  const billed = opts.billed ?? true;
  const llmCostUsd = billed
    ? Object.entries(usageByModel).reduce((sum, [model, usage]) => sum + estimateCostUsd(model, usage), 0)
    : 0;

  const byReason: Record<string, number> = {};
  for (const [k, v] of Object.entries(pre.byReason)) byReason[k as PrefilterReason] = v;

  return {
    runId: randomUUID(),
    startedAt,
    finishedAt: new Date().toISOString(),
    voiceProfileVersion: opts.voiceProfileVersion,
    promptVersion: config.promptVersion,
    discovered: discovered.length,
    deduped: uniqueItems.length,
    prefilterKept: pre.kept.length,
    prefilterRejectedByReason: byReason,
    scored: scoreRes.scores,
    aboveDraftThreshold: partition.draft.length,
    candidates,
    usageByModel,
    billed,
    llmCostUsd,
    notes,
  };
}
