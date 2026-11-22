import { describe, expect, it } from "vitest";
import { speechSpans } from "./markup.js";
import { shapePhraseLesson, type PhraseLessonContext } from "./phrase.js";

function expectLesson(result: ReturnType<typeof shapePhraseLesson>) {
  if (!result.ok) throw new Error(`${result.reason}${result.detail ? `: ${result.detail}` : ""}`);
  return result.lesson;
}

describe("phrase lessons in other scripts", () => {
  it("shapes a Japanese lesson whose sentences have no space", () => {
    const context: PhraseLessonContext = {
      phraseId: "phrase_ja_station",
      nativeLanguage: "en-US",
      targetLanguage: "ja-JP",
      level: "A2",
      nativeText: "Where is the station? What time is the next train?",
      translation: "駅はどこですか。次の電車は何時ですか？",
      inputLanguage: "native",
    };
    const lesson = expectLesson(shapePhraseLesson({
      title: "The station",
      topic: "Where is the station",
      summary: "Ask where the station is and when the next train leaves.",
      speakerNames: { teacher: "Mira" },
      chunks: [
        { text: "どこですか", translation: "where is it" },
        { text: "駅は", translation: "the station" },
        { text: "何時ですか", translation: "what time is it" },
        { text: "電車は", translation: "the train" },
      ],
      swaps: [
        {
          from: "the station",
          to: "the toilet",
          focus: "トイレ",
          focusTranslation: "toilet",
          answer: "トイレはどこですか。次の電車は何時ですか？",
          translation: "Where is the toilet? What time is the next train?",
        },
        {
          from: "the train",
          to: "the bus",
          focus: "バス",
          focusTranslation: "bus",
          answer: "駅はどこですか。次のバスは何時ですか？",
          translation: "Where is the station? What time is the next bus?",
        },
      ],
      situations: [
        {
          setup: "You're at the airport and you need the toilet.",
          focus: "トイレ",
          focusTranslation: "toilet",
          answer: "トイレはどこですか。",
          translation: "Where is the toilet?",
        },
        {
          setup: "A friend is walking with you and you think the station is right here.",
          focus: "ここ",
          focusTranslation: "here",
          answer: "駅はここですか。",
          translation: "Is the station here?",
        },
        {
          setup: "You're on the platform and you want the next bus instead.",
          focus: "バス",
          focusTranslation: "bus",
          answer: "次のバスは何時ですか？",
          translation: "What time is the next bus?",
        },
      ],
      roleplay: {
        setup: "Someone at the airport can help.",
        answer: "トイレはどこですか。",
        translation: "Where is the toilet?",
      },
    }, context));
    const cue = lesson.segments.find((segment) => segment.text.includes("Where is the station"));
    expect(cue?.language).toBe("en-US");
    const answer = lesson.segments.find((segment) => segment.text.includes("駅はどこですか"));
    expect(answer?.language).toBe("ja-JP");
  });

  it("shapes a Korean lesson and a Mandarin lesson", () => {
    const korean = expectLesson(shapePhraseLesson({
      speakerNames: { teacher: "Mira" },
      chunks: [
        { text: "어디예요", translation: "where is it" },
        { text: "화장실이", translation: "the toilet" },
      ],
      swaps: [
        { from: "the toilet", to: "the station", focus: "역이", focusTranslation: "the station", answer: "역이 어디예요?", translation: "Where is the station?" },
        { from: "where", to: "now", focus: "지금", focusTranslation: "now", answer: "지금 화장실이 어디예요?", translation: "Where is the toilet now?" },
      ],
      situations: [
        { setup: "You're in a cafe.", focus: "역이", focusTranslation: "the station", answer: "역이 어디예요?", translation: "Where is the station?" },
        { setup: "A friend is with you and you need it now.", focus: "지금", focusTranslation: "now", answer: "지금 화장실이 어디예요?", translation: "Where is the toilet now?" },
        { setup: "You are looking for the big one.", focus: "큰", focusTranslation: "big", answer: "큰 화장실이 어디예요?", translation: "Where is the big toilet?" },
      ],
      roleplay: { setup: "Ask the person at the counter.", answer: "역이 어디예요?", translation: "Where is the station?" },
    }, {
      phraseId: "phrase_ko_toilet",
      nativeLanguage: "en-US",
      targetLanguage: "ko-KR",
      level: "A2",
      nativeText: "Where is the toilet?",
      translation: "화장실이 어디예요?",
      inputLanguage: "native",
    }));
    expect(korean.segments.some((segment) => segment.language === "ko-KR")).toBe(true);

    const mandarin = expectLesson(shapePhraseLesson({
      speakerNames: { teacher: "Mira" },
      chunks: [
        { text: "哪裡", translation: "where" },
        { text: "在哪裡", translation: "where is it" },
        { text: "火車站", translation: "the train station" },
      ],
      swaps: [
        { from: "the train station", to: "the toilet", focus: "洗手間", focusTranslation: "toilet", answer: "洗手間在哪裡？", translation: "Where is the toilet?" },
        { from: "where", to: "here", focus: "這裡", focusTranslation: "here", answer: "火車站在這裡？", translation: "Is the train station here?" },
      ],
      situations: [
        { setup: "You're outside the airport.", focus: "洗手間", focusTranslation: "toilet", answer: "洗手間在哪裡？", translation: "Where is the toilet?" },
        { setup: "A friend thinks you have arrived.", focus: "這裡", focusTranslation: "here", answer: "火車站在這裡？", translation: "Is the train station here?" },
        { setup: "You can see the building.", focus: "那裡", focusTranslation: "there", answer: "火車站在那裡？", translation: "Is the train station there?" },
      ],
      roleplay: { setup: "Ask someone outside.", answer: "洗手間在哪裡？", translation: "Where is the toilet?" },
    }, {
      phraseId: "phrase_zh_station",
      nativeLanguage: "en-US",
      targetLanguage: "zh-TW",
      level: "A2",
      nativeText: "Where is the train station?",
      translation: "火車站在哪裡？",
      inputLanguage: "native",
    }));
    expect(mandarin.segments.some((segment) => segment.language === "zh-TW")).toBe(true);
  });

  it("shapes Spanish and French lessons, including an inverted question mark", () => {
    const spanish = expectLesson(shapePhraseLesson({
      speakerNames: { teacher: "Mira" },
      chunks: [
        { text: "la estación", translation: "the station" },
        { text: "está la estación", translation: "is the station" },
        { text: "Dónde está", translation: "where is" },
      ],
      swaps: [
        { from: "the station", to: "the hotel", focus: "el hotel", focusTranslation: "the hotel", answer: "¿Dónde está el hotel?", translation: "Where is the hotel?" },
        { from: "where", to: "here", focus: "aquí", focusTranslation: "here", answer: "¿Está aquí la estación?", translation: "Is the station here?" },
      ],
      situations: [
        { setup: "You're outside the airport.", focus: "el hotel", focusTranslation: "the hotel", answer: "¿Dónde está el hotel?", translation: "Where is the hotel?" },
        { setup: "A friend is walking with you.", focus: "aquí", focusTranslation: "here", answer: "¿Está aquí la estación?", translation: "Is the station here?" },
        { setup: "You can see a sign.", focus: "allí", focusTranslation: "there", answer: "¿Está allí la estación?", translation: "Is the station there?" },
      ],
      roleplay: { setup: "Ask someone outside.", answer: "¿Dónde está el hotel?", translation: "Where is the hotel?" },
    }, {
      phraseId: "phrase_es_station",
      nativeLanguage: "en-US",
      targetLanguage: "es-ES",
      level: "A2",
      nativeText: "Where is the station?",
      translation: "¿Dónde está la estación?",
      inputLanguage: "native",
    }));
    expect(spanish.segments.some((segment) => segment.text.includes("¿Dónde está"))).toBe(true);

    const french = expectLesson(shapePhraseLesson({
      speakerNames: { teacher: "Mira" },
      chunks: [
        { text: "la gare", translation: "the station" },
        { text: "est la gare", translation: "is the station" },
        { text: "Où est", translation: "where is" },
      ],
      swaps: [
        { from: "the station", to: "the hotel", focus: "l'hôtel", focusTranslation: "the hotel", answer: "Où est l'hôtel ?", translation: "Where is the hotel?" },
        { from: "where", to: "here", focus: "ici", focusTranslation: "here", answer: "La gare est ici ?", translation: "Is the station here?" },
      ],
      situations: [
        { setup: "You're looking for the main station.", focus: "grande", focusTranslation: "main", answer: "Où est la grande gare ?", translation: "Where is the main station?" },
        { setup: "A friend is walking with you.", focus: "ici", focusTranslation: "here", answer: "La gare est ici ?", translation: "Is the station here?" },
        { setup: "You can see a sign.", focus: "là", focusTranslation: "there", answer: "La gare est là ?", translation: "Is the station there?" },
      ],
      roleplay: { setup: "Ask someone outside.", answer: "La gare est ici ?", translation: "Is the station here?" },
    }, {
      phraseId: "phrase_fr_station",
      nativeLanguage: "en-US",
      targetLanguage: "fr-FR",
      level: "A2",
      nativeText: "Where is the station?",
      translation: "Où est la gare ?",
      inputLanguage: "native",
    }));
    expect(french.segments.some((segment) => segment.language === "fr-FR")).toBe(true);
    expect(speechSpans("Say [[lang:fr-FR]]la gare[[/lang]] please.", "en-US")[1]?.language).toBe("fr-FR");
  });
});
