import { DEFAULT_CONFIG } from "@cg/comment-engine";
import { c, rule, table } from "../render.ts";
import { loadDecisions, loadRunsForEval } from "../storage.ts";

/**
 * The regression test for quality. Unlike the unit tests it measures the thing
 * that actually matters — what fraction of drafts Louis was willing to post —
 * and it is the number to watch after every prompt or config change.
 */
export async function evalCommand(): Promise<number> {
  const [decisions, runs] = await Promise.all([loadDecisions(), loadRunsForEval()]);

  if (runs.length === 0) {
    console.error(c.red("No runs to evaluate. Run `cg run` first."));
    return 1;
  }

  console.log(rule("pipeline"));
  const totals = runs.reduce(
    (acc, r) => ({
      runs: acc.runs + 1,
      discovered: acc.discovered + r.discovered,
      kept: acc.kept + r.prefilterKept,
      scored: acc.scored + r.scored.length,
      above: acc.above + r.aboveDraftThreshold,
      drafted: acc.drafted + r.candidates.filter((x) => x.draft).length,
      gateFailed: acc.gateFailed + r.candidates.filter((x) => !x.draft).length,
      cost: acc.cost + r.llmCostUsd,
    }),
    { runs: 0, discovered: 0, kept: 0, scored: 0, above: 0, drafted: 0, gateFailed: 0, cost: 0 },
  );

  const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);
  console.log(
    table(
      [
        ["discovered", String(totals.discovered), ""],
        ["passed prefilter", String(totals.kept), pct(totals.kept, totals.discovered)],
        ["above threshold", String(totals.above), pct(totals.above, totals.scored)],
        ["produced a draft", String(totals.drafted), pct(totals.drafted, totals.drafted + totals.gateFailed)],
        ["failed slop gate", String(totals.gateFailed), pct(totals.gateFailed, totals.drafted + totals.gateFailed)],
      ],
      ["stage", "n", "rate"],
    )
      .split("\n").map((l) => `  ${l}`).join("\n"),
  );
  const dryRuns = runs.filter((r) => !r.billed).length;
  console.log(
    c.dim(
      `\n  across ${totals.runs} run(s), $${totals.cost.toFixed(2)} of model spend` +
        (dryRuns > 0 ? ` · ${dryRuns} dry run(s) excluded from cost` : ""),
    ),
  );
  if (dryRuns === totals.runs) {
    console.log(c.yellow("  Every run was a dry run — these are wiring statistics, not quality signals."));
  }

  // Score distribution — shows whether the threshold is in the right place.
  const buckets = new Map<string, number>();
  for (const r of runs) {
    for (const s of r.scored) {
      const b = `${Math.floor(s.total / 10) * 10}-${Math.floor(s.total / 10) * 10 + 9}`;
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
  }
  if (buckets.size > 0) {
    console.log();
    console.log(rule("score distribution"));
    const max = Math.max(...buckets.values());
    for (const key of [...buckets.keys()].sort((a, b) => Number(b.split("-")[0]) - Number(a.split("-")[0]))) {
      const n = buckets.get(key)!;
      const bar = "█".repeat(Math.max(1, Math.round((n / max) * 40)));
      const marker = Number(key.split("-")[0]) >= DEFAULT_CONFIG.scoring.draftThreshold ? c.green(bar) : c.dim(bar);
      console.log(`  ${key.padStart(6)} ${String(n).padStart(4)} ${marker}`);
    }
  }

  console.log();
  console.log(rule("your decisions"));
  if (decisions.length === 0) {
    console.log(c.yellow("  No decisions recorded yet — run `cg review`."));
    console.log(c.dim("  Until then there is no quality signal, only pipeline statistics."));
    return 0;
  }

  const by = (o: string) => decisions.filter((d) => d.outcome === o).length;
  const approved = by("APPROVED_UNCHANGED") + by("APPROVED_EDITED");
  console.log(
    table(
      [
        ["approved unchanged", String(by("APPROVED_UNCHANGED")), pct(by("APPROVED_UNCHANGED"), decisions.length)],
        ["approved edited", String(by("APPROVED_EDITED")), pct(by("APPROVED_EDITED"), decisions.length)],
        ["skipped", String(by("SKIPPED")), pct(by("SKIPPED"), decisions.length)],
      ],
      ["outcome", "n", "rate"],
    ).split("\n").map((l) => `  ${l}`).join("\n"),
  );

  console.log();
  console.log(`  ${c.bold("approve rate")} ${c.bold(pct(approved, decisions.length))}  ${c.dim(`(${approved}/${decisions.length})`)}`);

  // Which angles actually get approved — the cheapest signal in the whole file.
  const angleStats = new Map<string, { total: number; approved: number }>();
  for (const d of decisions) {
    const s = angleStats.get(d.angle) ?? { total: 0, approved: 0 };
    s.total++;
    if (d.outcome !== "SKIPPED" && d.outcome !== "REGENERATED") s.approved++;
    angleStats.set(d.angle, s);
  }
  if (angleStats.size > 0) {
    console.log();
    console.log(c.dim("  by angle:"));
    for (const [angle, s] of [...angleStats].sort((a, b) => b[1].total - a[1].total)) {
      console.log(`    ${angle.padEnd(24)} ${String(s.approved).padStart(3)}/${String(s.total).padEnd(3)} ${pct(s.approved, s.total)}`);
    }
  }

  const edited = decisions.filter((d) => d.outcome === "APPROVED_EDITED" && d.finalText);
  if (edited.length > 0) {
    const avgDelta =
      edited.reduce((sum, d) => sum + Math.abs((d.finalText?.length ?? 0) - d.draftText.length), 0) / edited.length;
    console.log();
    console.log(c.dim(`  average edit changed length by ~${Math.round(avgDelta)} chars`));
  }

  return 0;
}
