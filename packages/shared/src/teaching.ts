import { languageIds, type LanguageId } from "./languages.js";
import { LOCALES } from "./teaching-locales.js";
import { grammarMeaningText } from "./teaching-meanings.js";

/**
 * Fixed teaching lines. The tables in teaching-locales.ts were written once
 * and checked in. Lessons never call a translator at runtime.
 * English is the fallback when a language has no line of its own.
 */

export const TEACHING_KEYS = [
  "how", "can", "try", "give", "turn", "loud", "nowSay", "whatFor",
  "swapInstead", "swapBare", "swapThis", "swapSame", "swapKeep",
  "quick1", "quick2", "quick3",
  "listenBuild", "naturalSentence", "oneAtATime", "firstSentence", "nextSentence", "bothTogether", "piecesFromEnd",
  "wanted", "already", "mixed", "nice", "matchYes", "matchGood",
  "clerkUse", "friendCasual", "friendUse", "cameWith",
  "wantedMeans", "toChange", "clerkPolite", "formalMeans", "anotherMeans",
  "gloss", "sameWord", "moreFormal", "formalUsage", "otherUsage", "formalSetup", "casualSetup",
  "listenPattern", "noticeVerb", "hold", "exception", "today", "noticeWhat", "stick", "thatMeans",
  "change", "makeIt", "putForm", "fill", "missing", "complete", "patternQ",
  "cueWelcome", "cueListen", "cueAfter", "cueBuildup", "cueHow", "cueSayIt", "cueYourTurn", "cueAgain", "cueClosing",
  "plainTurn", "plainGive", "imagine", "repeat", "nowTry", "howAsk", "plainLoud", "plainNow",
  "echo1", "echo2", "echo3",
  "lead1", "lead2", "lead3", "lead4",
  "remember1", "remember2", "remember3", "remember4",
  "bridge1", "bridge2", "bridge3", "bridge4",
  "return1", "return2", "return3", "return4",
  "known1", "known2", "known3", "roleIntro", "returnGrammar",
  "addrFriend", "addrAll", "addrFormal", "addrShe", "addrThey", "addrVous",
  "nowWord", "canWord",
  "clerkHint", "friendHint", "casualHint", "formalHint",
  "seinWelcome", "seinInsight", "seinSingular", "seinPluralBridge", "seinPluralQ", "seinPluralInsight", "seinPluralRule", "seinMnemonic", "seinRecap0", "seinRecap1", "seinClosing", "seinCheck0", "seinCheck1", "seinCheck2",
  "habenWelcome", "habenInsight", "habenSingular", "habenPluralBridge", "habenPluralQ", "habenPluralInsight", "habenPluralRule", "habenMnemonic", "habenRecap0", "habenRecap1", "habenClosing", "habenCheck0", "habenCheck1", "habenCheck2",
  "regularWelcome", "regularInsight", "regularSingular", "regularPluralBridge", "regularPluralQ", "regularPluralInsight", "regularPluralRule", "regularMnemonic", "regularRecap0", "regularRecap1", "regularClosing", "regularCheck0", "regularCheck1", "regularCheck2",
] as const;

export type TeachingKey = (typeof TEACHING_KEYS)[number];

