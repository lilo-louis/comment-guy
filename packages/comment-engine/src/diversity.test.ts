import assert from "node:assert/strict";
import { test } from "node:test";
import { diversityPenalty, fingerprint, structuralSkeleton } from "./diversity.ts";

test("the plan's §23 failure mode is caught: same shape, different nouns", () => {
  // Each of these is individually fine. Posting all three makes the account
  // look automated, which is exactly what this check exists to prevent.
  const a = fingerprint(
    "Most brands don't have a support problem. They have a returns problem.",
    "OPERATOR_INSIGHT",
  );
  const b = fingerprint(
    "Most founders don't have a data problem. They have a process problem.",
    "OPERATOR_INSIGHT",
  );
  const penalty = diversityPenalty(b, [a], 40);
  assert.ok(penalty > 0.72, `expected a high penalty, got ${penalty.toFixed(3)}`);
});

test("genuinely different replies score low", () => {
  const a = fingerprint(
    "Most brands don't have a support problem. They have a returns problem.",
    "OPERATOR_INSIGHT",
  );
  const b = fingerprint(
    "What does your exchange rate look like after you added the size chart?",
    "SHARP_QUESTION",
  );
  const penalty = diversityPenalty(b, [a], 40);
  assert.ok(penalty < 0.72, `expected a low penalty, got ${penalty.toFixed(3)}`);
});

test("skeleton keeps function words and blanks content words", () => {
  const s = structuralSkeleton("Most brands don't have a support problem.");
  assert.ok(s.includes("most"), s);
  assert.ok(s.includes("have"), s);
  assert.ok(!s.includes("brands"), s);
  assert.ok(!s.includes("support"), s);
});

test("identical text scores near 1", () => {
  const text = "Returns are a merchandising problem long before they are a support problem.";
  const a = fingerprint(text, "OPERATOR_INSIGHT");
  assert.ok(diversityPenalty(a, [a], 40) > 0.9);
});

test("no history means no penalty", () => {
  assert.equal(diversityPenalty(fingerprint("anything at all here", "SMALL_JOKE"), [], 40), 0);
});

test("penalty is the worst match in the window, not the average", () => {
  const target = fingerprint("Most brands don't have a support problem. They have a returns problem.", "OPERATOR_INSIGHT");
  const twin = fingerprint("Most stores don't have a traffic problem. They have a conversion problem.", "OPERATOR_INSIGHT");
  const unrelated = Array.from({ length: 10 }, (_, i) =>
    fingerprint(`Totally unrelated sentence number ${i} about warehouses`, "REAL_EXAMPLE"),
  );
  const withTwin = diversityPenalty(target, [...unrelated, twin], 40);
  const withoutTwin = diversityPenalty(target, unrelated, 40);
  assert.ok(withTwin > withoutTwin);
  assert.ok(withTwin > 0.72);
});

test("only the recent window is compared", () => {
  const old = fingerprint("Most brands don't have a support problem. They have a returns problem.", "OPERATOR_INSIGHT");
  const target = fingerprint("Most stores don't have a traffic problem. They have a conversion problem.", "OPERATOR_INSIGHT");
  const filler = Array.from({ length: 5 }, (_, i) => fingerprint(`Filler ${i} about warehouse staffing levels`, "REAL_EXAMPLE"));
  assert.ok(diversityPenalty(target, [old, ...filler], 3) < diversityPenalty(target, [old, ...filler], 40));
});
