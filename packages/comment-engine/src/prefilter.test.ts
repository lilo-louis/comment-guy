import assert from "node:assert/strict";
import { test } from "node:test";
import { makeItem } from "@cg/domain/testing";
import { DEFAULT_CONFIG } from "./config.ts";
import { prefilter, prefilterAll } from "./prefilter.ts";

const cfg = DEFAULT_CONFIG;

test("passes a fresh, relevant, operator post", () => {
  const r = prefilter(makeItem(), cfg);
  assert.equal(r.passed, true, `unexpectedly rejected: ${r.reasons.join(",")}`);
});

test("rejects non-English", () => {
  const r = prefilter(makeItem({ lang: "es" }), cfg);
  assert.ok(r.reasons.includes("NOT_ENGLISH"));
});

test("rejects posts older than the freshness window", () => {
  const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const r = prefilter(makeItem({ createdAt: old }), cfg);
  assert.ok(r.reasons.includes("TOO_OLD"));
});

test("rejects retweets and replies", () => {
  assert.ok(prefilter(makeItem({ isRetweet: true }), cfg).reasons.includes("RETWEET"));
  assert.ok(prefilter(makeItem({ isReply: true }), cfg).reasons.includes("IS_REPLY"));
});

test("rejects political content before it can reach a paid model call", () => {
  const r = prefilter(
    makeItem({ text: "The election result will change how every small business handles tariffs and returns." }),
    cfg,
  );
  assert.ok(r.reasons.includes("POLITICS"));
});

test("rejects engagement bait", () => {
  const r = prefilter(
    makeItem({ text: "Drop your Shopify store below and I will review it for free, comment below to enter" }),
    cfg,
  );
  assert.ok(r.reasons.includes("ENGAGEMENT_BAIT"));
});

test("rejects authors below the follower floor", () => {
  const r = prefilter(makeItem({}, { followersCount: 12 }), cfg);
  assert.ok(r.reasons.includes("AUTHOR_TOO_SMALL"));
});

test("rejects posts already flooded with replies", () => {
  const r = prefilter(
    makeItem({ metrics: { replyCount: 900, likeCount: 5000, repostCount: 100, quoteCount: 10 } }),
    cfg,
  );
  assert.ok(r.reasons.includes("TOO_MANY_REPLIES"));
});

test("rejects link-only posts with nothing to reply to", () => {
  const r = prefilter(
    makeItem({ text: "new post https://example.com/blog/x", urls: ["https://example.com/blog/x"] }),
    cfg,
  );
  assert.ok(r.reasons.includes("LINK_ONLY"));
});

test("respects already-seen and already-replied sets", () => {
  const item = makeItem();
  assert.ok(
    prefilter(item, cfg, { seenPostIds: new Set([item.post.id]) }).reasons.includes("ALREADY_SEEN"),
  );
  assert.ok(
    prefilter(item, cfg, { repliedPostIds: new Set([item.post.id]) }).reasons.includes("ALREADY_REPLIED"),
  );
});

test("prefilterAll dedupes within the batch — topic searches overlap heavily", () => {
  const item = makeItem();
  const summary = prefilterAll([item, item], cfg);
  assert.equal(summary.kept.length, 1);
  assert.equal(summary.byReason["ALREADY_SEEN"], 1);
});

test("prefilterAll counts reasons so the rules can be tuned against real data", () => {
  const summary = prefilterAll([makeItem({ lang: "de" }), makeItem({ isRetweet: true })], cfg);
  assert.equal(summary.kept.length, 0);
  assert.equal(summary.byReason["NOT_ENGLISH"], 1);
  assert.equal(summary.byReason["RETWEET"], 1);
});
