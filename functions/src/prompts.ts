import type { CefrLevel, LanguageConfig, LessonType } from "@resolingo/shared";

export function lessonPrompt(input: {
  type: LessonType;
  nativeLanguage: LanguageConfig;
  targetLanguage: LanguageConfig;
  level: CefrLevel;
  recentTopics: string[];
}): string {
  const avoid = input.recentTopics.length ? input.recentTopics.join("; ") : "none";
  const common = `Create a self-contained 3–5 minute ${input.type} audio lesson for a ${input.level} learner of ${input.targetLanguage.label}. Their teaching language is ${input.nativeLanguage.label}. Choose a useful everyday topic automatically. Avoid these recent topics: ${avoid}. Use concise, natural language. Every segment must have a stable id, kind, speaker, language, and text. Use BCP-47 language ids exactly: teaching=${input.nativeLanguage.id}, target=${input.targetLanguage.id}. Do not include markdown.`;

  if (input.type === "conversation") {
    return `${common} Build a realistic conversation between speakerA and speakerB. Interleave short teacher narration where useful. Target-language dialogue segments should include a ${input.nativeLanguage.label} translation${input.targetLanguage.transliteration ? " and Latin-script transliteration" : ""}. End with a short recap.`;
  }
  return `${common} Build a teacher-led grammar lesson with explanation, target-language examples, short listen-and-repeat drills, and a recap. Target-language examples should include a ${input.nativeLanguage.label} translation${input.targetLanguage.transliteration ? " and Latin-script transliteration" : ""}.`;
}
