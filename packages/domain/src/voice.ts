export interface VoiceProfile {
  version: string;
  generatedAt: string;
  /** Number of writing samples the profile was derived from. */
  sampleCount: number;
  tone: string;
  sentenceLength: string;
  vocabulary: string[];
  punctuationHabits: string;
  humorStyle: string;
  directness: string;
  questionHabits: string;
  howIDisagree: string;
  phrasingToAvoid: string[];
  strongExamples: string[];
  weakExamples: string[];
}

export interface WritingSample {
  id: string;
  text: string;
  source: "x-post" | "x-reply" | "manual";
  /** Louis's own labelling: is this writing he wants more or less of? */
  quality?: "strong" | "weak";
}
