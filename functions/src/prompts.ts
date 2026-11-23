import type { CefrLevel, GrammarTopic, LanguageConfig, LearnerContext, LessonType } from "@resolingo/shared";
import { conversationPacing, conversationSkills, grammarPacing, segmentWords, splitSentences } from "@resolingo/shared";

export function lessonPrompt(input: {
  type: LessonType;
  nativeLanguage: LanguageConfig;
  targetLanguage: LanguageConfig;
  level: CefrLevel;
  recentTopics: string[];
  topic?: GrammarTopic;
  /** What the learner already knows and studied last. Only conversation and grammar lessons use it. */
  learner?: LearnerContext;
  phrase?: {
    nativeText: string;
    translation: string;
    transliteration?: string;
    alternatives: { label: string; text: string }[];
    note?: string;
  };
}): string {
  if (input.type === "phrase") {
    const phrase = input.phrase;
    const alternatives = phrase?.alternatives.length
      ? phrase.alternatives.map((item) => `${item.label}: ${item.text}`).join("; ")
      : "none";
    const targetSentences = splitSentences(phrase?.translation ?? "");
    const targetWords = segmentWords(phrase?.translation ?? "", input.targetLanguage.id).length;
    const depth = targetSentences.length > 1
      ? `The target is ${targetSentences.length} sentences: ${targetSentences.map((part, index) => `${index + 1}) ${part}`).join(" ")}. chunks lists short pieces of each sentence, from the end of that sentence backward. Each chunk is at most three words, with the translation of that piece alone. Cover every word of every sentence. The lesson teaches one sentence at a time, first sentence 1, then sentence 2, then both together. A swap or situation may change one sentence and keep the other. It stays on pattern when it reuses the verb or main word of at least one sentence.`
      : targetWords > 8
        ? "This is one long sentence. chunks is up to 6 pieces from the end backward, each at most three words, covering every word. Do not put the whole sentence in one chunk."
        : input.level === "A1" || input.level === "A2"
          ? "chunks is 3 meaningful pieces of the sentence, from the end toward the whole line, each with text and the translation of that piece alone."
          : "chunks is an empty array. Do not break the sentence into pieces.";
    return `Create variations for one short phrase lesson. One teacher will speak it. Do not write a dialogue. Do not review phrases from earlier lessons. The sentence may be a question, a request, a statement, or a social line. The learner wants to say "${phrase?.nativeText ?? ""}". The target sentence is exactly "${phrase?.translation ?? ""}". Do not replace that sentence. ${phrase?.note ? `An idiom note is already chosen: ${phrase.note}. Do not turn that literal wording into an answer.` : "If this is an idiom, do not invent a literal answer."} Other wordings already offered: ${alternatives}. Put a register alternative into a situation instead of repeating the core sentence. Level ${input.level}. ${depth} pattern is at most one short ${input.nativeLanguage.label} sentence, and only when the phrase has one notable structure, such as a verb moving to the end or a question word coming first. Otherwise omit pattern. swaps is 2 items. Each swap changes one slot. Prefer the object when the sentence has one, such as shoes to a jacket. When it does not, change the subject, the verb, or an adverb and keep the rest. Each has from, to, focus, focusTranslation, answer, and translation. focus is only the new target words, at most three, for example eine Jacke with focusTranslation a jacket, or Kann er with focusTranslation can he. The answer is a new target sentence, not a copy of "${phrase?.translation ?? ""}". Do not use a blunt will as the line for a shop. If will appears, add usage saying it is direct and fine with friends. situations is ${input.level === "A1" ? "2" : "3"} items. Each situation is a different place or person, and each answer is a different sentence that keeps the core verb or the main word from the target, none of them the core sentence. Change one slot only, such as the place, a time word, or an adverb, and the whole phrase must still make sense together. Do not combine claims that contradict each other, such as coming later and also needing to get there faster. For "Can you hear me clearly?", a video call can be "Can you hear me now?", a receptionist uses the polite form, and a noisy room uses "Can you hear me?". Do not switch to a different idea such as "it's too loud" or "the connection is bad". Use a shop and a clerk only when the phrase is about buying or asking for something in a shop. A shop uses the polite form (German möchte, or that language's would like) and usage is one line that möchte is the polite would like. A question, a greeting, or another line uses situations that fit that sentence, such as a phone call, a street, or a friend, and does not invent a clerk. A friend can be more direct. Each situation has setup, focus, focusTranslation, answer, translation, words, and usage when that wording needs the one-line note. words lists every word in that answer that is not already in the original sentence and is not the focus, including short pronouns and function words such as es, du, er, and zu, each with text and translation. Gloss at most two new words or short phrases before each time the learner speaks. Two or fewer is the rule to follow. A long phrase has many new words: give each new word its own short gloss of at most three words, on its own earlier cue, and change only one small slot in a swap or situation. Do not put three new glosses in front of one cue. Do not stack four new glosses in front of one cue. Gloss a new phrase as a whole, with its real meaning. For the casual line "Ich bin spät dran. Ich muss schneller da sein.", "spät dran" means "running late" and "da sein" means "be there", each on its own cue. Do not gloss "dran" as "running". A new word has to be glossed on its own before the learner says it. Translating the whole sentence does not teach it. A short phrase of two or three words is fine. If the word is the same in both languages, the translation is that same word. Name who the learner is talking to in the setup. roleplay reuses one situation answer that was already taught. It has setup, answer, and translation, and the answer is not the core sentence. The core sentence appears at most five times. Close on the learner's own sentence, the full line they came in with. Every teacher line, cue, note, gloss, recap, and closing is in ${input.nativeLanguage.label}. Every target-language word inside a teaching-language line, including a gloss, a pattern note, a swap, a recap, and the closing, is wrapped as [[lang:TARGET]]...[[/lang]]. If you mention a friend, point to the casual alternative when there is one, not to a different situation. Keep names and places unchanged. Return JSON with title, topic, summary, speakerNames, pattern, chunks, swaps, situations, and roleplay. speakerNames.teacher is one feminine Latin-script given name. Do not include a segments array or markdown.`;
  }
  const avoid = input.recentTopics.length ? input.recentTopics.join("; ") : "none";
  const learner = input.learner;
  const quote = (line: { text: string; translation?: string }) => line.translation ? `"${line.text}" (${line.translation})` : `"${line.text}"`;
  const knownList = learner?.known.length ? learner.known.map(quote).join("; ") : "";
  if (input.type === "conversation") {
    const { nativeLanguage, targetLanguage, level } = input;
    const pacing = conversationPacing[level];
    const goals = Object.entries(conversationSkills).map(([id, goal]) => `${id} (${goal})`).join(", ");
    const scope: Record<CefrLevel, string> = {
      A1: "Use one predictable, concrete exchange, like asking for something or responding to a greeting. Use familiar, high-frequency words and short ready-to-use phrases. Keep every turn to one short thought. Give context in the teaching language and avoid unfamiliar idioms.",
      A2: "Use one routine task with a short follow-up. Use familiar vocabulary and simple requests or replies, with one practical step beyond the basic exchange.",
      B1: "Use a familiar situation with one small complication. Let the learner clarify something, explain a simple reason, or decide what to do. Use connected speech with clear wording.",
      B2: "Use a realistic exchange that calls for one kind of nuance, such as making a tactful request or weighing an option. Practice that move in a different situation.",
      C1: "Use a nuanced exchange with one precise goal, such as softening disagreement, drawing out an implication, or shifting register strategically. Teach a small number of useful ways to do that well.",
    };
    const grammar = learner?.lastGrammar;
    return [
      `Create a screen-free audio lesson of about six minutes for a ${level} learner of ${targetLanguage.label}. Their teaching language is ${nativeLanguage.label}. ${scope[level]}`,
      `Choose one real-life outcome for the learner. Avoid recent topics: ${avoid}. Return title, topic, summary, speakerNames, conversationSkill, lines, phrases, cues, and optionally grammarLink, usageTip, and recombinations. Pick one exact conversationSkill ID: ${goals}.`,
      `lines is one complete, realistic conversation of ${pacing.minTurns + 1} or ${pacing.turns} turns, alternating speakerA (male) and speakerB (female). It opens naturally, reaches the goal, and closes, for example with thanks, an agreement, or a goodbye. It never ends on an open question. Each turn has speaker, text, translation, and language ${targetLanguage.id}${targetLanguage.transliteration ? ", plus Latin-script transliteration" : ""}. Use at most ${pacing.wordsPerTurn} words per turn, and keep every turn at ${level}: a sentence the learner could say themselves.`,
      knownList
        ? `The learner already knows these phrases from earlier lessons: ${knownList}. Reuse a word or two from them where it fits, but build the conversation mostly from new lines. When a line is the same as one of them, or differs by one small word at most, copy it exactly and add known: true to that line. Never mark a new line as known. At least three turns must be new. The dialogue never mentions earlier lessons, and never brings back people, places, or events from them.`
        : "The learner has no earlier phrases yet, so every turn is new.",
      grammar
        ? `The learner's last grammar lesson taught: ${grammar.title}${grammar.examples.length ? `, with examples ${grammar.examples.map(quote).join("; ")}` : ""}. Use that pattern naturally in at least one turn, at this level, without forcing it. Return grammarLink with line, the exact text of that turn, and note, one or two short ${nativeLanguage.label} sentences that point out the pattern in it. The note quotes only words that are in that turn. If no turn really uses the pattern, leave out grammarLink rather than describe a pattern that is not there.`
        : "",
      `phrases has one entry for every line, in dialogue order, because the learner practises every turn. Each entry repeats that line's exact speaker and text, with translation, language, and a short teaching note on meaning or use. Every line of four or more words has chunks: one or two pieces from the end of the line, growing toward the whole line, such as the last word and then the last few words. Each piece has text and its own translation. Add gloss, one short ${nativeLanguage.label} sentence saying what a piece means, only for a word the learner has not met before.`,
      `Optionally include usageTip, one short ${nativeLanguage.label} sentence connecting the wording to real life. A reliable point about politeness, context, or local usage is enough. It should use what the learner has just heard, without new vocabulary or broad claims about a culture. Skip it if it would distract from the goal.`,
      "Include a recallCue for the most useful lines. Set up a short everyday situation in which the learner needs the line and include its exact teaching-language meaning. The learner has to be able to answer without looking at a screen.",
      "Include one recombination with text, translation, and speaker. Change one detail of a turn, such as the object, place, or time, and reuse the rest. It should help the same practical goal.",
      `Write cues in ${nativeLanguage.label}. welcome sets the practical goal and gives one detail to listen for without giving away the words. afterDialogue gives the gist in one short sentence and says you will learn every line. listen, buildup, and again guide listening. closing is one short, calm, matter-of-fact wrap-up that says where the learner can use the phrases. No hype. speak is 4 to 6 short prompts for recall, with {translation} for the meaning and optional {name} for the other speaker. The notes and listening lines never tell the learner to speak.`,
      `speakerNames contains teacher, speakerA, and speakerB, all distinct one-word names. Use natural names for these speakers and use their exact names in the dialogue. Wrap target words inside teaching lines as [[lang:${targetLanguage.id}]]word[[/lang]], and wrap teaching-language words within target lines as [[lang:${nativeLanguage.id}]]word[[/lang]]. Close each tag without nesting. Use BCP-47 language ids exactly: teaching=${nativeLanguage.id}, target=${targetLanguage.id}. Return JSON only, with no segments array.`,
    ].filter(Boolean).join(" ");
  }
  const { level, nativeLanguage, targetLanguage, topic } = input;
  const pacing = grammarPacing[level];
  const scope: Record<CefrLevel, string> = {
    A1: "Use familiar words and short everyday sentences. Teach one small contrast, such as two or three useful forms. Skip terminology and exceptions unless needed to say the examples.",
    A2: "Use a familiar situation and one useful distinction. Keep the vocabulary predictable so the learner can concentrate on the pattern.",
    B1: "Show how the same pattern helps someone express one idea in a familiar situation. Include a short application with a change of person, time, or detail when relevant.",
    B2: "Teach one choice a speaker makes for meaning, clarity, or tone. Contrast examples closely. One practical caveat is enough if it helps the learner choose correctly.",
    C1: "Focus on one precise distinction in meaning, register, or emphasis. Use natural but compact examples and one application that tests the choice in context.",
  };
  const scene = learner?.lastConversation;
  return [
    `Create a screen-free grammar lesson of about six minutes for a ${level} learner of ${targetLanguage.label}. One teacher speaks in ${nativeLanguage.label}, with no second speaker and no dialogue. ${scope[level]}`,
    `Teach exactly this point: ${topic?.title ?? "one pattern appropriate to the level"}. Focus: ${topic?.focus ?? "one rule the learner can use today"}. ${topic?.forms ? `Keep to these forms: ${topic.forms}.` : ""} ${topic?.pitfall ? `Head off this mistake if it directly affects the examples: ${topic.pitfall}.` : ""} The learner can build on: ${topic?.prerequisites.join("; ") || "none yet"}. Recent topics: ${avoid}.`,
    scene
      ? `The learner's last conversation was "${scene.title}" (${scene.topic}), with these lines: ${scene.lines.map(quote).join("; ")}. Reuse that scene's vocabulary where today's pattern fits naturally, but every example and drill must be a correct use of today's point, and none of them may claim to be a line from that conversation unless it is copied exactly. Write bridge, one short ${nativeLanguage.label} sentence that quotes one line from that conversation word for word and connects it to today's point. If no line fits, connect the scene instead without quoting. Never invent what was said in that conversation.`
      : "",
    knownList ? `Words the learner already knows from earlier lessons, to reuse so the focus stays on the pattern: ${knownList}.` : "",
    `Return JSON with title, topic, summary, goal, speakerNames, hook, examples, noticeCue, notice, rule, breakdown, drills, recombinations, checks, closing, targetTerms, and optionally bridge and usageTip. topic must be "${topic?.title ?? ""}". goal names in one sentence what the learner will be able to say. hook is one useful real-life sentence that uses the pattern. The hook and ${pacing.examples - 1} contrasting examples each have text and translation. Use short, closely matched sentences, with at most ${pacing.words} target words per sentence. Keep the scenario and vocabulary stable as the form changes.`,
    "noticeCue asks the listener to hear one specific difference in those examples. notice gives the answer in one short sentence. rule tells the listener when and how to use that one pattern in one or two short sentences. Skip lists of extra forms and a second rule. Use spoken language that works with the screen off.",
    `breakdown is ${pacing.breakdown - 1} or ${pacing.breakdown} short steps through the pattern, such as one form per person, or where each word goes. Each step has explanation, one short ${nativeLanguage.label} sentence, and example with text and translation, a new short sentence that shows just that step.`,
    `Give ${pacing.drills} drills with cue, answer, translation, and kind (word, phrase, or sentence). Start with the modeled lines, then go from guided to free: a fill-the-gap with ___, a transformation, then complete sentences from the meaning alone, including at least three new sentences that were not examples. If a cue asks for a transformation, include the exact source sentence in both source and cue. Every production cue includes the intended meaning or a complete source sentence. When needed, specify you, to a friend; you all; or you, formally, and distinguish she from they. Vary the wording, and keep each prompt clear without a screen.`,
    `recombinations has ${pacing.recombinations} items with cue, answer, and translation. Each is a real situation where the learner uses the same rule with known vocabulary, and its answer is a new sentence. checks has ${pacing.checks} items with cue and answer, short questions about when or why the rule applies. closing names one real situation where the learner can use the pattern.`,
    "Optionally add a single short usageTip about how the pattern sounds or where you hear it, or a mnemonic. Skip trivia, unsupported generalizations, and new target vocabulary in this note.",
    `Return speakerNames.teacher as a one-word given name. Wrap every ${targetLanguage.label} word, source sentence, pronoun, stem, and ending spoken inside a teaching line in [[lang:${targetLanguage.id}]]...[[/lang]]. Include the written hyphen of an affix within the tag. If a target example quotes a teaching-language word, tag only that word as [[lang:${nativeLanguage.id}]]...[[/lang]]. Close each tag without nesting. targetTerms lists the target terms exactly. Use BCP-47 language ids exactly: teaching=${nativeLanguage.id}, target=${targetLanguage.id}. Return JSON only, with no segments array.`,
  ].filter(Boolean).join(" ");
}
