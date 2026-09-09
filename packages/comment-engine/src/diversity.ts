import type { Angle } from "@cg/domain";

/**
 * Function words are kept; everything else becomes a blank. This turns
 *   "Most brands don't have a support problem. They have a returns problem."
 *   "Most founders don't have a data problem. They have a process problem."
 * into the same skeleton, which is exactly the repetition that makes an account
 * look automated even when each individual reply is fine (plan §23).
 */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "so", "yet", "if", "then", "than",
  "that", "this", "these", "those", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "not", "no", "never", "always",
  "most", "more", "less", "few", "many", "much", "some", "any", "all", "every",
  "i", "you", "he", "she", "it", "we", "they", "them", "their", "your", "my", "our",
  "of", "in", "on", "at", "to", "for", "with", "from", "by", "about", "into", "over",
  "just", "only", "even", "still", "also", "too", "very", "really", "actually",
  "what", "when", "where", "who", "why", "how", "which",
  "can", "could", "will", "would", "should", "may", "might", "must",
  "dont", "doesnt", "didnt", "isnt", "arent", "wasnt", "cant", "wont", "youre", "theyre", "its",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s.!?]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

export function structuralSkeleton(text: string): string {
  return tokenize(text)
    .map((t) => {
      const bare = t.replace(/[.!?]+$/, "");
      const punct = t.slice(bare.length);
      return (FUNCTION_WORDS.has(bare) ? bare : "_") + punct;
    })
    .join(" ")
    .replace(/(?:_ ){2,}_/g, "_"); // collapse runs of content words
}

export interface ReplyFingerprint {
  /** First three words, normalised. */
  opening: string;
  skeleton: string;
  sentenceCount: number;
  charLength: number;
  isQuestion: boolean;
  angle: Angle;
}

export function fingerprint(text: string, angle: Angle): ReplyFingerprint {
  const trimmed = text.trim();
  const words = tokenize(trimmed);
  const sentences = trimmed.split(/[.!?]+\s/).filter((s) => s.trim().length > 0);
  return {
    opening: words.slice(0, 3).map((w) => w.replace(/[.!?]+$/, "")).join(" "),
    skeleton: structuralSkeleton(trimmed),
    sentenceCount: Math.max(1, sentences.length),
    charLength: trimmed.length,
    isQuestion: trimmed.includes("?"),
    angle,
  };
}

function ngrams(s: string, n: number): Set<string> {
  const parts = s.split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= parts.length; i++) out.add(parts.slice(i, i + n).join(" "));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

function pairSimilarity(a: ReplyFingerprint, b: ReplyFingerprint): number {
  const skeletonSim = jaccard(ngrams(a.skeleton, 3), ngrams(b.skeleton, 3));
  const openingSim = a.opening && a.opening === b.opening ? 1 : 0;

  const lengthRatio =
    Math.min(a.charLength, b.charLength) / Math.max(a.charLength, b.charLength || 1);
  const shapeSim =
    (a.sentenceCount === b.sentenceCount ? 0.4 : 0) +
    (a.isQuestion === b.isQuestion ? 0.2 : 0) +
    0.4 * lengthRatio;

  // The skeleton carries most of the weight on purpose. Two replies with the
  // same skeleton and different nouns are the exact failure this exists to
  // catch, and they must clear the rejection threshold on that alone — opening
  // and shape only sharpen the signal. Shape is capped low because "two
  // statements of similar length" describes most good replies too.
  return 0.72 * skeletonSim + 0.18 * openingSim + 0.1 * shapeSim;
}

/**
 * How much this draft looks like replies already sent. 0 = novel, 1 = identical
 * shape. Compared against the worst offender in the window, not the average —
 * one near-duplicate is the problem, however many unlike it exist.
 */
export function diversityPenalty(
  draft: ReplyFingerprint,
  recent: readonly ReplyFingerprint[],
  window: number,
): number {
  const slice = recent.slice(-window);
  if (slice.length === 0) return 0;
  return Math.max(...slice.map((r) => pairSimilarity(draft, r)));
}

/** Angles used recently, most recent first — used to steer angle selection away from ruts. */
export function recentAngleCounts(recent: readonly ReplyFingerprint[], window: number): Map<Angle, number> {
  const counts = new Map<Angle, number>();
  for (const f of recent.slice(-window)) counts.set(f.angle, (counts.get(f.angle) ?? 0) + 1);
  return counts;
}
