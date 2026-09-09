import assert from "node:assert/strict";
import { test } from "node:test";
import { StubProvider } from "@cg/ai";
import type { PostWithAuthor, Target, Topic } from "@cg/domain";
import { makeItem } from "@cg/domain/testing";
import { DEFAULT_CONFIG } from "./config.ts";
import { runPipeline, type DiscoverySource } from "./pipeline.ts";

const cfg = { ...DEFAULT_CONFIG, drafting: { ...DEFAULT_CONFIG.drafting, candidatesPerPost: 1 } };

class FakeSource implements DiscoverySource {
  items: PostWithAuthor[];
  constructor(items: PostWithAuthor[]) {
    this.items = items;
  }
  async searchPosts() { return this.items; }
  async userTimeline() { return []; }
}

/** `replyText` may be a fixed string or a per-call generator. */
function stubAI(replyText: string | (() => string) = "Size charts move returns more than any macro does. Cheapest fix on the list.") {
  const next = typeof replyText === "function" ? replyText : () => replyText;
  return new StubProvider({
    text: () => next(),
    tools: {
      submit_scores: (req) => ({
        scores: [...String(req.messages[0]?.content).matchAll(/<post id="([^"]+)"/g)].map((m) => ({
          postId: m[1], icpFit: 22, authorRelevance: 18, topicRelevance: 18,
          replyOpportunity: 9, valueAdd: 9, reason: "concrete ops question",
          candidateAngles: ["OPERATOR_INSIGHT"],
        })),
      }),
      submit_verdict: () => ({ verdict: "PASS", failures: [], notes: "specific and grounded" }),
    },
  });
}

const topics: Topic[] = [{ topicId: "t1", label: "returns", query: "returns", priority: 1, enabled: true }];
const targets: Target[] = [];

const baseOpts = {
  targets, topics, maxPostsPerSource: 50, maxDrafts: 5,
  voiceContext: "Terse. Concrete. Lowercase where it fits.",
  voiceProfileVersion: "v-test", recent: [],
};

test("runs discovery through to a gated draft", async () => {
  const items = [makeItem(), makeItem()];
  let n = 0;
  const replies = [
    "Size charts move returns more than any macro does. Cheapest fix on the list.",
    "Depends how much of that volume is exchange requests versus genuine faults.",
  ];
  const res = await runPipeline(
    new FakeSource(items),
    stubAI(() => replies[n++ % replies.length]!),
    cfg,
    baseOpts,
  );
  assert.equal(res.discovered, 2);
  assert.equal(res.prefilterKept, 2);
  assert.equal(res.candidates.length, 2);
  assert.ok(res.candidates.every((c) => c.draft !== null));
  assert.ok(res.llmCostUsd > 0);
});

test("a second draft identical to the first is rejected as repetitive", async () => {
  // The gate passes both; only the diversity check separates them. This is the
  // plan's §23 rule doing its job inside the real pipeline.
  const res = await runPipeline(new FakeSource([makeItem(), makeItem()]), stubAI(), cfg, baseOpts);
  assert.equal(res.candidates[0]!.draft !== null, true);
  assert.equal(res.candidates[1]!.draft, null);
  assert.ok(res.candidates[1]!.attempts.some((a) => a.slop.failures.includes("REPETITIVE")));
});

test("dedupes a post surfaced by more than one source", async () => {
  const item = makeItem();
  const res = await runPipeline(new FakeSource([item, item]), stubAI(), cfg, baseOpts);
  assert.equal(res.discovered, 2);
  assert.equal(res.deduped, 1);
});

test("prefiltered posts never reach a paid scoring call", async () => {
  const ai = stubAI();
  const junk = makeItem({ lang: "de" });
  await runPipeline(new FakeSource([junk]), ai, cfg, baseOpts);
  assert.equal(ai.calls.length, 0, "a rejected post triggered a model call");
});

test("maxDrafts caps spend and says what it skipped", async () => {
  const items = Array.from({ length: 5 }, () => makeItem());
  const res = await runPipeline(new FakeSource(items), stubAI(), cfg, { ...baseOpts, maxDrafts: 2 });
  assert.equal(res.candidates.length, 2);
  assert.ok(res.notes.some((n) => n.includes("were not drafted")));
});

test("a draft that fails the gate yields a candidate with no draft, not a bad post", async () => {
  const ai = new StubProvider({
    text: () => "Great post, couldn't agree more.",
    tools: {
      submit_scores: (req) => ({
        scores: [...String(req.messages[0]?.content).matchAll(/<post id="([^"]+)"/g)].map((m) => ({
          postId: m[1], icpFit: 22, authorRelevance: 18, topicRelevance: 18,
          replyOpportunity: 9, valueAdd: 9, reason: "x", candidateAngles: ["OPERATOR_INSIGHT"],
        })),
      }),
      submit_verdict: () => ({ verdict: "FAIL", failures: ["GENERIC_PRAISE"], notes: "praise" }),
    },
  });
  const res = await runPipeline(new FakeSource([makeItem()]), ai, cfg, baseOpts);
  assert.equal(res.candidates[0]!.draft, null);
  assert.ok(res.candidates[0]!.attempts.length > 0);
  assert.ok(res.notes.some((n) => n.includes("no draft that passed")));
});

test("banned phrases are caught for free, without a gate call", async () => {
  const ai = stubAI("Great post. Returns really are underrated.");
  const res = await runPipeline(new FakeSource([makeItem()]), ai, cfg, baseOpts);
  assert.equal(res.candidates[0]!.draft, null);
  assert.ok(res.candidates[0]!.attempts[0]!.slop.failures.includes("BANNED_PHRASE"));
  assert.equal(ai.calls.filter((c) => c.toolName === "submit_verdict").length, 0);
});

test("scoring below threshold produces no drafts at all", async () => {
  const ai = new StubProvider({
    tools: {
      submit_scores: (req) => ({
        scores: [...String(req.messages[0]?.content).matchAll(/<post id="([^"]+)"/g)].map((m) => ({
          postId: m[1], icpFit: 2, authorRelevance: 2, topicRelevance: 2,
          replyOpportunity: 1, valueAdd: 1, reason: "off ICP", candidateAngles: [],
        })),
      }),
    },
  });
  const res = await runPipeline(new FakeSource([makeItem()]), ai, cfg, baseOpts);
  assert.equal(res.candidates.length, 0);
  assert.equal(res.aboveDraftThreshold, 0);
});
