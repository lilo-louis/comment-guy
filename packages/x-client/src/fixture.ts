import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PostWithAuthor, XPost, XUser } from "@cg/domain";
import { CostMeter } from "./cost.ts";
import type { SearchOptions, XClient } from "./types.ts";

/**
 * A fixture post may declare `ageHours` instead of a fixed `createdAt`. The age
 * is resolved against the clock at load time, so a fixture set stays inside the
 * freshness window indefinitely instead of ageing out overnight.
 */
export type FixturePost = Omit<XPost, "createdAt"> & {
  createdAt?: string;
  ageHours?: number;
};

export interface FixtureFile {
  /** Marks hand-collected real posts vs. authored examples. See fixtures/posts/README.md. */
  synthetic: boolean;
  posts: { post: FixturePost; author: XUser }[];
}

function resolveCreatedAt(post: FixturePost, now: number): string {
  if (post.createdAt) return post.createdAt;
  const ageHours = post.ageHours ?? 1;
  return new Date(now - ageHours * 3_600_000).toISOString();
}

/**
 * Reads posts from disk and charges the cost meter as though they had been
 * billed, so Phase A shows the real arithmetic on simulated volume.
 */
export class FixtureXClient implements XClient {
  readonly name = "fixture";
  readonly meter = new CostMeter(true);
  private loaded: PostWithAuthor[] | null = null;
  private published: { inReplyTo: string; text: string }[] = [];

  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async load(): Promise<PostWithAuthor[]> {
    if (this.loaded) return this.loaded;
    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    const all: PostWithAuthor[] = [];
    for (const f of files) {
      const raw = await readFile(join(this.dir, f), "utf8");
      const parsed = JSON.parse(raw) as FixtureFile;
      const now = Date.now();
      for (const entry of parsed.posts) {
        const { ageHours: _ignored, ...rest } = entry.post;
        all.push({
          post: { ...rest, createdAt: resolveCreatedAt(entry.post, now) } as XPost,
          author: entry.author,
        });
      }
    }
    this.loaded = all;
    return all;
  }

  /**
   * Approximates X search: every non-operator term must appear somewhere in the
   * post text. Deliberately crude — its job is to feed the pipeline, not to
   * reimplement X's query language.
   */
  async searchPosts(query: string, opts: SearchOptions): Promise<PostWithAuthor[]> {
    const all = await this.load();
    const terms = query
      .split(/\s+/)
      .filter((t) => t.length > 0 && !t.startsWith("-") && !t.includes(":"))
      .map((t) => t.replace(/["()]/g, "").toLowerCase())
      .filter((t) => t.length > 1 && t !== "or" && t !== "and");

    const cutoff = opts.sinceHoursAgo
      ? Date.now() - opts.sinceHoursAgo * 3_600_000
      : Number.NEGATIVE_INFINITY;

    const hits = all.filter(({ post }) => {
      if (new Date(post.createdAt).getTime() < cutoff) return false;
      if (terms.length === 0) return true;
      const text = post.text.toLowerCase();
      return terms.some((t) => text.includes(t));
    });

    const page = hits.slice(0, opts.maxResults);
    this.meter.record("postRead", page.length);
    return page;
  }

  async userTimeline(xUserId: string, opts: SearchOptions): Promise<PostWithAuthor[]> {
    const all = await this.load();
    const hits = all.filter((p) => p.post.authorId === xUserId).slice(0, opts.maxResults);
    this.meter.record("postRead", hits.length);
    return hits;
  }

  async ownPosts(maxResults: number): Promise<XPost[]> {
    this.meter.record("ownRead", 0);
    void maxResults;
    // Phase A builds the voice profile from fixtures/voice/*.md instead; the X
    // import lands in Phase C once an X developer account exists.
    return [];
  }

  async replyTo(inReplyToPostId: string, text: string): Promise<{ id: string }> {
    this.published.push({ inReplyTo: inReplyToPostId, text });
    this.meter.record(/https?:\/\//.test(text) ? "postWriteWithLink" : "postWrite");
    return { id: `fixture-reply-${this.published.length}` };
  }

  get publishedReplies(): readonly { inReplyTo: string; text: string }[] {
    return this.published;
  }
}
