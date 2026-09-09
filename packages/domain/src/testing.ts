import type { XPost, XUser, PostWithAuthor } from "./x.ts";

let seq = 0;

export function makeUser(over: Partial<XUser> = {}): XUser {
  seq++;
  return {
    id: `u${seq}`,
    username: `user${seq}`,
    name: `User ${seq}`,
    description: "DTC founder",
    followersCount: 5000,
    followingCount: 500,
    postCount: 2000,
    verified: false,
    createdAt: "2020-01-01T00:00:00.000Z",
    ...over,
  };
}

export function makePost(over: Partial<XPost> = {}): XPost {
  seq++;
  return {
    id: `p${seq}`,
    authorId: "u1",
    text: "We cut our return rate by changing the size chart on three products. Took an afternoon.",
    createdAt: new Date().toISOString(),
    lang: "en",
    isRetweet: false,
    isReply: false,
    isQuote: false,
    conversationId: `c${seq}`,
    metrics: { replyCount: 4, likeCount: 30, repostCount: 2, quoteCount: 0 },
    urls: [],
    hasMedia: false,
    ...over,
  };
}

export function makeItem(post: Partial<XPost> = {}, author: Partial<XUser> = {}): PostWithAuthor {
  const a = makeUser(author);
  return { post: makePost({ authorId: a.id, ...post }), author: a };
}
