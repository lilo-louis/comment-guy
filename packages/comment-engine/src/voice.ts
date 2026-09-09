import type { AIProvider, TokenUsage } from "@cg/ai";
import type { VoiceProfile, WritingSample } from "@cg/domain";
import { VOICE_SYSTEM, VOICE_USER } from "./prompts/voice.ts";

const VOICE_SCHEMA = {
  type: "object",
  properties: {
    tone: { type: "string" },
    sentenceLength: { type: "string" },
    vocabulary: { type: "array", items: { type: "string" } },
    punctuationHabits: { type: "string" },
    humorStyle: { type: "string" },
    directness: { type: "string" },
    questionHabits: { type: "string" },
    howIDisagree: { type: "string" },
    phrasingToAvoid: { type: "array", items: { type: "string" } },
    strongExamples: { type: "array", items: { type: "string" } },
    weakExamples: { type: "array", items: { type: "string" } },
  },
  required: [
    "tone", "sentenceLength", "vocabulary", "punctuationHabits", "humorStyle",
    "directness", "questionHabits", "howIDisagree", "phrasingToAvoid",
    "strongExamples", "weakExamples",
  ],
  additionalProperties: false,
} as const;

export interface BuildVoiceResult {
  profile: VoiceProfile;
  usage: TokenUsage;
}

/**
 * Derives a structured profile from real writing. The plan is explicit that the
 * voice must be grounded in samples rather than a hand-written "write casually"
 * instruction, so this never runs without samples.
 */
export async function buildVoiceProfile(
  samples: WritingSample[],
  ai: AIProvider,
  model: string,
): Promise<BuildVoiceResult> {
  if (samples.length === 0) {
    throw new Error("Cannot build a voice profile with no writing samples.");
  }

  const res = await ai.completeWithTool<Omit<VoiceProfile, "version" | "generatedAt" | "sampleCount">>({
    model,
    system: VOICE_SYSTEM,
    maxTokens: 4096,
    messages: [{ role: "user", content: VOICE_USER(samples.map((s) => s.text)) }],
    toolName: "submit_voice_profile",
    toolDescription: "Submit the structured writing-voice profile.",
    schema: VOICE_SCHEMA as unknown as Record<string, unknown>,
    parse: (raw) => raw as Omit<VoiceProfile, "version" | "generatedAt" | "sampleCount">,
  });

  const generatedAt = new Date().toISOString();
  return {
    profile: {
      ...res.value,
      version: `v${generatedAt.slice(0, 10)}-${samples.length}`,
      generatedAt,
      sampleCount: samples.length,
    },
    usage: res.usage,
  };
}

/** Renders the profile into the block the drafter's system prompt embeds. */
export function buildVoiceContext(profile: VoiceProfile): string {
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  return `Tone: ${profile.tone}
Sentence length: ${profile.sentenceLength}
Punctuation: ${profile.punctuationHabits}
Humour: ${profile.humorStyle}
Directness: ${profile.directness}
Questions: ${profile.questionHabits}
How he disagrees: ${profile.howIDisagree}

Words and phrases he reaches for:
${list(profile.vocabulary)}

Phrasing that is NOT his and must not appear:
${list(profile.phrasingToAvoid)}

Examples of him writing well — match this register:
${profile.strongExamples.map((e) => `"""${e}"""`).join("\n\n")}${
    profile.weakExamples.length > 0
      ? `\n\nExamples of writing that is off-voice — avoid this register:\n${profile.weakExamples.map((e) => `"""${e}"""`).join("\n\n")}`
      : ""
  }`;
}