const ENGLISH: Record<TeachingKey, string> = {
  how: "How would you say {translation}?",
  can: "Can you say {translation}?",
  try: "Try saying {translation}.",
  give: "Give it a try: {translation}.",
  turn: "Your turn: {translation}.",
  loud: "Say it out loud: {translation}.",
  nowSay: "Now you say it: {translation}.",
  whatFor: "What would you say for {translation}?",
  swapInstead: "Now, instead of {from}, {to}. How would you say {translation}?",
  swapBare: "Instead of {from}, {to}. How would you say {translation}?",
  swapThis: "This time it's {to}, not {from}. Can you say {translation}?",
  swapSame: "Same idea, but {to}. Try saying {translation}.",
  swapKeep: "Keep the sentence, and use {to}. Your turn: {translation}.",
  quick1: "Quick check. How would you say {translation}?",
  quick2: "One more. Can you say {translation}?",
  quick3: "And the line you came in with. Try saying {translation}.",
  listenBuild: "Listen once, then we'll build it and try it in a few places.",
  naturalSentence: "We'll practice the natural sentence, not the word-for-word version.",
  oneAtATime: "We'll learn one sentence at a time, then say both together.",
  firstSentence: "The first sentence.",
  nextSentence: "The next sentence.",
  bothTogether: "Now both sentences together.",
  piecesFromEnd: "We'll take it in pieces, starting from the end.",
  wanted: "You wanted to say \"{meaning}\". Here's how that sounds in {language}.",
  already: "You already said this in {language}. It means \"{meaning}\". We'll practice it in a few real situations.",
  mixed: "Part of that was already in {language}. The whole sentence means \"{meaning}\". Let's learn it as one line.",
  nice: "That's it.",
  matchYes: "Yes, that's right.",
  matchGood: "Good.",
  clerkUse: "With a clerk, use the line that means \"{meaning}\".",
  friendCasual: "With a friend, the casual way is \"{answer}\".",
  friendUse: "With a friend, use the line that means \"{meaning}\".",
  cameWith: "The line you came in with means \"{meaning}\".",
  wantedMeans: "The sentence you wanted is the one that means \"{meaning}\".",
  toChange: "To change {from} to {to}, you say the new sentence like this.",
  clerkPolite: "With a clerk, the polite version means \"{meaning}\", and it sounds like this.",
  formalMeans: "A more formal way to say it means \"{meaning}\", and it sounds like this.",
  anotherMeans: "Another way to say it means \"{meaning}\", and it sounds like this.",
  gloss: "{target} means \"{meaning}\".",
  sameWord: "{word} is the same word.",
  moreFormal: "a more formal way",
  formalUsage: "A more formal way to say it.",
  otherUsage: "This is the {register} way to say it.",
  formalSetup: "You want to sound a bit more formal.",
  casualSetup: "You want a more {register} way to say it.",
  listenPattern: "Listen to one real sentence. This is why the pattern matters.",
  noticeVerb: "What happens to the verb itself when the person changes?",
  hold: "Hold onto this: {text}",
  exception: "One common exception: {text}",
  today: "Today we'll learn {topic}.",
  noticeWhat: "What do you notice here?",
  stick: "Use this the next time you speak, even in one short sentence. That's how it sticks.",
  thatMeans: "That means \"{meaning}\".",
  change: "Change {from} to {to}: {source}",
  makeIt: "Now make it {to}: {source}",
  putForm: "Put this in the {to} form: {source}",
  fill: "Fill the gap. {gap}. The meaning is {meaning}.",
  missing: "What is missing? {gap}. The meaning is {meaning}.",
  complete: "Complete it. {gap}. The meaning is {meaning}.",
  patternQ: "What is the pattern?",
  cueWelcome: "Welcome. Just listen to the conversation.",
  cueListen: "Just listen.",
  cueAfter: "You just heard the conversation. Now let's go through it.",
  cueBuildup: "Let's build it up from the end.",
  cueHow: "How would you say",
  cueSayIt: "Say it out loud.",
  cueYourTurn: "Now you say it.",
  cueAgain: "Let's hear the conversation once more.",
  cueClosing: "That's the conversation.",
  plainTurn: "Your turn.",
  plainGive: "Give it a try.",
  imagine: "Imagine you want to tell {name} — what would you say?",
  repeat: "Repeat after me.",
  nowTry: "Now you try.",
  howAsk: "How would you ask for that?",
  plainLoud: "Say it out loud.",
  plainNow: "Now you say it.",
  echo1: "Try it the way you just heard it.",
  echo2: "Give that a try.",
  echo3: "See if you can say it the same way.",
  lead1: "Before we start, let's see what you remember from last time.",
  lead2: "Let's take a moment to recall something you learned earlier.",
  lead3: "We'll start by checking what stuck from last time.",
  lead4: "A moment to remember something from an earlier lesson.",
  remember1: "Do you remember how to say {translation}?",
  remember2: "Can you recall how to say {translation}?",
  remember3: "See if you remember how to say {translation}.",
  remember4: "Do you still remember how to say {translation}?",
  bridge1: "Here's one from a previous lesson. Do you remember how to say {translation}?",
  bridge2: "Let's pull in one from an earlier lesson. Do you remember how to say {translation}?",
  bridge3: "One from a previous lesson, before we continue. Do you remember how to say {translation}?",
  bridge4: "From an earlier lesson, before we go on. Do you remember how to say {translation}?",
  return1: "Now on to today's conversation.",
  return2: "Good. Now on to today's conversation.",
  return3: "Good. Let's get into today's conversation.",
  return4: "All right. On to today's conversation.",
  known1: "You already know this one from an earlier lesson.",
  known2: "You learned this line before. Just listen.",
  known3: "This one is familiar from an earlier lesson.",
  roleIntro: "Now you play {name}. I'll take the other part. Answer each line.",
  returnGrammar: "Good. Now on to today's grammar.",
  addrFriend: "{meaning}, to a friend",
  addrAll: "{meaning}, you all",
  addrFormal: "{meaning}, formally",
  addrShe: "{meaning}, she",
  addrThey: "{meaning}, they",
  addrVous: "{meaning}, formally or you all",
  nowWord: "now",
  canWord: "can",
  clerkHint: "clerk|shop",
  friendHint: "friend",
  casualHint: "casual",
  formalHint: "formal",
  seinWelcome: "Today we'll learn how to use {sein}, to be.",
  seinInsight: "{Sein} does not add a regular ending. The word itself changes: {bin} for {ich}, {bist} for {du}, and {ist} for {erSie} and {es}.",
  seinSingular: "For one person: {ichBin} when you talk to a friend, and {sieIst}. {erIst} and {esIst} use that same {ist}.",
  seinPluralBridge: "That is one person. Now more than one person, and the formal you.",
  seinPluralQ: "{SieIst} and {sieSind} look similar. What changes?",
  seinPluralInsight: "{sieIst} is she, one person. {sieSind} is they. When {Sie} is written as the formal you, you still say {SieSind}.",
  seinPluralRule: "For more than one: {wirSind} for you all, and {sieSind} for they. Speaking formally, you say {SieSind}.",
  seinMnemonic: "{binBistIst}. A different word for each person, not an ending added on.",
  seinRecap0: "Here is {sein}, to be. One person: {singular}. More than one: {plural}, and {SieSind} when you are formal.",
  seinRecap1: "Hold onto the chant: {chant}.",
  seinClosing: "That's it for today. The next time you say how you are, or how someone else is, use these out loud.",
  seinCheck0: "Which form of {sein} goes with {ich}?",
  seinCheck1: "Which form of {sein} goes with {ihr}, you all?",
  seinCheck2: "Speaking formally, which form goes with {Sie}?",
  habenWelcome: "Today we'll learn how to use {haben}, to have.",
  habenInsight: "Most forms keep {hab}, but {du} and {er} change: {duHast}. Not {habst}, and not {habt} for {er}.",
  habenSingular: "For one person: {ichHabe} when you talk to a friend, and {erHat}.",
  habenPluralBridge: "That is one person. Now more than one, and the formal you.",
  habenPluralQ: "{SieHat} and {sieHaben} are not the same person. What is the difference?",
  habenPluralInsight: "{sieHat} is she has. {sieHaben} is they have. The formal you is {SieHaben}. {ihrHabt} is you all.",
  habenPluralRule: "For more than one: {wirHaben} for you all, and {sieHaben} for they. Speaking formally, you say {SieHaben}.",
  habenMnemonic: "{habeHastHat} for one. {habenHabt} for more than one.",
  habenRecap0: "Here is {haben}, to have. One person: {singular}. More than one: {plural}, and {SieHaben} when you are formal.",
  habenRecap1: "Hold onto the chant: {chant}.",
  habenClosing: "That's it for today. The next time you say what you have, or what someone else has, use these out loud.",
  habenCheck0: "Which form of {haben} goes with {du}, a friend?",
  habenCheck1: "Which form of {haben} goes with {ihr}, you all?",
  habenCheck2: "Speaking formally, which form goes with {Sie}?",
  regularWelcome: "Today we'll learn how to use a regular verb in the present, like {machen}, to make or to do.",
  regularInsight: "The stem {mach} stays. You add an ending: {forms}. The ending changes, the stem does not.",
  regularSingular: "For one person the stem stays {mach}: {ichMache} for a friend, and {erMacht}.",
  regularPluralBridge: "That is one person. The stem stays. Now the plural endings.",
  regularPluralQ: "{ErMacht} and {ihrMacht} share an ending. What do {wir} and {sie} do?",
  regularPluralInsight: "{wirMachen} and {sieMachen} take {en}. {ihrMacht} takes {t}, not {st}. {sieMacht} is she. {sieMachen} is they. {SieMachen} is you, formally.",
  regularPluralRule: "For more than one: {wirIhr} for you all, and {sieMachen} for they. Speaking formally, you say {SieMachen}.",
  regularMnemonic: "Keep the stem {mach}. For one person, add {endings}.",
  regularRecap0: "A regular verb keeps its stem. {parade}, and {SieMachen} when you are formal.",
  regularRecap1: "Hold onto the endings: {chant}.",
  regularClosing: "That's it for today. The next time you use a regular verb, start with the stem and add the ending out loud.",
  regularCheck0: "Which ending goes with {du}, a friend?",
  regularCheck1: "Which ending goes with {ihr}, you all?",
  regularCheck2: "Speaking formally, which form of {machen} do you use?",
};

