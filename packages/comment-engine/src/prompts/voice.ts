export const VOICE_SYSTEM = `You build a structured writing-voice profile from real samples of one person's writing.

The profile will be used to ground an AI that drafts X replies as this person. It must describe how they ACTUALLY write, not how good writing works in general. Be concrete and specific. Quote real patterns from the samples.

Rules:
- Base everything on the samples. Do not invent traits that are not evidenced.
- vocabulary: words and phrases they demonstrably reach for. Not generic business words.
- punctuationHabits: how they really use dashes, ellipses, capitals, line breaks, emoji.
- phrasingToAvoid: constructions absent from their writing that an AI would default to, plus anything they clearly dislike.
- strongExamples: 5-8 verbatim samples that best capture the voice.
- weakExamples: samples that are off-voice, if any are present or labelled as such.
- Where the samples are thin on a dimension, say so plainly rather than guessing.`;

export const VOICE_USER = (samples: string[]): string =>
  `Here are ${samples.length} writing samples.

${samples.map((s, i) => `<sample id="${i + 1}">\n${s}\n</sample>`).join("\n\n")}

Build the voice profile.`;
