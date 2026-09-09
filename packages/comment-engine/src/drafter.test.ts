import assert from "node:assert/strict";
import { test } from "node:test";
import { StubProvider } from "@cg/ai";
import { makeItem } from "@cg/domain/testing";
import { DEFAULT_CONFIG } from "./config.ts";
import { draftReply } from "./drafter.ts";

const cfg = { ...DEFAULT_CONFIG, drafting: { ...DEFAULT_CONFIG.drafting, candidatesPerPost: 1, maxSlopRetries: 0 } };
const opts = { voiceContext: "terse", voiceProfileVersion: "v1", recent: [], recentOpenings: [] };

function ai(over: Partial<{ text: string; truncated: boolean; verdict: string }> = {}) {
  const p = new StubProvider({
    text: () => over.text ?? "Pull return reasons by SKU. It is almost always one product.",
    tools: { submit_verdict: () => ({ verdict: over.verdict ?? "PASS", failures: [], notes: "" }) },
  });
  if (over.truncated) {
    const original = p.complete.bind(p);
    p.complete = async (req) => ({ ...(await original(req)), text: "", truncated: true, stopReason: "max_tokens" });
  }
  return p;
}

test("a truncated generation is reported as TRUNCATED, not as an empty draft", async () => {
  const provider = ai({ truncated: true });
  const out = await draftReply(makeItem(), "OPERATOR_INSIGHT", provider, cfg, opts);
  assert.equal(out.best, null);
  assert.deepEqual(out.attempts[0]!.slop.failures, ["TRUNCATED"]);
  assert.match(out.attempts[0]!.slop.notes, /token limit/);
  // and it must not have paid for a gate call on nothing
  assert.equal(provider.calls.filter((cl) => cl.toolName === "submit_verdict").length, 0);
});

test("a normal draft passes through the gate and is returned", async () => {
  const out = await draftReply(makeItem(), "OPERATOR_INSIGHT", ai(), cfg, opts);
  assert.ok(out.best);
  assert.equal(out.best!.slop.passed, true);
});

test("drafting does not request thinking — it is off by design for short replies", async () => {
  let sawThinking: boolean | undefined;
  const provider = new StubProvider({
    text: () => "fine draft here about returns",
    tools: { submit_verdict: () => ({ verdict: "PASS", failures: [], notes: "" }) },
  });
  const original = provider.complete.bind(provider);
  provider.complete = async (req) => {
    sawThinking = req.thinking;
    return original(req);
  };
  await draftReply(makeItem(), "OPERATOR_INSIGHT", provider, cfg, opts);
  assert.equal(sawThinking, false);
});
