import type { XPost, XUser } from "./x.ts";

export const ANGLES = [
  "OPERATOR_INSIGHT",
  "SPECIFIC_DISAGREEMENT",
  "USEFUL_EXTENSION",
  "SHARP_QUESTION",
  "SMALL_JOKE",
  "REAL_EXAMPLE",
] as const;

export type Angle = (typeof ANGLES)[number];

export type PrefilterReason =
  | "NOT_ENGLISH"
  | "TOO_OLD"
  | "RETWEET"
  | "IS_REPLY"
  | "POLITICS"
  | "ENGAGEMENT_BAIT"
  | "GIVEAWAY_SPAM"
  | "TOO_SHORT"
  | "TOO_MANY_REPLIES"
  | "AUTHOR_TOO_SMALL"
  | "AUTHOR_BLOCKED"
  | "ALREADY_SEEN"
  | "ALREADY_REPLIED"
  | "LINK_ONLY";

export interface PrefilterResult {
  passed: boolean;
  reasons: PrefilterReason[];
}

export interface ScoreComponents {
  /** 0-25 */ icpFit: number;
  /** 0-20 */ authorRelevance: number;
  /** 0-20 */ topicRelevance: number;
  /** 0-15 */ freshness: number;
  /** 0-10 */ replyOpportunity: number;
  /** 0-10 */ valueAdd: number;
}

export interface PostScore {
  postId: string;
  /** 0-100, the sum of the components. */
  total: number;
  components: ScoreComponents;
  reason: string;
  candidateAngles: Angle[];
}

export type SlopFailure =
  | "GENERIC_PRAISE"
  | "RESTATES_POST"
  | "PROMOTIONAL"
  | "MENTIONS_SHOPGEIST"
  | "CONTAINS_LINK"
  | "CORPORATE_TONE"
  | "FAKE_ANECDOTE"
  | "TOO_LONG"
  | "BANNED_PHRASE"
  | "REPETITIVE"
  | "NOT_SPECIFIC"
  | "EMPTY";

export interface SlopGateResult {
  passed: boolean;
  failures: SlopFailure[];
  notes: string;
}

export interface Draft {
  draftId: string;
  candidateId: string;
  text: string;
  angle: Angle;
  model: string;
  promptVersion: string;
  voiceProfileVersion: string;
  createdAt: string;
  generationReason: "INITIAL" | "SLOP_RETRY" | "USER_REGENERATE";
  qualityScores: {
    slop: SlopGateResult;
    /** 0-1, higher means more structurally similar to recent replies. */
    diversityPenalty: number;
  };
  editedText?: string;
  editedAt?: string;
}

export type CandidateStatus =
  | "DISCOVERED"
  | "FILTERED"
  | "SCORING"
  | "DRAFTING"
  | "PENDING"
  | "SKIPPED"
  | "APPROVED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED";

export interface Candidate {
  candidateId: string;
  tenantId: string;
  xPostId: string;
  authorId: string;
  discoveredAt: string;
  postCreatedAt: string;
  sourceType: "TARGET" | "TOPIC";
  sourceId: string;
  status: CandidateStatus;
  relevanceScore?: number;
  scoreReasons?: string;
  selectedAngle?: Angle;
  draftIds: string[];
  activeDraftId?: string;
  approvedAt?: string;
  publishedReplyId?: string;
  failureReason?: string;
}

export type DecisionOutcome =
  | "APPROVED_UNCHANGED"
  | "APPROVED_EDITED"
  | "REGENERATED"
  | "SKIPPED";

/** One row of preference data. This is the learning loop's raw material. */
export interface Decision {
  decisionId: string;
  decidedAt: string;
  outcome: DecisionOutcome;
  post: XPost;
  author: XUser;
  score: PostScore;
  angle: Angle;
  draftText: string;
  finalText?: string;
  model: string;
  promptVersion: string;
  voiceProfileVersion: string;
  /** Free-text note from Louis on why, when he bothers to give one. */
  note?: string;
}
