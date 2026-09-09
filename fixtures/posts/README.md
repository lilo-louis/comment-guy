# Fixture posts

Each `*.json` file holds posts the pipeline runs against in Phase A, so the
engine can be built and judged without an X developer account and without
spending anything on reads.

```jsonc
{
  "synthetic": true,          // false ONLY for hand-collected real posts
  "posts": [
    { "post": { ... }, "author": { ... } }
  ]
}
```

A post may set `"ageHours": 3` instead of `"createdAt"`. The age is resolved
against the clock at load time, so a fixture set does not age out of the
24-hour freshness window and start getting rejected as `TOO_OLD`.

## `synthetic` matters

`examples.synthetic.json` was **written to exercise the pipeline**, not
collected from X. The posts are plausible but invented. They are fine for
testing that discovery, prefiltering, scoring and drafting are wired together
correctly.

**They are not a valid Phase A quality gate.** Judging whether drafts are good
enough to post requires real posts, because the drafts are only as good as the
things they are replying to — invented posts are cleaner, more on-topic and more
answerable than the real timeline, and will flatter the engine.

## Adding real posts

Collect 40–60 posts you would genuinely consider replying to, plus some you
would not, and save them as `real.json` with `"synthetic": false`. Field notes:

- `metrics.replyCount` drives the `TOO_MANY_REPLIES` prefilter — get it roughly right.
- `author.followersCount` drives `AUTHOR_TOO_SMALL`.
- `lang` must be `"en"` or the post is dropped before scoring.
- `urls` should list any links in the body; a post that is mostly a link is dropped.

`cg run` reads every `*.json` in this directory, so real and synthetic sets can
coexist — but check `cg run --stats` output for which set the candidates came
from before drawing conclusions about quality.