const ALIAS: Partial<Record<LanguageId, LanguageId>> = {
  "en-AU": "en-US",
  "en-GB": "en-US",
  "fr-CA": "fr-FR",
};

const ENDONYM: Record<LanguageId, string> = {
  "ar-EG": "العربية",
  "bn-IN": "বাংলা",
  "da-DK": "dansk",
  "de-DE": "Deutsch",
  "en-AU": "English",
  "en-GB": "English",
  "en-US": "English",
  "es-ES": "español",
  "es-MX": "español",
  "fil-PH": "Filipino",
  "fr-CA": "français",
  "fr-FR": "français",
  "gu-IN": "ગુજરાતી",
  "hi-IN": "हिन्दी",
  "id-ID": "Indonesia",
  "it-IT": "italiano",
  "ja-JP": "日本語",
  "kn-IN": "ಕನ್ನಡ",
  "ko-KR": "한국어",
  "ml-IN": "മലയാളം",
  "ms-MY": "Melayu",
  "nb-NO": "norsk",
  "pa-IN": "ਪੰਜਾਬੀ",
  "pl-PL": "polski",
  "pt-BR": "português",
  "pt-PT": "português",
  "ru-RU": "русский",
  "sv-SE": "svenska",
  "ta-IN": "தமிழ்",
  "tr-TR": "Türkçe",
  "vi-VN": "tiếng Việt",
  "zh-TW": "中文",
};

