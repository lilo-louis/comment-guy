**# Comment Guy — Implementation Plan**

**## Context**

\`comment-guy-v1-plan.md\` specifies a full product: discover X posts → score → draft replies in Louis's voice → approve in a web queue → publish via the X API, with a learning loop. The repo is currently empty apart from that plan.

Two things changed the shape of the build:

**\*\*X API is pay-per-use as of Feb 2026.\*\*** Subscription tiers are gone, there is no free tier. Reads are $0.005/post, $0.010/user lookup; writes are $0.015/post, or **\*\*$0.20 if the post contains a link\*\***. This means every discovered post costs half a cent whether or not it becomes a comment — and the plan's funnel (300 discovered → 15 posted) throws away \~95% of read spend. Discovery breadth is now the dominant cost dial, and filtering must happen in the X *\*query\**, not after the read.

**\*\*Louis has no X developer account yet.\*\*** So week 1 cannot hit X at all.

That reorders the work. The plan's Phase 0→9 puts \~2 weeks of CDK/Cognito/SQS scaffolding in front of the first drafted comment, but the project's real risk is not infrastructure — it is whether the drafts are good enough that Louis will actually post them. **\*\*Phase A below answers that question in week 1, for \~$10 of LLM spend and $0 of X spend, using fixture posts.\*\*** The comment engine is written as a pure, network-free package so Phase B lifts it into Lambdas unchanged.

**\*\*Decisions taken:\*\*** vertical slice first; Bedrock as the AI provider; deploy to the \`shopgeist-admin\` AWS account; public GitHub repo.

**### Estimated running cost at target volume (15 comments/day)**

\| | /month | Note |

\|---|---|---|

\| X post reads (300/day) | \~$45 | the main dial — halve discovery, halve this |

\| X author lookups | \~$9 | only for uncached authors |

\| X writes (15/day, no links) | \~$7 | the "never include a link" rule saves $0.185/comment |

\| Bedrock (Haiku scoring + Opus drafting) | \~$35 | first-party rate estimate; **\*\*confirm Bedrock's own rates in console\*\*** |

\| AWS (Lambda/DynamoDB/SQS/CloudFront/Cognito/KMS/SSM) | \~$3–5 | mostly free tier; SSM Standard parameters are free, with one shared customer-managed KMS key for tenant OAuth-token encryption |

\| **\*\*Total\*\*** | **\*\*\~$100/mo\*\*** | |

Phase A alone costs \~$10 total and no X spend.

**---**

**## Phase A — Vertical slice (no AWS, no X)**

Goal: 20 real drafted comments printed to the terminal, judged by Louis, before any infrastructure exists.

**### Repo layout**

Monorepo from day one (pnpm workspaces) so Phase B lifts packages into Lambdas without moving code.

\`\`\`

comment-guy/

├── packages/

│   ├── domain/          # types only: XPost, XUser, Candidate, Draft, VoiceProfile, Target, Topic, Decision

│   ├── ai/              # AIProvider interface + BedrockProvider (+ StubProvider for tests)

│   ├── x-client/        # XClient interface + FixtureXClient (Phase A) + LiveXClient (Phase C)

│   └── comment-engine/  # the actual product logic — pure, no network, no AWS

├── fixtures/

│   ├── posts/           # 40–60 real X posts, hand-collected — committed, doubles as the golden set

│   └── voice/           # Louis's own posts/replies/messages — GITIGNORED (may contain private writing)

├── apps/cli/            # the slice runner

├── data/                # runs, decisions, voice profile — GITIGNORED

└── comment-guy-v1-plan.md

\`\`\`

Node 26 / pnpm 10 are already installed. \`git init\` needed — this is not yet a repo.

**### \`packages/comment-engine\` — the part that matters**

Pure functions, no I/O, injected \`AIProvider\`. This is what gets iterated on all week and what Phase B reuses verbatim.

\- \`prefilter(post, author, config)\` — rule-based reject, **\*\*runs only on data already in the search response\*\*** so it never triggers a billed lookup. Rejects: politics, giveaway/engagement bait, retweet-only, non-English, too old, already replied, blocked author, duplicate.

\- \`scorePosts(posts[], voice, config)\` — batches \~10 posts per Haiku call to amortize the rubric. Returns the plan's six components (ICP fit 0–25, author relevance 0–20, topic 0–20, freshness 0–15, reply opportunity 0–10, ability to add value 0–10), a reason string, and candidate angles.

\- \`selectAngle(post, score, recentAngles)\` — picks from the plan's six angles, biased away from recently-used ones.

\- \`draftReply(post, angle, voiceContext, examples)\` — Opus 5 generates 2–3 candidates.

\- \`runSlopGate(draft, post, recent)\` — the plan's §22 rejection list. Returns \`PASS\` or \`FAIL + reasons\`. Regenerates up to 2× on failure.

\- \`diversityPenalty(draft, recentFingerprints)\` — the plan's §23 structural-repetition check.

\- \`buildVoiceContext(profile, examples, post)\` — assembles the grounded voice prompt.

Two things every implementation must respect:

1\. **\*\*Bedrock does not support structured outputs.\*\*** Get JSON from the scorer and slop gate via forced tool use (\`tool\_choice: {type: "tool"}\` — supported on Opus 5 and Sonnet 5 on Bedrock), never by asking for JSON in prose and parsing it.

2\. **\*\*Bedrock does not support Message Batches\*\***, so there is no 50% bulk discount for scoring. Prompt caching *\*is\** supported — put the scoring rubric and voice profile in a cached prefix and the per-post content after it.

**### \`packages/ai\`**

\`AIProvider\` interface (\`complete\`, \`completeWithTool\`) with \`BedrockProvider\` using \`AnthropicBedrockMantle\` from \`@anthropic-ai/bedrock-sdk\`. Use the **\*\*global endpoint\*\*** — regional endpoints carry a 10% premium.

\- Scoring: \`anthropic.claude-haiku-4-5\` — deliberate choice, it is a high-volume cheap classifier and the plan calls for exactly that.

\- Drafting: \`anthropic.claude-opus-5\`. **\*\*Opus 5 requires a Bedrock model-access request\*\***; Haiku 4.5 and Sonnet 5 are open to all customers. If the access request isn't through, set \`DRAFT\_MODEL=anthropic.claude-sonnet-5\` and proceed — do not silently substitute.

\- \`StubProvider\` returns canned responses so unit tests and \`--dry\` runs cost nothing.

**### \`packages/x-client\`**

\`XClient\` interface defined now, \`FixtureXClient\` implemented now, \`LiveXClient\` in Phase C. The engine must never know which one it has.

\- \`search()\` and \`timeline()\` return posts **\*\*with author objects attached\*\*** (live impl uses \`expansions=author\_id\` so authors arrive in the same billed call — a separate user lookup is $0.010 each and is the easiest way to accidentally triple the bill).

\- \`CostMeter\` counts billed reads/writes per run and prints the dollar figure at the end of every run, starting in Phase A with simulated costs. Cost visibility on day one, not after the first surprise invoice.

**### \`apps/cli\`**

\- \`cg voice build\` — reads \`fixtures/voice/\*.md\`, generates the structured \`VoiceProfile\` (plan §8), writes \`data/voice/current.json\`. Louis pastes his own posts/replies in by hand for now; Phase C swaps the source for the X import with no change to the profile format.

\- \`cg run --limit 20\` — fixtures → prefilter → score → draft → slop gate → prints a ranked table plus full drafts, writes \`data/runs/\<ts>.json\`, prints the cost meter.

\- \`cg review\` — walks the last run one draft at a time, \`a\`/\`e\`/\`s\` (approve/edit/skip), appends to \`data/decisions.jsonl\` with the full record from plan §9 (original post, AI draft, human edit, angle, voice version, model, score). This is the golden set *\*and\** the seed of the learning loop, and it costs nothing to build.

\- \`cg eval\` — replays the fixture set and reports score distribution, slop-gate pass rate, and approve rate from \`decisions.jsonl\`.

**### Phase A is done when**

Louis runs \`cg run\` on 40–60 fixture posts and says the drafts are worth posting — or says what's wrong, and the engine is iterated until he does. **\*\*No AWS work starts until this passes.\*\*** If the drafts are bad, that is far cheaper to discover here than after the CDK stack exists.

**---**

**## Phase B — AWS backend**

Only after Phase A passes. Follows the original plan's §13–§30 closely; \`packages/comment-engine\` moves in unchanged.

\- Phase 0/1: CDK v2 app, dev + prod stacks, GitHub Actions OIDC (no long-lived AWS keys), Cognito, API Gateway HTTP API + JWT authorizer, \`/me\`, single-table DynamoDB with the plan's §17 key design and §18 GSIs. Explicit user/tenant/account entities from the start — never \`user = tenant\`.

\- Phase 5–7: EventBridge Scheduler → discovery Lambda → SQS → scorer → SQS → drafter, each with its own least-privilege role per §27. \`PUBLISHING\_ENABLED=false\` in dev.

\- Phase 8: the \`/queue\` React app (Vite, private S3 + CloudFront + OAC) with Skip/Regenerate/Edit/Post and the \`A\`/\`E\`/\`R\`/\`S\` shortcuts.

\- Phase 9: publisher Lambda with the §28 idempotency key (\`tenantId + sourceXPostId + approvedDraftId\`) claimed *\*before\** the X write.

Requires \`aws login\` with the \`shopgeist-admin\` profile — the current session is expired — plus Bedrock model access enabled in that account.

**---**

**## Phase C — Live X**

Can start in parallel with Phase B; blocks Phase 9 only.

**\*\*Setup checklist (Louis, one-time):\*\***

1\. developer.x.com → create developer account.

2\. Create a Project + App.

3\. User authentication settings → OAuth 2.0, **\*\*Confidential client\*\***, PKCE. Callbacks: \`http\://localhost:5173/x/callback\` (dev) and the CloudFront domain (prod). Scopes, minimal: \`tweet.read\`, \`tweet.write\`, \`users.read\`, \`offline.access\`.

4\. Add a payment method and prepaid credits in the developer console — pay-per-use blocks requests at a negative balance.

5\. Store X application configuration in **SSM Parameter Store Standard tier**, never in the repo:
   - `/<app>/<env>/x/client-id` → `String` (not secret, but centralized config)
   - `/<app>/<env>/x/client-secret` → `SecureString`
   - Use the default AWS-managed `alias/aws/ssm` key for the app secret initially to avoid a fixed customer-managed-key charge for this one parameter.
   - Grant `ssm:GetParameter` only on the exact parameter ARN to the OAuth/token-refresh functions that need it.
   - Cache the value in the warm Lambda execution environment after first retrieval; do not fetch it on every request.

Then: \`LiveXClient\` (rate limits, retry, cost metering), the OAuth callback Lambda, encrypted tenant-token storage per the design below, and the voice importer reading real posts (own-data reads are $0.001, \~$1 one-time).

### Secret and OAuth-token storage

Use **two different storage patterns**. Do not put every merchant token into Parameter Store.

#### 1. App-level static configuration — SSM Parameter Store

Use Standard-tier Parameter Store for the small number of deployment-level values:

```text
/comment-guy/dev/x/client-id
/comment-guy/dev/x/client-secret
/comment-guy/prod/x/client-id
/comment-guy/prod/x/client-secret
```

- `client-id`: `String`
- `client-secret`: `SecureString`
- Standard tier only.
- Use `alias/aws/ssm` initially.
- Exact-resource IAM only.
- Read at Lambda cold start / first use and cache in memory for the lifetime of that execution environment.
- Never expose the secret through API responses or logs.

This avoids per-secret monthly storage charges while keeping the value outside source control and deployment artifacts.

#### 2. Per-tenant X OAuth tokens — encrypted DynamoDB attributes

Do **not** create one Parameter Store parameter per merchant. Standard Parameter Store tops out at 10,000 parameters per account/Region, while advanced parameters introduce per-parameter cost and still impose a finite quota.

Keep each tenant's OAuth state on its existing account item:

```text
PK = TENANT#<tenantId>
SK = XACCOUNT#<xUserId>

