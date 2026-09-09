import { MODELS } from "@cg/ai";

export interface EngineConfig {
  /** Who we are trying to reach. Fed to the scorer verbatim. */
  icp: string;
  /** Grounding context for drafting. Never quoted into a comment. */
  businessContext: string;
  scoring: {
    /** >= this: draft it. */
    draftThreshold: number;
    /** >= this but below draftThreshold: keep as a maybe. */
    maybeThreshold: number;
    /** How many posts to score in one model call, to amortize the rubric. */
    batchSize: number;
  };
  prefilter: {
    maxPostAgeHours: number;
    minAuthorFollowers: number;
    maxExistingReplies: number;
    minPostChars: number;
    blockedAuthorIds: string[];
    politicalTerms: string[];
    baitPhrases: string[];
  };
  drafting: {
    candidatesPerPost: number;
    maxSlopRetries: number;
    maxReplyChars: number;
  };
  diversity: {
    /** Compare against this many recent replies. */
    recentWindow: number;
    /** Above this similarity, a draft is rejected as structurally repetitive. */
    rejectAbove: number;
  };
  slop: {
    bannedPhrases: string[];
    /** Words that must never appear in a published comment. */
    forbiddenTerms: string[];
  };
  models: {
    scorer: string;
    drafter: string;
    slopGate: string;
  };
  promptVersion: string;
}

export const DEFAULT_CONFIG: EngineConfig = {
  icp: `Shopify store founders and operators, especially small-to-medium DTC brands
with enough order and support volume to feel operational pain.

Strong signals: Shopify, DTC, ecommerce operations, customer support, returns,
fulfillment, CX, support/email automation, AI for commerce, store operations,
lean teams, scaling operational workload, conversion, retention, lifecycle marketing.

Weak signals (score low): generic AI discussion, broad startup content, generic
marketing content, political content, unrelated tech discussion.`,

  businessContext: `Louis runs ShopGeist, which handles ecommerce customer support
and store operations for Shopify brands. He has real operating experience with
DTC stores: support volume, returns, fulfillment exceptions, and the gap between
what store owners think is automatable and what actually is.

This context exists to make comments SPECIFIC and grounded. It is never to be
sold, named, or linked in a comment. The profile bio does the selling.`,

  scoring: { draftThreshold: 70, maybeThreshold: 55, batchSize: 10 },

  prefilter: {
    maxPostAgeHours: 24,
    minAuthorFollowers: 300,
    maxExistingReplies: 150,
    minPostChars: 80,
    blockedAuthorIds: [],
    politicalTerms: [
      "trump", "biden", "election", "democrat", "republican", "maga",
      "liberal", "conservative", "abortion", "immigration", "genocide",
      "palestine", "israel", "ukraine", "putin",
    ],
    baitPhrases: [
      "like and retweet", "rt to win", "giveaway", "drop your", "comment below",
      "tag someone", "follow me and", "who wants", "i'll dm you", "reply with",
      "first 100", "link in bio", "🧵 thread", "bookmark this",
    ],
  },

  drafting: { candidatesPerPost: 2, maxSlopRetries: 2, maxReplyChars: 280 },

  diversity: { recentWindow: 40, rejectAbove: 0.72 },

  slop: {
    bannedPhrases: [
      "great post", "absolutely", "this is so true", "couldn't agree more",
      "spot on", "love this", "the real key is", "this is such an important point",
      "well said", "so much this", "100%", "facts", "thanks for sharing",
      "great thread", "underrated take", "this right here",
    ],
    forbiddenTerms: ["shopgeist"],
  },

  models: { scorer: MODELS.haiku, drafter: MODELS.opus, slopGate: MODELS.haiku },

  promptVersion: "v1",
};
