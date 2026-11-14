import type { CefrLevel, LanguageConfig, LessonType } from "@resolingo/shared";

export function lessonPrompt(input: {
  type: LessonType;
  nativeLanguage: LanguageConfig;
  targetLanguage: LanguageConfig;
  level: CefrLevel;
  recentTopics: string[];
}): string {
  const avoid = input.recentTopics.length ? input.recentTopics.join("; ") : "none";
  const common = `Create the source for a ${input.type} audio lesson for a ${input.level} learner of ${input.targetLanguage.label}. Their teaching language is ${input.nativeLanguage.label}. Choose a useful everyday topic automatically. Avoid these recent topics: ${avoid}. Return JSON with title, topic, summary, speakerNames, lines, phrases, and cues. lines is 4 to 6 short dialogue turns. Each line has speaker (speakerA or speakerB), text in ${input.targetLanguage.label}, translation in ${input.nativeLanguage.label}${input.targetLanguage.transliteration ? ", Latin-script transliteration" : ""}, and language ${input.targetLanguage.id}. phrases has one item for every line, in the same order: speaker, the exact text, translation, language, and note. note is one ${input.nativeLanguage.label} sentence and wraps only the target phrase as [[lang:${input.targetLanguage.id}]]phrase[[/lang]]. cues are short ${input.nativeLanguage.label} strings: welcome, listen, afterDialogue, buildup, howWouldYouSay, sayIt, yourTurn, again, closing. howWouldYouSay starts a question and does not include the answer, for example "How would you say". sayIt tells the learner to answer aloud, for example "Say it out loud". yourTurn tells them to repeat, for example "Now you say it". Use BCP-47 language ids exactly: teaching=${input.nativeLanguage.id}, target=${input.targetLanguage.id}. Return speakerNames.teacher, speakerNames.speakerA, and speakerNames.speakerB. speakerA is a culturally fitting masculine given name for a ${input.targetLanguage.label} speaker, and speakerB is a culturally fitting feminine given name. The teacher is a woman and may have a feminine given name, used in welcome. Each name is one Latin-script word of letters only, with no spaces, and all three are different. Use those exact names when a line mentions someone. Never write "Speaker A" or "Speaker B". If a ${input.targetLanguage.label} line contains a ${input.nativeLanguage.label} word, wrap only that span as [[lang:${input.nativeLanguage.id}]]word[[/lang]]. Close every language tag. Do not nest tags or wrap a whole single-language line. Do not include markdown or a segments array.`;

  if (input.type === "conversation") {
    return `${common} The lines are one realistic conversation between the male speakerA and the female speakerB, alternating speakers. The phrases are the lines a learner should be able to say.`;
  }
  return `${common} The lines are a short example exchange that shows one grammar point, and the phrases are the patterns for the listen-and-repeat drills.`;
}
