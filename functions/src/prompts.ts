import type { CefrLevel, LanguageConfig, LessonType } from "@resolingo/shared";

export function lessonPrompt(input: {
  type: LessonType;
  nativeLanguage: LanguageConfig;
  targetLanguage: LanguageConfig;
  level: CefrLevel;
  recentTopics: string[];
}): string {
  const avoid = input.recentTopics.length ? input.recentTopics.join("; ") : "none";
  const common = `Create a self-contained 3–5 minute ${input.type} audio lesson for a ${input.level} learner of ${input.targetLanguage.label}. Their teaching language is ${input.nativeLanguage.label}. Choose a useful everyday topic automatically. Avoid these recent topics: ${avoid}. Use concise, natural language. Every segment must have a stable id, kind, speaker, delivery, language, and text. kind is only narration, dialogue, explanation, example, drill, or recap. delivery is one of warm, praise, gentle, curious, clear, playful: warm for ordinary teaching, praise for delighted encouragement, gentle for a kind correction, curious for a real question, clear for a new word or a drill that should be slower, and playful for light dialogue. Use BCP-47 language ids exactly: teaching=${input.nativeLanguage.id}, target=${input.targetLanguage.id}. Return speakerNames.teacher, speakerNames.speakerA, and speakerNames.speakerB. speakerA is a culturally fitting masculine given name for a ${input.targetLanguage.label} speaker, and speakerB is a culturally fitting feminine given name. The teacher is a woman and may have a feminine given name, introduced in the opening line. Each name is one Latin-script word of letters only, with no spaces, and all three are different. Use those exact names in the dialogue text. Never write "Speaker A" or "Speaker B". The opening is ordinary teacher narration in ${input.nativeLanguage.label}, a sentence or two per segment, not one long mixed paragraph. Whenever a ${input.nativeLanguage.label} line (including the teacher) contains a ${input.targetLanguage.label} word or phrase, wrap only that span as [[lang:${input.targetLanguage.id}]]phrase[[/lang]]. Whenever a ${input.targetLanguage.label} line spoken by the teacher, speakerA, or speakerB contains a ${input.nativeLanguage.label} word or phrase, wrap only that span as [[lang:${input.nativeLanguage.id}]]phrase[[/lang]]. Close every tag. The segment language field stays the main language of the line. Do not nest tags or wrap a whole single-language line. Do not include markdown.`;

  if (input.type === "conversation") {
    return `${common} Build a realistic conversation between the male speakerA and the female speakerB. Write each exchange as consecutive dialogue segments, and put teacher narration before and after a scene rather than inside it. Target-language dialogue segments should include a ${input.nativeLanguage.label} translation${input.targetLanguage.transliteration ? " and Latin-script transliteration" : ""}. End with a short teacher recap.`;
  }
  return `${common} Build a teacher-led grammar lesson with explanation, target-language examples, short listen-and-repeat drills, and a recap. Target-language examples should include a ${input.nativeLanguage.label} translation${input.targetLanguage.transliteration ? " and Latin-script transliteration" : ""}.`;
}
