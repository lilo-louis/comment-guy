import type { PostWithAuthor, XPost } from "@cg/domain";
import type { CostMeter } from "./cost.ts";

export interface SearchOptions {
  /** Hard cap on posts returned — this is a spend cap, not just a page size. */
  maxResults: number;
  sinceHoursAgo?: number;
}

/**
 * The seam between discovery and X.
 *
 * The engine must never be able to tell whether it is talking to fixtures or to
 * the real API. Both implementations return authors alongside posts, because
 * the live one requests `expansions=author_id` so authors arrive inside the same
 * billed read — fetching them separately is $0.010 each.
 */
export interface XClient {
  readonly name: string;
  readonly meter: CostMeter;
  searchPosts(query: string, opts: SearchOptions): Promise<PostWithAuthor[]>;
  userTimeline(xUserId: string, opts: SearchOptions): Promise<PostWithAuthor[]>;
  /** Own posts and replies, for building the voice profile. Billed at the cheaper own-read rate. */
  ownPosts(maxResults: number): Promise<XPost[]>;
  replyTo(inReplyToPostId: string, text: string): Promise<{ id: string }>;
}
