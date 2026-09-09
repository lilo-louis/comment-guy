import type { PostWithAuthor, PrefilterReason, PrefilterResult } from "@cg/domain";
import type { EngineConfig } from "./config.ts";

export interface PrefilterContext {
  now?: Date;
  /** Post IDs already seen in an earlier run. */
  seenPostIds?: ReadonlySet<string>;
  /** Post IDs we have already replied to. */
  repliedPostIds?: ReadonlySet<string>;
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/**
 * Rule-based rejection, run before any model call.
 *
 * Two constraints shape this:
 *  - It operates ONLY on fields present in the search response, so it can never
 *    trigger an extra billed lookup.
 *  - It is deliberately cheap and slightly over-eager. A post wrongly dropped
 *    here costs nothing; a junk post that survives costs a scoring call.
 */
export function prefilter(
  { post, author }: PostWithAuthor,
  config: EngineConfig,
  ctx: PrefilterContext = {},
): PrefilterResult {
  const reasons: PrefilterReason[] = [];
  const cfg = config.prefilter;
  const now = ctx.now ?? new Date();
  const text = post.text.toLowerCase();

  if (post.lang !== "en") reasons.push("NOT_ENGLISH");
  if (post.isRetweet) reasons.push("RETWEET");
  if (post.isReply) reasons.push("IS_REPLY");

  const ageHours = (now.getTime() - new Date(post.createdAt).getTime()) / 3_600_000;
  if (ageHours > cfg.maxPostAgeHours) reasons.push("TOO_OLD");

  if (post.text.trim().length < cfg.minPostChars) reasons.push("TOO_SHORT");

  // A post that is only a link and a few words gives nothing to reply to.
  const withoutUrls = post.text.replace(/https?:\/\/\S+/g, "").trim();
  if (post.urls.length > 0 && withoutUrls.length < cfg.minPostChars / 2) {
    reasons.push("LINK_ONLY");
  }

  if (containsAny(text, cfg.politicalTerms)) reasons.push("POLITICS");
  if (containsAny(text, cfg.baitPhrases)) reasons.push("ENGAGEMENT_BAIT");
  if (/\b(giveaway|airdrop|free nft|whitelist)\b/.test(text)) reasons.push("GIVEAWAY_SPAM");

  if (author.followersCount < cfg.minAuthorFollowers) reasons.push("AUTHOR_TOO_SMALL");
  if (cfg.blockedAuthorIds.includes(author.id)) reasons.push("AUTHOR_BLOCKED");

  // Piling onto a post with hundreds of replies buys no visibility.
  if (post.metrics.replyCount > cfg.maxExistingReplies) reasons.push("TOO_MANY_REPLIES");

  if (ctx.seenPostIds?.has(post.id)) reasons.push("ALREADY_SEEN");
  if (ctx.repliedPostIds?.has(post.id)) reasons.push("ALREADY_REPLIED");

  return { passed: reasons.length === 0, reasons };
}

export interface PrefilterSummary {
  kept: PostWithAuthor[];
  rejected: { item: PostWithAuthor; reasons: PrefilterReason[] }[];
  /** Count by reason, for tuning the rules against real data. */
  byReason: Record<string, number>;
}

export function prefilterAll(
  items: PostWithAuthor[],
  config: EngineConfig,
  ctx: PrefilterContext = {},
): PrefilterSummary {
  const kept: PostWithAuthor[] = [];
  const rejected: { item: PostWithAuthor; reasons: PrefilterReason[] }[] = [];
  const byReason: Record<string, number> = {};
  const seen = new Set(ctx.seenPostIds ?? []);

  for (const item of items) {
    const result = prefilter(item, config, { ...ctx, seenPostIds: seen });
    if (result.passed) {
      kept.push(item);
    } else {
      rejected.push({ item, reasons: result.reasons });
      for (const r of result.reasons) byReason[r] = (byReason[r] ?? 0) + 1;
    }
    // Dedupe within the batch too — topic searches overlap heavily.
    seen.add(item.post.id);
  }

  return { kept, rejected, byReason };
}
