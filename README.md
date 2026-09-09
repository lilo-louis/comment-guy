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

Options: `--limit N`, `--max-per-source N`, `--dry`, `--stats`, `--fresh`.

`--fresh` ignores the already-seen set so the same fixtures can be re-run while
iterating. In production a re-read costs real money, so it is off by default.

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

At 15 comments/day the running cost is roughly **$80/month** — about $60 of it
X reads, ~$17 model spend, ~$5 AWS. Every `cg run` prints what it cost.

The model figure is measured, not estimated: a live run scored 14 posts and
drafted 5 for $0.08, which is $0.0007 per post scored and $0.014 per draft.

Phase A costs nothing in X spend (fixtures) and ~$10 total in model spend.

Rates live in [`packages/x-client/src/cost.ts`](packages/x-client/src/cost.ts)
and [`packages/ai/src/models.ts`](packages/ai/src/models.ts). The model rates are
first-party estimates — Bedrock's own per-token rates for these models are not on
the public pricing page and still need confirming in the console.

## Models

Via `@anthropic-ai/bedrock-sdk`.

Bedrock exposes Claude through two surfaces and this account is only enabled for
one of them. Verified on account 139830186180, 2026-09-09:

- **Mantle** (the newer Messages-API endpoint, short IDs like
  `anthropic.claude-opus-5`) — **not enabled**. Every model 403s with "not
  available for this account", including open-access ones.
- **InvokeModel** (classic `bedrock-runtime`, dated IDs behind a `us.`/`global.`
  inference profile) — works.

On the invoke path, Sonnet 5, Opus 5, Opus 4.8 and Opus 4.7 are all denied. What
actually answers:

| role | model | why |
|---|---|---|
| scoring, slop gate | `global.anthropic.claude-haiku-4-5-...` | high-volume cheap classifier |
| drafting, voice | `global.anthropic.claude-sonnet-4-6` | newest generation reachable here |
| alternative | `us.anthropic.claude-opus-4-5-...` | higher tier, older generation |

Set `BEDROCK_BACKEND=mantle` and the short IDs once Mantle access is granted.

Three Bedrock constraints the code works around: **structured outputs are not
supported**, so JSON comes back through forced tool use; **Message Batches are
not supported**, so there is no 50% bulk discount for scoring; and **prompt
caching only applies above a 2048-token prefix** — the drafter's system prompt
clears it (~2.2k tokens with the voice profile embedded), the scoring rubric
(~875 tokens) does not.

Thinking is deliberately **off** for drafting. Measured: with thinking, a draft
cost 1229 output tokens and at a 512-token budget consumed the entire allowance
and returned nothing; without it, 36 tokens and a better reply. Reasoning depth
is not what makes a good 280-character comment.

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
