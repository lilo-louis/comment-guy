import { randomUUID } from "node:crypto";
import type { Decision, DecisionOutcome } from "@cg/domain";
import { DEFAULT_CONFIG } from "@cg/comment-engine";
import { applyModelOverrides } from "../provider.ts";
import { c, relativeAge, rule, scoreColor, wrapText } from "../render.ts";
import { appendDecision, loadLatestRun, loadState, saveState } from "../storage.ts";
import { makePrompter } from "../prompt.ts";

/**
 * Walks the last run one draft at a time and records what Louis actually did.
 *
 * This is the point of Phase A: the decisions file is both the quality signal
 * and the seed of the learning loop, and it costs nothing to produce.
 */
export async function reviewCommand(): Promise<number> {
  const run = await loadLatestRun();
  if (!run) {
    console.error(c.red("No runs yet. Run `cg run` first."));
    return 1;
  }

  const drafted = run.candidates.filter((cand) => cand.draft);
  if (drafted.length === 0) {
    console.error(c.yellow("The last run produced no drafts to review."));
    return 1;
  }

  const config = applyModelOverrides(DEFAULT_CONFIG);
  const rl = await makePrompter();
  const state = await loadState();
  const counts: Record<DecisionOutcome, number> = {
    APPROVED_UNCHANGED: 0, APPROVED_EDITED: 0, REGENERATED: 0, SKIPPED: 0,
  };

  console.log(rule(`reviewing ${drafted.length} drafts from ${run.startedAt.slice(0, 16).replace("T", " ")}`));
  console.log(c.dim("  a = approve · e = edit then approve · s = skip · q = stop\n"));

  try {
    for (const [i, cand] of drafted.entries()) {
      const { post, author } = cand.item;
      const draft = cand.draft!;

      console.log(rule(`${i + 1}/${drafted.length}`));
      console.log(
        `  ${c.bold("@" + author.username)} ${c.dim(`${author.followersCount.toLocaleString()} followers · ${relativeAge(post.createdAt)} ago`)}  ` +
          `${c.dim("score")} ${scoreColor(cand.score.total, config.scoring.draftThreshold, config.scoring.maybeThreshold)} ${c.dim("·")} ${c.magenta(cand.angle)}`,
      );
      console.log();
      console.log(wrapText(post.text, 4));
      console.log();
      console.log(c.green(wrapText(draft.text, 4)));
      console.log();

      const answer = (await rl.ask("  [a/e/s/q] ")).trim().toLowerCase();
      if (answer === "q") break;

      let outcome: DecisionOutcome = "SKIPPED";
      let finalText: string | undefined;
      let note: string | undefined;

      if (answer === "a") {
        outcome = "APPROVED_UNCHANGED";
        finalText = draft.text;
      } else if (answer === "e") {
        const edited = (await rl.ask("  edited: ")).trim();
        if (edited.length > 0) {
          outcome = "APPROVED_EDITED";
          finalText = edited;
        }
      } else {
        const why = (await rl.ask("  why skipped (optional): ")).trim();
        if (why) note = why;
      }

      const decision: Decision = {
        decisionId: randomUUID(),
        decidedAt: new Date().toISOString(),
        outcome,
        post, author,
        score: cand.score,
        angle: cand.angle,
        draftText: draft.text,
        ...(finalText ? { finalText } : {}),
        model: config.models.drafter,
        promptVersion: run.promptVersion,
        voiceProfileVersion: run.voiceProfileVersion,
        ...(note ? { note } : {}),
      };
      await appendDecision(decision);
      counts[outcome]++;

      if (outcome !== "SKIPPED") state.repliedPostIds.push(post.id);
      console.log(c.dim(`  → ${outcome}\n`));
    }
  } finally {
    rl.close();
  }

  await saveState(state);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(rule("summary"));
  console.log(`  approved unchanged  ${counts.APPROVED_UNCHANGED}`);
  console.log(`  approved edited     ${counts.APPROVED_EDITED}`);
  console.log(`  skipped             ${counts.SKIPPED}`);
  if (total > 0) {
    const approved = counts.APPROVED_UNCHANGED + counts.APPROVED_EDITED;
    console.log();
    console.log(`  ${c.bold("approve rate")} ${Math.round((approved / total) * 100)}%  ${c.dim(`(${approved}/${total})`)}`);
    console.log(c.dim("  This is the Phase A gate. If it is low, the drafts are not good enough yet."));
  }
  return 0;
}
