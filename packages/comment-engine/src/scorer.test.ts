import assert from "node:assert/strict";
import { test } from "node:test";
import { StubProvider } from "@cg/ai";
import { makeItem } from "@cg/domain/testing";
import { DEFAULT_CONFIG } from "./config.ts";
import { freshnessScore, partitionByThreshold, scorePosts } from "./scorer.ts";

const cfg = DEFAULT_CONFIG;
const now = new Date("2026-09-09T12:00:00.000Z");

test("freshness decays linearly to zero across the age window", () => {
  const at = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  assert.equal(freshnessScore(at(0), now, 24), 15);
  assert.equal(freshnessScore(at(12), now, 24), 8);
  assert.equal(freshnessScore(at(24), now, 24), 0);
  assert.equal(freshnessScore(at(100), now, 24), 0);
});

function stubScoring(over: Record<string, unknown> = {}) {
  return new StubProvider({
    tools: {
      submit_scores: (req) => {
        const ids = [...String(req.messages[0]?.content).matchAll(/<post id="([^"]+)"/g)].map((m) => m[1]);
        return {
          scores: ids.map((id) => ({
            postId: id,
            icpFit: 20, authorRelevance: 15, topicRelevance: 18,
            replyOpportunity: 8, valueAdd: 9,
            reason: "operational question from a DTC founder",
            candidateAngles: ["OPERATOR_INSIGHT"],
            ...over,
          })),
        };
      },
    },
  });
}

test("totals the five judged components plus computed freshness", () => {
  const item = makeItem({ createdAt: now.toISOString() });
  return scorePosts([item], stubScoring(), cfg, now).then((res) => {
    const s = res.scores[0]!;
    assert.equal(s.components.freshness, 15);
    assert.equal(s.total, 20 + 15 + 18 + 15 + 8 + 9);
  });
});

test("clamps out-of-range component values rather than trusting the model", async () => {
  const item = makeItem({ createdAt: now.toISOString() });
  const res = await scorePosts([item], stubScoring({ icpFit: 999, valueAdd: -5 }), cfg, now);
  assert.equal(res.scores[0]!.components.icpFit, 25);
  assert.equal(res.scores[0]!.components.valueAdd, 0);
});

test("drops scores for post ids the model invented", async () => {
  const ai = new StubProvider({
    tools: {
      submit_scores: () => ({
        scores: [{
          postId: "hallucinated-id", icpFit: 25, authorRelevance: 20, topicRelevance: 20,
          replyOpportunity: 10, valueAdd: 10, reason: "x", candidateAngles: ["OPERATOR_INSIGHT"],
        }],
      }),
    },
  });
  const res = await scorePosts([makeItem()], ai, cfg, now);
  assert.equal(res.scores.length, 0);
});

test("falls back to a valid angle when the model returns none", async () => {
  const res = await scorePosts([makeItem()], stubScoring({ candidateAngles: [] }), cfg, now);
  assert.deepEqual(res.scores[0]!.candidateAngles, ["USEFUL_EXTENSION"]);
});

test("batches to amortize the cached rubric across posts", async () => {
  const ai = stubScoring();
  const items = Array.from({ length: 25 }, () => makeItem());
  const res = await scorePosts(items, ai, cfg, now);
  assert.equal(res.scores.length, 25);
  assert.equal(ai.calls.length, 3); // 25 posts / batchSize 10
});

test("no posts means no model call and no spend", async () => {
  const ai = stubScoring();
  const res = await scorePosts([], ai, cfg, now);
  assert.equal(ai.calls.length, 0);
  assert.equal(res.usage.inputTokens, 0);
});

test("partitions on the configured thresholds", () => {
  const mk = (total: number) => ({
    postId: "p", total, reason: "", candidateAngles: [],
    components: { icpFit: 0, authorRelevance: 0, topicRelevance: 0, freshness: 0, replyOpportunity: 0, valueAdd: 0 },
  });
  const p = partitionByThreshold([mk(85), mk(70), mk(60), mk(54)], cfg);
  assert.equal(p.draft.length, 2);
  assert.equal(p.maybe.length, 1);
  assert.equal(p.discard.length, 1);
});
