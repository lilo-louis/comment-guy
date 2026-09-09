import assert from "node:assert/strict";
import { test } from "node:test";
import type { Angle, PostScore } from "@cg/domain";
import { selectAngle } from "./angles.ts";
import { fingerprint } from "./diversity.ts";

const score = (angles: Angle[]): PostScore => ({
  postId: "p1", total: 80, reason: "", candidateAngles: angles,
  components: { icpFit: 20, authorRelevance: 15, topicRelevance: 15, freshness: 15, replyOpportunity: 8, valueAdd: 7 },
});

test("prefers the scorer's first suggestion when nothing is overused", () => {
  assert.equal(selectAngle(score(["SHARP_QUESTION", "OPERATOR_INSIGHT"]), [], 40), "SHARP_QUESTION");
});

test("steers away from an angle used repeatedly in recent replies", () => {
  const recent = Array.from({ length: 8 }, (_, i) => fingerprint(`reply ${i} text here`, "SHARP_QUESTION"));
  assert.equal(selectAngle(score(["SHARP_QUESTION", "OPERATOR_INSIGHT"]), recent, 40), "OPERATOR_INSIGHT");
});

test("post fit still wins — an overused angle is chosen over none that fit", () => {
  const recent = Array.from({ length: 20 }, (_, i) => fingerprint(`reply ${i} text here`, "SMALL_JOKE"));
  assert.equal(selectAngle(score(["SMALL_JOKE"]), recent, 40), "SMALL_JOKE");
});

test("falls back to the full angle set when the scorer suggested none", () => {
  const chosen = selectAngle(score([]), [], 40);
  assert.ok(typeof chosen === "string" && chosen.length > 0);
});
