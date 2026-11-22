import { describe, expect, it } from "vitest";
import { applyTargetVoices, speechSpans } from "./markup.js";
import {
  disambiguateTranslation,
  grammarTopics,
  shapeGrammarLesson,
} from "./grammar.js";
import { shapePhraseLesson, type PhraseLessonContext } from "./phrase.js";
import {
  glossSubject,
  languageName,
  line,
  missingTeachingLines,
  smoothCue,
  speakPrefix,
  stopwords,
  stripSpeakPrefix,
  withArticle,
} from "./teaching.js";

describe("teaching lines", () => {
  it("has a line for every native language, with English as the fallback", () => {
    expect(missingTeachingLines()).toEqual([]);
    expect(line("en-AU", "how", { translation: "hello" })).toBe("How would you say hello?");
    expect(line("fr-CA", "how", { translation: "bonjour" })).toBe(line("fr-FR", "how", { translation: "bonjour" }));
    expect(line("es-MX", "lead1")).toBe(line("es-ES", "lead1"));
    expect(speakPrefix("en-US")).toBe("How would you say");
    expect(stripSpeakPrefix("How would you say I need shoes", "en-US")).toBe("I need shoes");
    expect(stripSpeakPrefix(`${speakPrefix("de-DE")}: Ich brauche Schuhe`, "de-DE")).toBe("Ich brauche Schuhe");
    expect(stripSpeakPrefix(`${speakPrefix("ja-JP")} 駅はどこですか`, "ja-JP")).toBe("駅はどこですか");
  });

  it("folds Turkish stops with Turkish casing", () => {
    const stops = stopwords("tr-TR");
    expect(stops?.has("için")).toBe(true);
    expect(stops?.has("İÇİN".toLocaleLowerCase("tr-TR"))).toBe(true);
    const { segments } = applyTargetVoices([
      { language: "de-DE", text: "Bahnhof" },
      { language: "tr-TR", text: "İçin Bahnhof burada." },
    ], "tr-TR", "de-DE");
    expect(speechSpans(segments[1]!.text, "tr-TR").map((span) => span.text).join("")).toContain("Bahnhof");
    expect(segments[1]!.text).not.toContain("[[lang:de-DE]]İçin");
  });

  it("names the target language in the learner's language and keeps the article on a swapped chunk", () => {
    expect(languageName("fr-FR", "es-ES")).toBe("espagnol");
    expect(languageName("de-DE", "es-ES")).toBe("Spanisch");
    expect(languageName("ja-JP", "es-ES")).toBe("スペイン語");
    expect(languageName("en-US", "de-DE")).toBe("German");
    const frenchFrom = withArticle("chaussures", "J'ai besoin d'acheter des chaussures");
    expect(frenchFrom).toBe("des chaussures");
    expect(smoothCue(line("fr-FR", "swapInstead", { from: frenchFrom, to: "une veste", translation: "une veste" }), "fr-FR")).toContain("à la place des chaussures");
    expect(smoothCue(line("fr-FR", "swapThis", { from: frenchFrom, to: "des billets", translation: "des billets" }), "fr-FR")).toContain("pas des chaussures");
    const germanFrom = withArticle("Schuhe", "Ich muss die Schuhe kaufen");
    expect(line("de-DE", "swapInstead", { from: germanFrom, to: "eine Jacke", translation: "eine Jacke" })).toContain("statt die Schuhe");
    expect(line("de-DE", "swapThis", { from: germanFrom, to: "eine Jacke", translation: "eine Jacke" })).toContain("nicht die Schuhe");
    const spanishFrom = withArticle("zapatos", "Necesito comprar unos zapatos");
    expect(line("es-ES", "swapInstead", { from: spanishFrom, to: "una chaqueta", translation: "una chaqueta" })).toContain("en vez de unos zapatos");
    expect(smoothCue(line("es-ES", "swapInstead", { from: withArticle("hotel", "¿Dónde está el hotel?"), to: "el café", translation: "el café" }), "es-ES")).toContain("en vez del hotel");
    const italianFrom = withArticle("scarpe", "Ho bisogno di comprare delle scarpe");
    expect(smoothCue(line("it-IT", "swapInstead", { from: italianFrom, to: "una giacca", translation: "una giacca" }), "it-IT")).toContain("invece delle scarpe");
    expect(smoothCue(line("it-IT", "swapThis", { from: italianFrom, to: "una giacca", translation: "una giacca" }), "it-IT")).toContain("non delle scarpe");
  });

  it("names the address from the native language, not from the English word you", () => {
    expect(disambiguateTranslation("tu es fatigué", "Du bist müde.", "de-DE", "fr-FR")).toBe("tu es fatigué, à un ami");
    expect(disambiguateTranslation("tu es fatigué, à un ami", "Du bist müde.", "de-DE", "fr-FR")).toBe("tu es fatigué, à un ami");
    expect(glossSubject("Schuhe veut dire « chaussures ».", "fr-FR")).toBe("Schuhe");
  });
});