accessTokenCiphertext
refreshTokenCiphertext
tokenExpiresAt
refreshTokenExpiresAt
cryptoVersion
```

Encrypt `accessToken` and `refreshToken` **before writing to DynamoDB** using the AWS Encryption SDK for JavaScript (Node.js) and one shared customer-managed symmetric KMS key:

```text
alias/comment-guy-oauth
```

Do **not** create a KMS key per tenant.

Bind every ciphertext to encryption context/AAD:

```text
app=comment-guy
env=<dev|prod>
tenantId=<tenantId>
xUserId=<xUserId>
purpose=x-oauth
```

Only the OAuth callback/token-refresh/publisher roles may use the KMS key for decrypt. Discovery, scoring, drafting, frontend APIs and unrelated Lambdas must not have decrypt permission.

The customer-managed KMS key is the only fixed-cost crypto primitive for tenant tokens. Its cost is shared across every tenant instead of growing linearly with customer count.

#### KMS scaling

Start with the normal KMS keyring behind a small `TokenCrypto` interface:

```ts
interface TokenCrypto {
  encrypt(plaintext, context): Promise<string>
  decrypt(ciphertext, context): Promise<string>
}
```

KMS already includes a request free tier and request pricing is tiny relative to X/LLM spend. If token traffic later becomes large enough for KMS calls or throughput to matter, replace the implementation with the AWS KMS Hierarchical keyring / cryptographic-material caching without changing the rest of the application. Keep `cryptoVersion` on each token record so encryption implementations can be migrated safely.

#### Explicitly not used

```text
Secrets Manager
one Parameter Store SecureString per merchant
one KMS key per merchant
plaintext OAuth tokens in DynamoDB
OAuth tokens in Lambda environment variables
OAuth tokens in the frontend
```


**\*\*Cost discipline in \`LiveXClient\`, enforced from the first live call:\*\*** narrow queries with \`-is\:retweet -is\:reply lang\:en\` and specific terms rather than broad topic words; \`expansions=author\_id\` on every search; a global \`XUSER#\` cache so an author is looked up once ever; a hard daily read budget in config that stops discovery when hit.

**---**

**## Repo and security**

Public repo \`lilo-louis/comment-guy\`, per plan §25: branch protection, PR checks, secret scanning + push protection, Dependabot, CodeQL. \`.gitignore\` must cover \`.env\*\`, \`data/\`, \`fixtures/voice/\`.

\`fixtures/posts/\` is committed (public tweets, and it doubles as the golden test set). \`fixtures/voice/\` is not — plan §8 includes "messages I wrote", which is private writing.

**---**

**## Verification**

\- \`pnpm test\` — unit tests for \`prefilter\`, \`runSlopGate\`, \`diversityPenalty\`, \`selectAngle\`, scoring aggregation, and the idempotency helper. All pure functions against \`StubProvider\`, no network, no cost.

\- \`cg run --dry\` — full pipeline on \`StubProvider\`, asserts the wiring without spending anything.

\- \`cg run --limit 20\` against real Bedrock — the actual Phase A gate. Louis reads the drafts.

\- \`cg eval\` — score distribution, slop-gate pass rate, approve rate. Run it after every engine change; it is the regression test for quality.

\- Phase B: \`cdk deploy\` to dev, log in through Cognito, confirm the queue renders seeded candidates and that publishing is refused while \`PUBLISHING\_ENABLED=false\`.

\- Phase 9: post one real reply to a throwaway post, then re-fire the same publish request and confirm the idempotency record prevents a second write.

**---**

**## Open items**

\- Bedrock's own per-token rates for Opus 5 / Sonnet 5 / Haiku 4.5 aren't published on the public pricing page (the estimate above uses first-party rates). Confirm in the Bedrock console once \`shopgeist-admin\` is re-authenticated.

\- Whether the Opus 5 Bedrock model-access request is approved for that account. Sonnet 5 is the fallback.