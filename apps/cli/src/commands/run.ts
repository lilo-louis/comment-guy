import { DEFAULT_CONFIG, fingerprint, runPipeline, type RunResult } from "@cg/comment-engine";
import { estimateCostUsd } from "@cg/ai";
import { FixtureXClient } from "@cg/x-client";
import { PATHS } from "../paths.ts";
import { applyModelOverrides, makeProvider } from "../provider.ts";
import { c, money, relativeAge, rule, scoreColor, table, wrapText } from "../render.ts";
import {
  loadDecisions, loadState, loadTargets, loadTopics, loadVoiceProfile, saveRun, saveState,
} from "../storage.ts";
import { buildVoiceContext } from "@cg/comment-engine";

export interface RunArgs {
  limit: number;
  dry: boolean;
  stats: boolean;
  maxPerSource: number;
}

export async function runCommand(args: RunArgs): Promise<number> {
  const config = applyModelOverrides(DEFAULT_CONFIG);
  const { ai, label, free } = makeProvider(args.dry, config);

  const profile = await loadVoiceProfile();
  if (!profile) {
    console.error(c.red("No voice profile found."));
    console.error(`Add writing samples to ${c.cyan("fixtures/voice/*.md")} then run ${c.cyan("cg voice build")}.`);
    console.error(c.dim("The drafter is grounded in real writing by design — it will not run on a generic 'write casually' instruction."));
    return 1;
  }

  const [targets, topics, state, decisions] = await Promise.all([
    loadTargets(), loadTopics(), loadState(), loadDecisions(),
  ]);

  const x = new FixtureXClient(PATHS.fixturesPosts);
  await x.load();

  // Replies already made feed the diversity window, so drafts do not converge
  // on the shapes already published.
  const recent = decisions
    .filter((d) => d.outcome === "APPROVED_UNCHANGED" || d.outcome === "APPROVED_EDITED")
    .slice(-config.diversity.recentWindow)
    .map((d) => fingerprint(d.finalText ?? d.draftText, d.angle));

  console.log(rule("run"));
  console.log(`  provider   ${label}`);
  console.log(`  voice      ${profile.version} (${profile.sampleCount} samples)`);
  console.log(`  sources    ${targets.filter((t) => t.enabled).length} targets, ${topics.filter((t) => t.enabled).length} topics`);
  console.log(`  history    ${recent.length} recent replies in the diversity window`);
  console.log();

  const run = await runPipeline(x, ai, config, {
    targets, topics,
    maxPostsPerSource: args.maxPerSource,
    maxDrafts: args.limit,
    voiceContext: buildVoiceContext(profile),
    voiceProfileVersion: profile.version,
    recent,
    billed: !free,
    seenPostIds: new Set(state.seenPostIds),
    repliedPostIds: new Set(state.repliedPostIds),
    onProgress: (m) => console.log(c.dim(`  · ${m}`)),
  });

  console.log();
  renderFunnel(run, config, args.stats);
  renderCandidates(run, config);
  renderCost(run, x, free);

  if (!(await hasRealFixtures())) {
    console.log();
    console.log(c.yellow("  Note: every fixture post is synthetic (written to exercise the pipeline)."));
    console.log(c.dim("  Drafts here show the machinery works, not that the output is good enough to post."));
    console.log(c.dim("  See fixtures/posts/README.md for adding real posts."));
  }

  const file = await saveRun(run);
  console.log();
  console.log(`  saved ${c.cyan(file.replace(PATHS.root + "/", ""))}`);
  console.log(`  next  ${c.cyan("pnpm cg review")}`);

  await saveState({
    seenPostIds: [...new Set([...state.seenPostIds, ...run.scored.map((s) => s.postId)])].slice(-5000),
    repliedPostIds: state.repliedPostIds,
  });

  return 0;
}

async function hasRealFixtures(): Promise<boolean> {
  const { readdir, readFile } = await import("node:fs/promises");
  const files = (await readdir(PATHS.fixturesPosts)).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const parsed = JSON.parse(await readFile(`${PATHS.fixturesPosts}/${f}`, "utf8")) as { synthetic?: boolean };
    if (parsed.synthetic === false) return true;
  }
  return false;
}

