/** Shapes mirroring what the X API returns, narrowed to what the engine actually uses. */

export interface XUser {
  id: string;
  username: string;
  name: string;
  description: string;
  followersCount: number;
  followingCount: number;
  postCount: number;
  verified: boolean;
  createdAt: string;
}

export interface XPostMetrics {
  replyCount: number;
  likeCount: number;
  repostCount: number;
  quoteCount: number;
  /** Only present on posts we author; absent for other people's posts. */
  impressionCount?: number;
}

export interface XPost {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
  lang: string;
  isRetweet: boolean;
  isReply: boolean;
  isQuote: boolean;
  inReplyToPostId?: string;
  conversationId: string;
  metrics: XPostMetrics;
  /** Expanded URLs found in the post body. */
  urls: string[];
  hasMedia: boolean;
}

/**
 * A post together with its author.
 *
 * These always travel as a pair: the live client requests `expansions=author_id`
 * so the author arrives inside the same billed read. Splitting them would mean a
 * separate $0.010 user lookup per post.
 */
export interface PostWithAuthor {
  post: XPost;
  author: XUser;
}
