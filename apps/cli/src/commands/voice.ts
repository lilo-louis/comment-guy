import { buildVoiceProfile } from "@cg/comment-engine";
import { DEFAULT_CONFIG } from "@cg/comment-engine";
import { estimateCostUsd } from "@cg/ai";
import type { WritingSample } from "@cg/domain";
import { PATHS } from "../paths.ts";
import { applyModelOverrides, makeProvider } from "../provider.ts";
import { c, money, rule, wrapText } from "../render.ts";
import { loadVoiceProfile, readVoiceSamples, saveVoiceProfile } from "../storage.ts";

export async function voiceBuildCommand(dry: boolean): Promise<number> {
  const config = applyModelOverrides(DEFAULT_CONFIG);
  const raw = await readVoiceSamples();

  if (raw.length === 0) {
    console.error(c.red("No writing samples found."));
    console.error(`Add ${c.cyan("fixtures/voice/*.md")} with your own posts, replies and messages.`);
    console.error(c.dim("See fixtures/voice/README.md for the format."));
    return 1;
  }

  const samples: WritingSample[] = raw.map((s, i) => ({
    id: `s${i + 1}`,
    text: s.text,
    source: "manual",
    ...(s.weak ? { quality: "weak" as const } : {}),
  }));

  const strong = samples.filter((s) => s.quality !== "weak").length;
  console.log(rule("voice"));
  console.log(`  ${samples.length} samples (${strong} good, ${samples.length - strong} marked off-voice)`);
  if (samples.length < 20) {
    console.log(c.yellow(`  Thin corpus. 50+ samples is where the profile starts describing you rather than guessing.`));
  }

  const { ai, label, free } = makeProvider(dry, config);
  console.log(`  provider ${label}`);
  console.log(c.dim(`  building with ${config.models.drafter}...`));

  const { profile, usage } = await buildVoiceProfile(samples, ai, config.models.drafter);
  const file = await saveVoiceProfile(profile);

  console.log();
  console.log(rule("profile"));
  console.log(`  ${c.bold("tone")}        ${profile.tone}`);
  console.log(`  ${c.bold("sentences")}   ${profile.sentenceLength}`);
  console.log(`  ${c.bold("punctuation")} ${profile.punctuationHabits}`);
  console.log(`  ${c.bold("humour")}      ${profile.humorStyle}`);
  console.log(`  ${c.bold("directness")}  ${profile.directness}`);
  console.log(`  ${c.bold("disagrees")}   ${profile.howIDisagree}`);
  console.log();
  console.log(`  ${c.bold("reaches for")}`);
  console.log(wrapText(profile.vocabulary.join(", "), 4));
  console.log();
  console.log(`  ${c.bold("avoids")}`);
  console.log(wrapText(profile.phrasingToAvoid.join(", "), 4));
  console.log();
  console.log(`  version ${c.cyan(profile.version)} → ${c.cyan(file.replace(PATHS.root + "/", ""))}`);
  console.log(
    c.dim(free ? "  cost $0.0000 (dry run — nothing billed)" : `  cost ${money(estimateCostUsd(config.models.drafter, usage))}`),
  );
  return 0;
}

export async function voiceShowCommand(): Promise<number> {
  const profile = await loadVoiceProfile();
  if (!profile) {
    console.error(c.red("No voice profile yet. Run `cg voice build`."));
    return 1;
  }
  console.log(JSON.stringify(profile, null, 2));
  return 0;
}