function renderFunnel(run: RunResult, config: ReturnType<typeof applyModelOverrides>, stats: boolean): void {
  console.log(rule("funnel"));
  const rows = [
    ["discovered", String(run.discovered), ""],
    ["unique", String(run.deduped), c.dim(`${run.discovered - run.deduped} duplicates`)],
    ["passed prefilter", String(run.prefilterKept), c.dim(`${run.deduped - run.prefilterKept} rejected, free`)],
    ["scored", String(run.scored.length), ""],
    [`>= ${config.scoring.draftThreshold}`, String(run.aboveDraftThreshold), c.dim("worth drafting")],
    ["drafted", String(run.candidates.filter((x) => x.draft).length), c.dim(`${run.candidates.filter((x) => !x.draft).length} failed the gate`)],
  ];
  console.log(table(rows, ["stage", "n", ""]).split("\n").map((l) => `  ${l}`).join("\n"));

  if (stats && Object.keys(run.prefilterRejectedByReason).length > 0) {
    console.log();
    console.log(c.dim("  prefilter rejections by reason:"));
    for (const [reason, n] of Object.entries(run.prefilterRejectedByReason).sort((a, b) => b[1] - a[1])) {
      console.log(c.dim(`    ${reason.padEnd(20)} ${n}`));
    }
  }
  console.log();
}

function renderCandidates(run: RunResult, config: ReturnType<typeof applyModelOverrides>): void {
  const drafted = run.candidates.filter((x) => x.draft);
  const failed = run.candidates.filter((x) => !x.draft);

  if (drafted.length === 0) {
    console.log(rule("candidates"));
    console.log(c.yellow("  Nothing produced a usable draft."));
  }

  drafted.forEach((cand, i) => {
    const { post, author } = cand.item;
    console.log(rule(`${i + 1}/${drafted.length}`));
    console.log(
      `  ${c.bold("@" + author.username)} ${c.dim(`${author.followersCount.toLocaleString()} followers · ${relativeAge(post.createdAt)} ago · ${post.metrics.replyCount} replies`)}`,
    );
    console.log(
      `  ${c.dim("score")} ${scoreColor(cand.score.total, config.scoring.draftThreshold, config.scoring.maybeThreshold)}  ${c.dim("angle")} ${c.magenta(cand.angle)}  ${c.dim("via")} ${cand.sourceId}`,
    );
    console.log(c.dim(`  why: ${cand.score.reason}`));
    console.log();
    console.log(wrapText(post.text, 4));
    console.log();
    console.log(c.green(wrapText(cand.draft!.text, 4)));
    const d = cand.draft!;
    console.log(
      c.dim(`    ${d.text.length} chars · diversity ${(d.diversity * 100).toFixed(0)}% · ${d.generationReason.toLowerCase()}`),
    );
    console.log();
  });

  if (failed.length > 0) {
    console.log(rule("rejected by the gate"));
    for (const cand of failed) {
      const reasons = [...new Set(cand.attempts.flatMap((a) => a.slop.failures))];
      console.log(`  ${c.dim("@" + cand.item.author.username)} ${c.red(reasons.join(", ") || "unknown")}`);
      const last = cand.attempts.at(-1);
      if (last) console.log(c.dim(wrapText(`"${last.text}"`, 4)));
    }
    console.log();
  }
}

function renderCost(run: RunResult, x: FixtureXClient, free: boolean): void {
  console.log(rule("cost"));
  if (free) {
    console.log(c.dim("  LLM: $0.0000 (dry run — no request left this machine)"));
  } else {
    for (const [model, usage] of Object.entries(run.usageByModel)) {
      const cost = estimateCostUsd(model, usage);
      console.log(
        `  ${model.padEnd(30)} ${money(cost)} ${c.dim(`(${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.cacheReadTokens} cached)`)}`,
      );
    }
    console.log(`  ${c.bold("LLM total".padEnd(30))} ${c.bold(money(run.llmCostUsd))} ${c.dim("— estimated at first-party rates, see packages/ai/src/models.ts")}`);
  }
  console.log(x.meter.format());
}
