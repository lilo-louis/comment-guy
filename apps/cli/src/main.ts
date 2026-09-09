#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runCommand } from "./commands/run.ts";
import { voiceBuildCommand, voiceShowCommand } from "./commands/voice.ts";
import { reviewCommand } from "./commands/review.ts";
import { evalCommand } from "./commands/evaluate.ts";
import { c } from "./render.ts";

const USAGE = `${c.bold("cg")} — Comment Guy

${c.bold("Commands")}
  run                 Discover, score, draft and gate. Prints candidates.
  review              Walk the last run's drafts and record approve/edit/skip.
  eval                Pipeline stats, score distribution and your approve rate.
  voice build         Build the voice profile from fixtures/voice/*.md.
  voice show          Print the current voice profile as JSON.

${c.bold("Options")}
  --limit <n>         Max drafts to generate           (default 20)
  --max-per-source <n> Max posts read per source       (default 50)
  --dry               Use canned responses. Nothing billed, nothing sent.
  --stats             Show prefilter rejection breakdown.
  --fresh             Ignore already-seen state. For iterating in Phase A —
                      in production a re-read costs money, so it is off.
  -h, --help

${c.bold("Environment")}
  AWS_PROFILE         AWS profile for Bedrock          (e.g. shopgeist-admin)
  AWS_REGION          Bedrock region                   (default us-east-1)
  DRAFT_MODEL         Override the drafting model      (e.g. anthropic.claude-sonnet-5)
  SCORE_MODEL         Override the scoring/gate model

${c.dim("Phase A reads fixtures from fixtures/posts — no X API calls are made.")}
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      limit: { type: "string", default: "20" },
      "max-per-source": { type: "string", default: "50" },
      dry: { type: "boolean", default: false },
      stats: { type: "boolean", default: false },
      fresh: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const [command, sub] = positionals;

  if (values.help || !command) {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  const limit = Number.parseInt(values.limit as string, 10);
  const maxPerSource = Number.parseInt(values["max-per-source"] as string, 10);
  if (!Number.isFinite(limit) || limit < 1) {
    console.error(c.red("--limit must be a positive integer"));
    return 1;
  }

  switch (command) {
    case "run":
      return runCommand({
        limit,
        dry: values.dry as boolean,
        stats: values.stats as boolean,
        fresh: values.fresh as boolean,
        maxPerSource,
      });
    case "review":
      return reviewCommand();
    case "eval":
      return evalCommand();
    case "voice":
      if (sub === "build") return voiceBuildCommand(values.dry as boolean);
      if (sub === "show") return voiceShowCommand();
      console.error(c.red(`Unknown: cg voice ${sub ?? ""}`));
      console.error("Try `cg voice build` or `cg voice show`.");
      return 1;
    default:
      console.error(c.red(`Unknown command: ${command}`));
      console.log(USAGE);
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n${c.red("Failed:")} ${message}`);
    if (/credential|token|expired|security token|UnrecognizedClient/i.test(message)) {
      console.error(
        c.dim("\nBedrock auth failed. Re-authenticate, e.g.:\n  aws sso login --profile shopgeist-admin\nthen re-run with AWS_PROFILE=shopgeist-admin"),
      );
    }
    if (/AccessDenied|not authorized|model access/i.test(message)) {
      console.error(
        c.dim("\nThis may be Bedrock model access. Opus 5 needs an access request;\nHaiku 4.5 and Sonnet 5 are open. Try DRAFT_MODEL=anthropic.claude-sonnet-5"),
      );
    }
    process.exit(1);
  });
