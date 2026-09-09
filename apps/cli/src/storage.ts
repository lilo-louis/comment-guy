import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Decision, Target, Topic, VoiceProfile } from "@cg/domain";
import type { RunResult } from "@cg/comment-engine";
import { PATHS } from "./paths.ts";

export interface RunSummary {
  runId: string;
  startedAt: string;
  file: string;
}

/** Post ids already surfaced or replied to, so runs do not re-pay for them. */
export interface EngineState {
  seenPostIds: string[];
  repliedPostIds: string[];
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export async function loadTargets(): Promise<Target[]> {
  return readJson<Target[]>(join(PATHS.config, "targets.json"), []);
}

export async function loadTopics(): Promise<Topic[]> {
  return readJson<Topic[]>(join(PATHS.config, "topics.json"), []);
}

export async function loadVoiceProfile(): Promise<VoiceProfile | null> {
  return readJson<VoiceProfile | null>(PATHS.voiceCurrent, null);
}

export async function saveVoiceProfile(profile: VoiceProfile): Promise<string> {
  await ensureDir(PATHS.voice);
  await writeFile(PATHS.voiceCurrent, JSON.stringify(profile, null, 2));
  // Keep every version — the plan treats voice profile version as part of the
  // record on every draft, so old ones must stay resolvable.
  await writeFile(join(PATHS.voice, `${profile.version}.json`), JSON.stringify(profile, null, 2));
  return PATHS.voiceCurrent;
}

export async function saveRun(run: RunResult): Promise<string> {
  await ensureDir(PATHS.runs);
  const file = join(PATHS.runs, `${run.startedAt.replace(/[:.]/g, "-")}-${run.runId.slice(0, 8)}.json`);
  await writeFile(file, JSON.stringify(run, null, 2));
  return file;
}

export async function listRuns(): Promise<string[]> {
  if (!existsSync(PATHS.runs)) return [];
  const files = (await readdir(PATHS.runs)).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => join(PATHS.runs, f));
}

export async function loadLatestRun(): Promise<RunResult | null> {
  const runs = await listRuns();
  const last = runs.at(-1);
  if (!last) return null;
  return JSON.parse(await readFile(last, "utf8")) as RunResult;
}

/** Every run on disk, oldest first, for aggregate evaluation. */
export async function loadRunsForEval(): Promise<RunResult[]> {
  const files = await listRuns();
  const out: RunResult[] = [];
  for (const f of files) out.push(JSON.parse(await readFile(f, "utf8")) as RunResult);
  return out;
}

export async function appendDecision(decision: Decision): Promise<void> {
  await ensureDir(PATHS.data);
  await appendFile(PATHS.decisions, `${JSON.stringify(decision)}\n`);
}

export async function loadDecisions(): Promise<Decision[]> {
  if (!existsSync(PATHS.decisions)) return [];
  const raw = await readFile(PATHS.decisions, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Decision);
}

export async function loadState(): Promise<EngineState> {
  return readJson<EngineState>(PATHS.state, { seenPostIds: [], repliedPostIds: [] });
}

export async function saveState(state: EngineState): Promise<void> {
  await ensureDir(PATHS.data);
  await writeFile(PATHS.state, JSON.stringify(state, null, 2));
}

export async function readVoiceSamples(): Promise<{ text: string; weak: boolean }[]> {
  if (!existsSync(PATHS.fixturesVoice)) return [];
  // README.md documents this directory; it is not writing to learn from.
  const files = (await readdir(PATHS.fixturesVoice)).filter(
    (f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md",
  );
  const samples: { text: string; weak: boolean }[] = [];
  for (const f of files) {
    const raw = await readFile(join(PATHS.fixturesVoice, f), "utf8");
    let inFence = false;
    for (const block of raw.split(/\n\s*\n/)) {
      const trimmed = block.trim();
      if (trimmed.startsWith("```")) {
        // A fence may open and close within one block, or span several.
        if ((trimmed.match(/```/g)?.length ?? 0) % 2 === 1) inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      // Skip markdown scaffolding: headings, lists, quotes, horizontal rules.
      if (trimmed.length < 15 || /^(#|[-*>|]|\d+\.)/.test(trimmed)) continue;
      const weak = trimmed.startsWith("!!");
      samples.push({ text: weak ? trimmed.slice(2).trim() : trimmed, weak });
    }
  }
  return samples;
}
