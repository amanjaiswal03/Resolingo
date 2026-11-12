import { LESSON_SEGMENT_MAX, LESSON_SEGMENT_MIN, type CefrLevel, type LanguageConfig, type LessonType } from "@resolingo/shared";

export function lessonPrompt(input: {
  type: LessonType;
  nativeLanguage: LanguageConfig;
  targetLanguage: LanguageConfig;
  level: CefrLevel;
  recentTopics: string[];
}): string {
  const avoid = input.recentTopics.length ? input.recentTopics.join("; ") : "none";
  const common = `Create a self-contained 7–10 minute ${input.type} audio lesson for a ${input.level} learner of ${input.targetLanguage.label}. Their teaching language is ${input.nativeLanguage.label}. Use ${LESSON_SEGMENT_MIN} to ${LESSON_SEGMENT_MAX} segments. Choose a useful everyday topic automatically. Avoid these recent topics: ${avoid}. Use concise, natural language. Every segment must have a stable id, kind, speaker, delivery, language, and text. delivery is one of warm, praise, gentle, curious, clear, playful: warm for ordinary teaching, praise for delighted encouragement, gentle for a kind correction, curious for a real question, clear for a new word or a drill that should be slower, and playful for light dialogue. Use BCP-47 language ids exactly: teaching=${input.nativeLanguage.id}, target=${input.targetLanguage.id}. The opening is ordinary teacher narration in ${input.nativeLanguage.label}, a sentence or two per segment, not one long mixed paragraph. Whenever a ${input.nativeLanguage.label} line (including the teacher) contains a ${input.targetLanguage.label} word or phrase, wrap only that span as [[lang:${input.targetLanguage.id}]]phrase[[/lang]]. Whenever a ${input.targetLanguage.label} line spoken by the teacher, speakerA, or speakerB contains a ${input.nativeLanguage.label} word or phrase, wrap only that span as [[lang:${input.nativeLanguage.id}]]phrase[[/lang]]. The segment language field stays the main language of the line. Do not nest tags or wrap a whole single-language line. Do not include markdown.`;

  if (input.type === "conversation") {
    return `${common} Build a realistic conversation between speakerA and speakerB. Include at least eight target-language vocabulary items used in context, at least twelve dialogue turns, at least four listen-and-repeat drills, and short teacher narration between scenes. Target-language dialogue segments should include a ${input.nativeLanguage.label} translation${input.targetLanguage.transliteration ? " and Latin-script transliteration" : ""}. End with a short recap of two or three segments.`;
  }
  return `${common} Build a teacher-led grammar lesson. Include at least eight vocabulary or pattern items, explanations, at least six target-language examples, and at least six listen-and-repeat drills. Target-language examples should include a ${input.nativeLanguage.label} translation${input.targetLanguage.transliteration ? " and Latin-script transliteration" : ""}. End with a short recap of two or three segments.`;
}
