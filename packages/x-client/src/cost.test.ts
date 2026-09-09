import assert from "node:assert/strict";
import { test } from "node:test";
import { CostMeter, ReadBudget, X_RATES } from "./cost.ts";

test("prices reads and writes at the pay-per-use rates", () => {
  const m = new CostMeter();
  m.record("postRead", 300);
  m.record("postWrite", 15);
  assert.equal(m.totalUsd.toFixed(3), (300 * 0.005 + 15 * 0.015).toFixed(3));
});

test("a link in a post costs 13x a plain post — which is why the engine bans them", () => {
  assert.ok(X_RATES.postWriteWithLink / X_RATES.postWrite > 13);
});

test("a day at target volume lands where the plan says it does", () => {
  const m = new CostMeter();
  m.record("postRead", 300);   // discovery
  m.record("userLookup", 30);  // uncached authors
  m.record("postWrite", 15);   // published comments
  // ~$1.98/day => ~$59/month, consistent with the plan's X line items.
  assert.ok(m.totalUsd > 1.9 && m.totalUsd < 2.1, `got $${m.totalUsd.toFixed(3)}`);
});

test("format labels simulated runs so fixture numbers are never mistaken for a bill", () => {
  const m = new CostMeter(true);
  m.record("postRead", 10);
  assert.match(m.format(), /SIMULATED/);
});

test("read budget caps a run and reports exhaustion", () => {
  const b = new ReadBudget(100);
  assert.equal(b.request(60), 60);
  assert.equal(b.request(60), 40); // capped by what is left
  assert.equal(b.request(10), 0);
  assert.equal(b.exhausted, true);
});
