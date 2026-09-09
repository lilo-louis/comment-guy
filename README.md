# Comment Guy

Finds X posts worth replying to, drafts a reply in my voice, and puts the good
ones in front of me to approve. Target: 10–20 genuinely good comments a day,
cleared in a few minutes.

**Status: Phase A.** The engine runs locally against fixture posts. No AWS, no X
API, no deployment yet. The question Phase A exists to answer is whether the
drafts are good enough to post — everything else is deferred until they are.

## Quick start

```bash
pnpm install

# 1. Add your own writing to fixtures/voice/*.md  (see that README for format)
# 2. Build the voice profile
pnpm cg voice build

# 3. Draft against fixture posts
pnpm cg run --limit 20

# 4. Judge them. This is the gate.
pnpm cg review

# 5. See where you stand
pnpm cg eval
```

`--dry` on any command uses canned responses: nothing is sent, nothing is
billed. Use it to check wiring, never to judge quality.

## Commands

| | |
|---|---|
| `cg run` | discover → prefilter → score → draft → gate, then print candidates |
| `cg review` | walk the last run and record approve / edit / skip |
| `cg eval` | funnel stats, score distribution, your approve rate by angle |
| `cg voice build` | regenerate the voice profile from `fixtures/voice/*.md` |
| `cg voice show` | print the current profile |

Options: `--limit N`, `--max-per-source N`, `--dry`, `--stats`.

## How it works

```
fixtures/posts  →  prefilter  →  score  →  select angle  →  draft  →  slop gate  →  candidates
                    (free)      (haiku)                    (opus)   (free + haiku)
```

- **prefilter** — rules only, no model call. Language, age, retweets, replies,
  politics, bait, follower floor, reply flooding, duplicates. Runs only on
  fields already present in the search response, so it can never trigger an
  extra billed lookup.
- **score** — 0–100 across six components. Five are judged by the model in
  batches of ten against a cached rubric; freshness is computed from the
  timestamp because the model has no better information than the clock.
- **draft** — picks an angle the post actually supports, biased away from angles
  used recently, then writes candidates grounded in the voice profile.
- **slop gate** — deterministic checks first (links, banned phrases, length,
  product mentions), then a model judgement. A draft that fails for free never
  costs a token. Plus a structural-repetition check, so twenty individually
  good replies don't all share one shape.

## Cost

X switched to pay-per-use in Feb 2026: **$0.005 per post read**, $0.015 per post
written ($0.20 if it contains a link), $0.01 per user lookup. There is no free
tier.

The consequence shapes the whole design: **every discovered post costs money
whether or not it becomes a comment.** At the target funnel roughly 95% of read
spend is on posts that never get replied to, so discovery breadth is the main
cost dial and filtering belongs in the X *query*, not after the read.

At 15 comments/day the running cost is roughly **$100/month** — about $60 of it
X reads, $35 model spend, $5 AWS. Every `cg run` prints what it cost.

Phase A costs nothing in X spend (fixtures) and ~$10 total in model spend.

Rates live in [`packages/x-client/src/cost.ts`](packages/x-client/src/cost.ts)
and [`packages/ai/src/models.ts`](packages/ai/src/models.ts). The model rates are
first-party estimates — Bedrock's own per-token rates for these models are not on
the public pricing page and still need confirming in the console.

## Models

Bedrock Mantle, via `@anthropic-ai/bedrock-sdk`:

| role | model | why |
|---|---|---|
| scoring, slop gate | `anthropic.claude-haiku-4-5` | high-volume cheap classifier |
| drafting, voice | `anthropic.claude-opus-5` | the output is the product |

**Opus 5 needs a Bedrock model-access request**; Haiku 4.5 and Sonnet 5 are open
to all customers. If that request isn't approved yet, set
`DRAFT_MODEL=anthropic.claude-sonnet-5` rather than waiting.

Two Bedrock constraints the code works around: **structured outputs are not
supported**, so JSON comes back through forced tool use; and **Message Batches
are not supported**, so there is no 50% bulk discount for scoring. Prompt caching
is supported and is used for the scoring rubric and drafting system prompt.

## Layout

```
packages/domain          types only
packages/ai              AIProvider + BedrockProvider + StubProvider
packages/x-client        XClient + FixtureXClient + CostMeter
packages/comment-engine  the product logic — pure, no I/O, no AWS
apps/cli                 the Phase A runner
fixtures/posts           posts to run against (see its README)
fixtures/voice           your writing — gitignored
config/                  targets and topics
```

`comment-engine` is deliberately free of I/O so Phase B can split its stages
across Lambdas without the logic changing.

## Development

```bash
pnpm test        # 52 unit tests, no network, no cost
pnpm typecheck
```

Node 26 runs the TypeScript directly — there is no build step. `tsc` is only
used for typechecking.

## What's next

- **Phase B** — AWS: CDK, Cognito, DynamoDB single-table, SQS pipeline, the
  approval queue web app, publisher with idempotency.
- **Phase C** — live X: developer account, OAuth 2.0 + PKCE, `LiveXClient`,
  KMS-encrypted token storage.

See [the implementation plan](comment-guy-implementation-plan-revised.md).

## Security

Public repo. Never commit AWS credentials, X client secrets, OAuth tokens, or
`.env`. `data/` and `fixtures/voice/` are gitignored — they hold decisions,
drafts and personal writing.
