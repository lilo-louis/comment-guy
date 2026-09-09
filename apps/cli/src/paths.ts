import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "../../..");

export const PATHS = {
  root: ROOT,
  fixturesPosts: join(ROOT, "fixtures/posts"),
  fixturesVoice: join(ROOT, "fixtures/voice"),
  config: join(ROOT, "config"),
  data: join(ROOT, "data"),
  runs: join(ROOT, "data/runs"),
  voice: join(ROOT, "data/voice"),
  voiceCurrent: join(ROOT, "data/voice/current.json"),
  decisions: join(ROOT, "data/decisions.jsonl"),
  state: join(ROOT, "data/state.json"),
};