const french: PhraseLessonContext = {
  phraseId: "phrase_fr_es",
  nativeLanguage: "fr-FR",
  targetLanguage: "es-ES",
  level: "A2",
  nativeText: "J'ai besoin d'acheter des chaussures",
  translation: "Necesito comprar unos zapatos.",
  inputLanguage: "native",
};

describe("native teaching in phrase and grammar lessons", () => {
  it("speaks a French lesson for a Spanish sentence", () => {
    const result = shapePhraseLesson({
      speakerNames: { teacher: "Mira" },
      chunks: [
        { text: "zapatos", translation: "chaussures" },
        { text: "unos zapatos", translation: "des chaussures" },
        { text: "comprar unos zapatos", translation: "acheter des chaussures" },
      ],
      swaps: [
        { from: "chaussures", to: "une veste", focus: "una chaqueta", focusTranslation: "une veste", answer: "Necesito comprar una chaqueta.", translation: "J'ai besoin d'acheter une veste" },
        { from: "chaussures", to: "des billets", focus: "unos billetes", focusTranslation: "des billets", answer: "Necesito comprar unos billetes.", translation: "J'ai besoin d'acheter des billets" },
      ],
      situations: [
        { setup: "Tu es dans un magasin. Le vendeur demande ce que tu cherches.", focus: "quiero", focusTranslation: "je voudrais", answer: "Quiero comprar unos zapatos.", translation: "Je voudrais acheter des chaussures" },
        { setup: "Un ami demande pourquoi tu sors.", focus: "todavía", focusTranslation: "encore", answer: "Todavía necesito comprar zapatos.", translation: "J'ai encore besoin d'acheter des chaussures" },
        { setup: "Tu commandes en ligne.", focus: "Necesito", focusTranslation: "j'ai besoin", words: [{ text: "nuevos", translation: "neufs" }], answer: "Necesito zapatos nuevos.", translation: "J'ai besoin de chaussures neuves" },
      ],
      roleplay: { setup: "Le vendeur attend.", answer: "Quiero comprar unos zapatos.", translation: "Je voudrais acheter des chaussures" },
    }, french);
    if (!result.ok) throw new Error(`${result.reason}${result.detail ? `: ${result.detail}` : ""}`);
    const native = result.lesson.segments.filter((segment) => segment.language === "fr-FR");
    expect(native.length).toBeGreaterThan(5);
    expect(native.some((segment) => segment.text.includes("How would you say"))).toBe(false);
    expect(result.lesson.segments[0]?.text).toContain("en espagnol");
    expect(result.lesson.segments[0]?.text).not.toContain("español");
    expect(result.lesson.segments.some((segment) => segment.text.includes("à la place des chaussures"))).toBe(true);
    expect(result.lesson.segments.some((segment) => segment.text.includes("pas des chaussures"))).toBe(true);
    expect(native.some((segment) => segment.text.includes("Comment dirais-tu"))).toBe(true);
    expect(result.lesson.segments.some((segment) => segment.language === "es-ES" && segment.text.includes("zapatos"))).toBe(true);
  });

  it("speaks German to a learner of English and Japanese to a learner of German", () => {
    const german = shapePhraseLesson({
      speakerNames: { teacher: "Mira" },
      chunks: [
        { text: "shoes", translation: "Schuhe" },
        { text: "a pair of shoes", translation: "ein Paar Schuhe" },
        { text: "buy a pair of shoes", translation: "ein Paar Schuhe kaufen" },
      ],
      swaps: [
        { from: "Schuhe", to: "eine Jacke", focus: "a jacket", focusTranslation: "eine Jacke", answer: "I need to buy a jacket.", translation: "Ich muss eine Jacke kaufen" },
        { from: "Schuhe", to: "Tickets", focus: "tickets", focusTranslation: "Tickets", answer: "I need to buy tickets.", translation: "Ich muss Tickets kaufen" },
      ],
      situations: [
        { setup: "Du bist in einem Geschäft. Der Verkäufer fragt, was du suchst.", focus: "would like", focusTranslation: "möchte", answer: "I would like to buy a pair of shoes.", translation: "Ich möchte ein Paar Schuhe kaufen" },
        { setup: "Ein Freund fragt, warum du in die Stadt gehst.", focus: "still", focusTranslation: "noch", answer: "I still need to buy shoes.", translation: "Ich muss noch Schuhe kaufen" },
        { setup: "Du bestellst online.", focus: "I need", focusTranslation: "ich brauche", words: [{ text: "new", translation: "neue" }], answer: "I need new shoes.", translation: "Ich brauche neue Schuhe" },
      ],
      roleplay: { setup: "Der Verkäufer wartet.", answer: "I would like to buy a pair of shoes.", translation: "Ich möchte ein Paar Schuhe kaufen" },
    }, {
      phraseId: "phrase_de_en",
      nativeLanguage: "de-DE",
      targetLanguage: "en-US",
      level: "A2",
      nativeText: "Ich muss ein Paar Schuhe kaufen",
      translation: "I need to buy a pair of shoes.",
      inputLanguage: "native",
    });
    if (!german.ok) throw new Error(`${german.reason}${german.detail ? `: ${german.detail}` : ""}`);
    expect(german.lesson.segments.some((segment) => segment.language === "de-DE" && segment.text.includes("Wie würdest du sagen"))).toBe(true);

    const japanese = shapePhraseLesson({
      speakerNames: { teacher: "Mira" },
      chunks: [
        { text: "Schuhe", translation: "くつ" },
        { text: "ein Paar Schuhe", translation: "靴を一足" },
        { text: "ein Paar Schuhe kaufen", translation: "靴を一足買う" },
      ],
      swaps: [
        { from: "靴", to: "上着", focus: "eine Jacke", focusTranslation: "上着", answer: "Ich muss eine Jacke kaufen.", translation: "上着を買わなきゃ" },
        { from: "靴", to: "切符", focus: "Tickets", focusTranslation: "切符", answer: "Ich muss Tickets kaufen.", translation: "切符を買わなきゃ" },
      ],
      situations: [
        { setup: "店にいます。店員が何を探しているか聞いています。", focus: "möchte", focusTranslation: "欲しい", answer: "Ich möchte ein Paar Schuhe kaufen.", translation: "靴を一足買いたい" },
        { setup: "友達が、なぜ街に行くのか聞いています。", focus: "noch", focusTranslation: "まだ", answer: "Ich muss noch Schuhe kaufen.", translation: "まだ靴を買わなきゃ" },
        { setup: "ネットで注文しています。", focus: "Ich brauche", focusTranslation: "必要", words: [{ text: "neue", translation: "新しい" }], answer: "Ich brauche neue Schuhe.", translation: "新しい靴が必要" },
      ],
      roleplay: { setup: "店員が待っています。", answer: "Ich möchte ein Paar Schuhe kaufen.", translation: "靴を一足買いたい" },
    }, {
      phraseId: "phrase_ja_de",
      nativeLanguage: "ja-JP",
      targetLanguage: "de-DE",
      level: "A2",
      nativeText: "靴を一足買わなきゃ",
      translation: "Ich muss ein Paar Schuhe kaufen.",
      inputLanguage: "native",
    });
    if (!japanese.ok) throw new Error(`${japanese.reason}${japanese.detail ? `: ${japanese.detail}` : ""}`);
    expect(japanese.lesson.segments.some((segment) => segment.language === "ja-JP" && segment.text.includes("こう言います"))).toBe(true);
    expect(japanese.lesson.segments.some((segment) => segment.text.includes("How would you say"))).toBe(false);
  });

  it("teaches sein in Japanese, and keeps the English script", () => {
    const topic = grammarTopics("de-DE", "A1")[0]!;
    const english = shapeGrammarLesson({}, { nativeLanguage: "en-US", targetLanguage: "de-DE", level: "A1", topic });
    const japanese = shapeGrammarLesson({}, { nativeLanguage: "ja-JP", targetLanguage: "de-DE", level: "A1", topic });
    expect(english?.segments[0]?.text).toContain("Today we'll learn how to use");
    expect(japanese?.segments[0]?.language).toBe("ja-JP");
    expect(japanese?.segments[0]?.text).not.toContain("Today we'll learn");
    expect(japanese?.segments.some((segment) => segment.language === "ja-JP" && segment.text.includes("疲れ"))).toBe(true);
  });
});