/** The target language's own name, used when Intl.DisplayNames is missing. */
export function languageEndonym(language: LanguageId): string {
  return ENDONYM[language];
}

/**
 * What the learner calls the target language. Node 22 resolves this with
 * Intl.DisplayNames. The language subtag is used so Spanish is "espagnol",
 * not "espagnol d'Espagne".
 */
export function languageName(native: LanguageId, target: LanguageId): string {
  const code = target.split("-")[0] || target;
  const DisplayNames = typeof Intl === "undefined" ? undefined : Intl.DisplayNames;
  if (typeof DisplayNames === "function") {
    try {
      const name = new DisplayNames([native], { type: "language" }).of(code);
      if (name && name.toLocaleLowerCase(native) !== code.toLocaleLowerCase(native)) return name;
    } catch {
      // Fall through to the endonym.
    }
  }
  return languageEndonym(target);
}

const LEADING_ARTICLE = /^(?:des|du|de la|de l['’]|les|le|la|l['’]|un|une|unos|unas|el|los|las|uno|una|dei|degli|delle|dello|della|dell['’]|il|lo|i|gli|die|der|das|den|dem|ein|eine|einer|einem|einen|a|an|the)\b/iu;

const ARTICLE = "des|du|de la|de l['’]|les|le|la|l['’]|un|une|unos|unas|el|los|las|uno|una|dei|degli|delle|dello|della|dell['’]|il|lo|i|gli|die|der|das|den|dem|ein|eine|einer|einem|einen|a|an|the";

/** The slot plus the article that sits on it in the learner's sentence. */
export function withArticle(slot: string, sentence: string): string {
  const trimmed = slot.trim();
  if (!trimmed || LEADING_ARTICLE.test(trimmed) || !sentence.trim()) return trimmed;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").exec(sentence);
  if (!found || found.index === undefined) return trimmed;
  const before = sentence.slice(0, found.index);
  const article = new RegExp(`(${ARTICLE})\\s+$`, "iu").exec(before);
  if (!article?.[1]) return trimmed;
  return `${article[1]} ${found[0]}`.replace(/\s+/gu, " ");
}

/** Join a preposition to a gloss that already has its article. */
export function smoothCue(text: string, language: LanguageId): string {
  if (language.startsWith("fr")) {
    return text
      .replace(/\bde de la\b/giu, "de la")
      .replace(/\bde de l([’'])/giu, "de l$1")
      .replace(/\bde des\b/giu, "des")
      .replace(/\bde du\b/giu, "du")
      .replace(/\bde les\b/giu, "des")
      .replace(/\bde le\b/giu, "du")
      .replace(/\bà les\b/giu, "aux")
      .replace(/\bà le\b/giu, "au");
  }
  if (language.startsWith("es")) {
    return text.replace(/\bde el\b/giu, "del").replace(/\ba el\b/giu, "al");
  }
  if (language.startsWith("it")) {
    return text
      .replace(/\bdi dell([’'])/giu, "dell$1")
      .replace(/\bdi dello\b/giu, "dello")
      .replace(/\bdi della\b/giu, "della")
      .replace(/\bdi degli\b/giu, "degli")
      .replace(/\bdi delle\b/giu, "delle")
      .replace(/\bdi dei\b/giu, "dei")
      .replace(/\bdi del\b/giu, "del")
      .replace(/\bdi il\b/giu, "del")
      .replace(/\bdi lo\b/giu, "dello")
      .replace(/\bdi la\b/giu, "della")
      .replace(/\bdi i\b/giu, "dei")
      .replace(/\bdi gli\b/giu, "degli")
      .replace(/\bdi le\b/giu, "delle")
      .replace(/\bda dell([’'])/giu, "dall$1")
      .replace(/\bda dello\b/giu, "dallo")
      .replace(/\bda della\b/giu, "dalla")
      .replace(/\bda degli\b/giu, "dagli")
      .replace(/\bda delle\b/giu, "dalle")
      .replace(/\bda dei\b/giu, "dai")
      .replace(/\bda del\b/giu, "dal")
      .replace(/\bda il\b/giu, "dal")
      .replace(/\bda lo\b/giu, "dallo")
      .replace(/\bda la\b/giu, "dalla")
      .replace(/\bda i\b/giu, "dai")
      .replace(/\bda gli\b/giu, "dagli")
      .replace(/\bda le\b/giu, "dalle");
  }
  return text;
}

export function isEnglish(language: LanguageId): boolean {
  return language === "en-US" || language === "en-GB" || language === "en-AU";
}

export function teachingLanguage(language: LanguageId): LanguageId {
  return ALIAS[language] ?? language;
}

export function template(language: LanguageId, key: TeachingKey): string {
  const id = teachingLanguage(language);
  const own = LOCALES[id]?.[key];
  if (own) return own;
  if (id === "es-MX") {
    const shared = LOCALES["es-ES"]?.[key];
    if (shared) return shared;
  }
  return ENGLISH[key];
}

export function line(language: LanguageId, key: TeachingKey, vars: Record<string, string> = {}): string {
  return template(language, key).replace(/\{([A-Za-z0-9]+)\}/g, (token, name: string) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name]! : token
  ));
}

/** Keys a non-English table still owes. English and aliases are complete by fallback. */
export function missingTeachingLines(): string[] {
  const missing: string[] = [];
  for (const id of languageIds) {
    const base = teachingLanguage(id);
    if (base === "en-US" || base !== id) continue;
    for (const key of TEACHING_KEYS) {
      const own = LOCALES[base]?.[key] ?? (base === "es-MX" ? LOCALES["es-ES"]?.[key] : undefined);
      if (!own) missing.push(`${base}:${key}`);
    }
  }
  return missing;
}

/** The spoken prefix of the "how would you say" frame, without the meaning. */
export function speakPrefix(language: LanguageId): string {
  const stem = template(language, "how").split("{translation}")[0] ?? "";
  return stem.replace(/[\s?？:：]+$/u, "").trim();
}

export function stripSpeakPrefix(text: string, language: LanguageId): string {
  const prefix = speakPrefix(language);
  if (!prefix) return text;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = /[\p{L}\p{N}]/u.test(prefix.slice(-1)) ? "(?=$|[^\\p{L}\\p{N}])" : "";
  return text.replace(new RegExp(`^\\s*${escaped}${boundary}[:\\s]*`, "iu"), "");
}

function slotLiteral(language: LanguageId, key: TeachingKey, slot: string): string | null {
  const raw = template(language, key);
  const token = `{${slot}}`;
  const at = raw.indexOf(token);
  if (at < 0) return null;
  const rest = raw.slice(at + token.length);
  const next = rest.search(/\{[A-Za-z0-9]+\}/);
  const literal = (next < 0 ? rest : rest.slice(0, next)).trim();
  return literal || null;
}

/** The words a gloss or same-word line is teaching, in display text. */
export function glossSubject(display: string, language: LanguageId): string | null {
  const same = slotLiteral(language, "sameWord", "word");
  if (same && display.includes(same)) {
    const subject = display.slice(0, display.indexOf(same)).trim();
    if (subject) return subject;
  }
  const cue = slotLiteral(language, "gloss", "target");
  if (!cue || !display.includes(cue)) return null;
  const subject = display.slice(0, display.indexOf(cue)).trim();
  return subject || null;
}

export function isGlossLine(display: string, language: LanguageId): boolean {
  return glossSubject(display, language) !== null;
}

export function mentionsAddress(meaning: string, language: LanguageId): boolean {
  const markers = (["addrFriend", "addrAll", "addrFormal", "addrShe", "addrThey", "addrVous"] as const)
    .map((key) => line(language, key, { meaning: "\u0000" }).replace("\u0000", "").trim())
    .filter((marker) => marker.length >= 2);
  const haystack = meaning.toLocaleLowerCase(language);
  return markers.some((marker) => haystack.includes(marker.toLocaleLowerCase(language)));
}

export function markAddress(meaning: string, kind: "friend" | "all" | "formal" | "she" | "they" | "vous", language: LanguageId): string {
  const key = kind === "friend" ? "addrFriend"
    : kind === "all" ? "addrAll"
      : kind === "formal" ? "addrFormal"
        : kind === "she" ? "addrShe"
          : kind === "they" ? "addrThey"
            : "addrVous";
  return line(language, key, { meaning: meaning.replace(/[.!?？。]+$/u, "").trim() });
}

export function grammarMeaning(language: LanguageId, english: string): string {
  if (isEnglish(language)) return english;
  const trimmed = english.trim();
  const key = trimmed.replace(/[.!?？。]+$/u, "").toLocaleLowerCase("en-US");
  const base = teachingLanguage(language);
  const text = grammarMeaningText(base, key) ?? (base === "es-MX" ? grammarMeaningText("es-ES", key) : undefined);
  if (!text) return english;
  const period = /[.!?？。]$/u.test(trimmed);
  if (period && !/[.!?？。]$/u.test(text)) return `${text}.`;
  return text;
}

export function situationFlags(setup: string, language: LanguageId): { clerk: boolean; friend: boolean; casual: boolean } {
  const hints = (key: TeachingKey) => template(language, key).split("|").map((item) => item.trim()).filter((item) => item.length >= 2);
  const has = (words: string[]) => words.some((word) => new RegExp(`(?:^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}])`, "iu").test(setup));
  return {
    clerk: has(hints("clerkHint")),
    friend: has(hints("friendHint")),
    casual: has(hints("casualHint")),
  };
}

const STOP_RAW: Partial<Record<LanguageId, string>> = {
  "en-US": "a an the to of in on is it be we he me my or and now can you how say for with from at as by if so am do no not but this that they she her him was are will wasn has have had its our your what when where who why all one two new old",
  "de-DE": "der die das den dem des ein eine einer einem einen und oder aber auch nicht kein keine mit von zu zum zur auf für im in an ist sind bin bist hat habe haben wir ihr sie du ich er es man so wie was wer wo wenn denn doch nur noch schon sehr hier da",
  "fr-FR": "le la les un une des de du au aux et ou mais ne pas plus avec pour dans sur par est sont suis es est nous vous ils elles je tu il elle ce cette mon ma mes ton ta tes son sa ses que qui où quoi comment pourquoi quand aussi très bien",
  "es-ES": "el la los las un una unos unas de del al y o pero no sí con por para en es son soy eres somos está están que qué cómo quién donde donde cuándo también muy más menos ya un",
  "it-IT": "il lo la i gli le un uno una di del della e o ma non con per in su è sono sei siamo che chi come dove quando anche più molto già questo questa",
  "pt-BR": "o a os as um uma uns umas de do da dos das e ou mas não com por para em é são sou és somos que quem como onde quando também muito mais já",
  "pt-PT": "o a os as um uma uns umas de do da dos das e ou mas não com por para em é são sou és somos que quem como onde quando também muito mais já",
  "pl-PL": "i oraz ale nie z ze do na w we o od jest są jestem jesteś co kto jak gdzie kiedy też już bardzo ten ta to",
  "sv-SE": "en ett och eller men inte med av för på i är är som det den det jag du han hon vi ni de vad vem var när också redan",
  "da-DK": "en et og eller men ikke med af for på i er som det den jeg du han hun vi i de hvad hvem hvor hvornår også allerede",
  "nb-NO": "en et og eller men ikke med av for på i er som det den jeg du han hun vi dere de hva hvem hvor når også allerede",
  "ru-RU": "и или но не с со к ко в во на о об от для это эта этот я ты он она мы вы они что кто как где когда тоже уже очень",
  "tr-TR": "ve veya ama değil ile için de da bir bu şu o ne nasıl nerede kim neden mi mı mu mü ben sen biz siz onlar var yok çok daha en",
  "vi-VN": "và hoặc nhưng không với của cho trong trên là một cái này đó tôi bạn anh chị chúng tôi các bạn họ gì ai sao ở khi cũng đã rất",
  "id-ID": "dan atau tapi tidak dengan dari untuk di ke adalah ini itu saya kamu kita mereka apa siapa bagaimana dimana kapan juga sudah sangat yang",
  "ms-MY": "dan atau tetapi tidak dengan dari untuk di ke ialah ini itu saya kamu kita mereka apa siapa bagaimana di mana bila juga sudah sangat yang",
  "fil-PH": "at o pero hindi sa ng para ay ito iyan ako ikaw tayo sila ano sino paano saan kailan din na napaka ang mga",
  "ar-EG": "و أو لكن لا مع من في على إلى هو هي نحن أنت أنتم هم هذا هذه ما كيف أين متى أيضا جدا",
  "hi-IN": "और या लेकिन नहीं के का की में पर है हैं हूँ हो मैं तुम आप वह यह क्या कौन कैसे कहाँ कब भी बहुत",
  "bn-IN": "এবং বা কিন্তু না সঙ্গে এর মধ্যে উপর আছে আমি তুমি আপনি সে এই কি কে কীভাবে কোথায় কখনও খুব",
  "gu-IN": "અને અથવા પણ નહીં સાથે નું માં પર છે છું છો હું તમે આપણે તે આ શું કોણ કેવી ક્યાં ક્યારે પણ ખૂબ",
  "kn-IN": "ಮತ್ತು ಅಥವಾ ಆದರೆ ಅಲ್ಲ ಜೊತೆ ಇಂದ ಇಲ್ಲಿ ಮೇಲೆ ಇದೆ ನಾನು ನೀವು ಅವರು ಇದು ಏನು ಯಾರು ಹೇಗೆ ಎಲ್ಲಿ ಯಾವಾಗ ಸಹ ತುಂಬಾ",
  "ml-IN": "ഒപ്പം അല്ലെങ്കിൽ പക്ഷേ അല്ല കൂടെ ന്റെ ഇൽ ആണ് ഞാൻ നീ നിങ്ങൾ അവൻ അവൾ ഇത് എന്ത് ആര് എങ്ങനെ എവിടെ എപ്പോൾ വളരെ",
  "pa-IN": "ਅਤੇ ਜਾਂ ਪਰ ਨਹੀਂ ਨਾਲ ਦਾ ਵਿੱਚ ਤੇ ਹੈ ਹਾਂ ਮੈਂ ਤੁਸੀਂ ਉਹ ਇਹ ਕੀ ਕੌਣ ਕਿਵੇਂ ਕਿੱਥੇ ਕਦੋਂ ਵੀ ਬਹੁਤ",
  "ta-IN": "மற்றும் அல்லது ஆனால் இல்லை உடன் இன் இல் மேல் உள்ளது நான் நீங்கள் அவன் அவள் இது என்ன யார் எப்படி எங்கே எப்போது மிகவும்",
  "ja-JP": "の に は を が と で も へ から まで より や か ね よ です ます だ である この その あの これ それ あれ 私 あなた 彼 彼女 何 誰 どう どこ いつ",
  "ko-KR": "은 는 이 가 을 를 의 에 에서 와 과 도 만 으로 하고 그리고 하지만 아니다 이다 이것 그것 나 너 우리 그 그녀 무엇 누구 어떻게 어디 언제",
  "zh-TW": "的 了 是 在 我 你 他 她 我們 他們 這 那 個 和 與 或 但 不 也 很 就 都 嗎 呢 吧 什麼 誰 怎麼 哪裡 什麼時候",
};

const stopCache = new Map<LanguageId, ReadonlySet<string> | null>();

/** Function words of the teaching language. Null means there is no stoplist. */
export function stopwords(language: LanguageId): ReadonlySet<string> | null {
  const id = teachingLanguage(language);
  const cached = stopCache.get(id);
  if (cached !== undefined) return cached;
  const raw = STOP_RAW[id] ?? (id === "es-MX" ? STOP_RAW["es-ES"] : undefined);
  if (!raw) {
    stopCache.set(id, null);
    return null;
  }
  const folded = new Set(raw.split(/\s+/u).filter(Boolean).map((word) => word.normalize("NFC").toLocaleLowerCase(id)));
  stopCache.set(id, folded);
  return folded;
}
