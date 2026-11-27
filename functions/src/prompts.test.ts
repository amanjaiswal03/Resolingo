import { describe, expect, it } from "vitest";
import { languageById } from "@resolingo/shared";
import { lessonPrompt } from "./prompts.js";

describe("lesson prompts", () => {
  it("adapts the level, exact language IDs, and recent topics", () => {
    const prompt = lessonPrompt({
      type: "grammar",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["de-DE"],
      level: "B2",
      recentTopics: ["Ordering at a bakery"],
    });
    expect(prompt).toContain("B2 learner");
    expect(prompt).toContain("teaching=en-US, target=de-DE");
    expect(prompt).toContain("Ordering at a bakery");
    expect(prompt).toContain("One teacher");
    expect(prompt).toContain("no second speaker");
    expect(prompt).toContain("Give 8 drills");
    expect(prompt).toContain("breakdown is 2 or 3 short steps");
    expect(prompt).toContain("recombinations has 2 items");
    expect(prompt).toContain("about six minutes");
    expect(prompt).not.toContain("last conversation");
    expect(prompt).toContain("you, to a friend");
    expect(prompt).toContain("one specific difference");
    expect(prompt).toContain("One practical caveat");
    expect(prompt).toContain("[[lang:de-DE]]");
    expect(prompt).toContain("[[lang:en-US]]");
    expect(prompt).not.toContain("listen-and-repeat drills");
  });

  it("keeps conversation lessons as a two-speaker dialogue", () => {
    const prompt = lessonPrompt({
      type: "conversation",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["de-DE"],
      level: "A2",
      recentTopics: [],
    });
    expect(prompt).toContain("phrases has one entry for every line");
    expect(prompt).toContain("speak is 4 to 6");
    expect(prompt).toContain("complete, realistic conversation of 4 or 5 turns");
    expect(prompt).toContain("never ends on an open question");
    expect(prompt).toContain("at most 13 words per turn");
    expect(prompt).toContain("Every line of four or more words has chunks");
    expect(prompt).toContain("Include one recombination");
    expect(prompt).toContain("no earlier phrases yet");
    expect(prompt).not.toContain("grammarLink with line");
    expect(prompt).toContain("closing is one short, calm, matter-of-fact wrap-up");
  });

  it("keeps a planned lesson of the day to its scene, and adds the app intro to the welcome lesson", () => {
    const planned = lessonPrompt({
      type: "conversation",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["de-DE"],
      level: "A1",
      recentTopics: ["Ordering at a bakery"],
      plan: { scenario: "Ask the way to the station", conversationSkill: "get-around" },
    });
    expect(planned).toContain("already chosen: Ask the way to the station");
    expect(planned).toContain("conversationSkill is exactly get-around");
    expect(planned).not.toContain("Choose one real-life outcome");
    expect(planned).not.toContain("appIntro");
    const welcome = lessonPrompt({
      type: "conversation",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["de-DE"],
      level: "A1",
      recentTopics: [],
      plan: { scenario: "Say hello, give your name, and say where you are from", conversationSkill: "meet-people", welcome: true },
    });
    expect(welcome).toContain("very first lesson");
    expect(welcome).toContain("appIntro: three or four short English (US) sentences");
    expect(welcome).toContain("no German words");
  });

  it("builds a conversation on the last grammar point and skips what the learner knows", () => {
    const prompt = lessonPrompt({
      type: "conversation",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["de-DE"],
      level: "A2",
      recentTopics: [],
      learner: {
        known: [{ text: "Einen Kaffee, bitte.", translation: "A coffee, please." }],
        lastGrammar: { ruleId: "de-modals", title: "Modal verbs", examples: [{ text: "Ich muss arbeiten.", translation: "I have to work." }] },
      },
    });
    expect(prompt).toContain("\"Einen Kaffee, bitte.\" (A coffee, please.)");
    expect(prompt).toContain("add known: true");
    expect(prompt).toContain("At least three turns must be new");
    expect(prompt).toContain("last grammar lesson taught: Modal verbs");
    expect(prompt).toContain("\"Ich muss arbeiten.\" (I have to work.)");
    expect(prompt).toContain("grammarLink with line");
  });

  it("builds a grammar lesson from the scene of the last conversation", () => {
    const prompt = lessonPrompt({
      type: "grammar",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["de-DE"],
      level: "A2",
      recentTopics: [],
      learner: {
        known: [],
        lastConversation: { title: "Borrowing a drill", topic: "Asking a neighbour", lines: [{ text: "Kann ich deine Bohrmaschine ausleihen?", translation: "Can I borrow your drill?" }] },
      },
    });
    expect(prompt).toContain("last conversation was \"Borrowing a drill\"");
    expect(prompt).toContain("Kann ich deine Bohrmaschine ausleihen?");
    expect(prompt).toContain("Write bridge");
  });

  it("keeps a phrase lesson on the learner's sentence", () => {
    const prompt = lessonPrompt({
      type: "phrase",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["de-DE"],
      level: "A2",
      recentTopics: [],
      phrase: {
        nativeText: "I need to buy a pair of shoes",
        translation: "Ich muss ein Paar Schuhe kaufen.",
        alternatives: [{ label: "formally", text: "Ich hätte gern ein Paar Schuhe." }],
        note: "Literally, that is cats and dogs.",
      },
    });
    expect(prompt).toContain("Ich muss ein Paar Schuhe kaufen.");
    expect(prompt).toContain("not a copy");
    expect(prompt).toContain("German möchte");
    expect(prompt).toContain("question, a request, a statement, or a social line");
    expect(prompt).toContain("change the subject, the verb, or an adverb");
    expect(prompt).toContain("does not invent a clerk");
    expect(prompt).toContain("keeps the core verb or the main word");
    expect(prompt).toContain("it's too loud");
    expect(prompt).toContain("short pronouns and function words");
    expect(prompt).toContain("at most two new words");
    expect(prompt).toContain("Do not stack four new glosses");
    expect(prompt).toContain("Close on the learner's own sentence");
    const longer = lessonPrompt({
      type: "phrase",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["de-DE"],
      level: "A1",
      recentTopics: [],
      phrase: {
        nativeText: "I'm running late. I need to get there faster.",
        translation: "Ich komme zu spät. Ich muss schneller dorthin kommen.",
        alternatives: [{ label: "casually", text: "Ich bin spät dran. Ich muss schneller da sein." }],
      },
    });
    expect(longer).toContain("2 sentences");
    expect(longer).toContain("one sentence at a time");
    expect(longer).toContain("at least one sentence");
    expect(longer).toContain("still make sense together");
    expect(longer).toContain("spät dran");
    expect(longer).toContain("Two or fewer");
    expect(longer).toContain("casual alternative");
    expect(prompt).toContain("glossed on its own");
    expect(prompt).toContain("Do not turn that literal wording into an answer");
    expect(prompt).toContain("Do not review phrases from earlier lessons");
    expect(prompt).toContain("formally");
  });

  it("asks for the {learner} placeholder only when the learner has a name, and never sends the name", () => {
    const base = { nativeLanguage: languageById["en-US"], targetLanguage: languageById["de-DE"], level: "A2" as const, recentTopics: [] };
    const conversation = lessonPrompt({ ...base, type: "conversation", addressLearner: true });
    expect(conversation).toContain("once in cues.welcome and once in cues.closing");
    expect(conversation).toContain("never confuse {learner} with {name}");
    const grammar = lessonPrompt({ ...base, type: "grammar", addressLearner: true });
    expect(grammar).toContain("use it once, in closing");
    expect(lessonPrompt({ ...base, type: "conversation" })).not.toContain("{learner}");
    expect(lessonPrompt({ ...base, type: "grammar" })).not.toContain("{learner}");
  });

  it("keeps every name out of the conversation the learner repeats", () => {
    const conversation = lessonPrompt({ nativeLanguage: languageById["en-US"], targetLanguage: languageById["de-DE"], level: "A2", recentTopics: [], type: "conversation" });
    expect(conversation).toContain("no turn may contain a person's name");
    expect(conversation).not.toContain("use their exact names in the dialogue");
  });

  it("requires transliteration for configured writing systems", () => {
    const prompt = lessonPrompt({
      type: "conversation",
      nativeLanguage: languageById["en-US"],
      targetLanguage: languageById["ja-JP"],
      level: "A1",
      recentTopics: [],
    });
    expect(prompt).toContain("Latin-script transliteration");
  });
});
