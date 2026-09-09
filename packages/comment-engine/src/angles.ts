import type { Angle, PostScore } from "@cg/domain";
import { ANGLES } from "@cg/domain";
import type { ReplyFingerprint } from "./diversity.ts";
import { recentAngleCounts } from "./diversity.ts";

/**
 * Picks the angle to write with.
 *
 * The scorer proposes angles that fit the post; this then biases away from
 * angles already used a lot recently. The post's suitability wins — a rut is
 * better than forcing a joke onto a post that does not support one.
 */
export function selectAngle(
  score: PostScore,
  recent: readonly ReplyFingerprint[],
  window: number,
): Angle {
  const candidates = score.candidateAngles.length > 0 ? score.candidateAngles : [...ANGLES];
  const counts = recentAngleCounts(recent, window);
  const total = Math.max(1, Math.min(recent.length, window));

  let best = candidates[0] as Angle;
  let bestScore = Number.NEGATIVE_INFINITY;

  candidates.forEach((angle, index) => {
    // Earlier candidates are the scorer's stronger suggestions.
    const fitBonus = (candidates.length - index) / candidates.length;
    const overuse = (counts.get(angle) ?? 0) / total;
    const value = fitBonus - overuse;
    if (value > bestScore) {
      bestScore = value;
      best = angle;
    }
  });

  return best;
}
