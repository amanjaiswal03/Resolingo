import { describe, expect, it } from "vitest";
import { checkedSpeakingBonusMs, speakingPauseMs } from "./speaking-timing.js";

describe("speaking pause timing", () => {
  it("gives longer German answers progressively more time", () => {
    const word = speakingPauseMs("Bahnhof", "de-DE");
    const longWord = speakingPauseMs("Entschuldigung", "de-DE");
    const phrase = speakingPauseMs("der Hauptbahnhof", "de-DE");
    const sentence = speakingPauseMs("Können Sie mir den Weg zum Hauptbahnhof zeigen?", "de-DE");
    const sentences = speakingPauseMs("Entschuldigung. Können Sie mir den Weg zum Hauptbahnhof zeigen?", "de-DE");
    expect(word).toBeGreaterThanOrEqual(3_500);
    expect(longWord).toBeGreaterThan(word);
    expect(phrase).toBeGreaterThan(longWord);
    expect(sentence).toBeGreaterThan(phrase);
    expect(sentences).toBeGreaterThan(sentence);
    expect(speakingPauseMs("Hallo. Wie geht es Ihnen? ".repeat(25), "de-DE")).toBeLessThanOrEqual(14_000);
    expect(checkedSpeakingBonusMs(word)).toBeGreaterThan(0);
    expect(checkedSpeakingBonusMs(phrase)).toBeGreaterThan(checkedSpeakingBonusMs(word));
    expect(checkedSpeakingBonusMs(sentence)).toBeGreaterThan(checkedSpeakingBonusMs(phrase));
  });

  it("estimates Japanese speech without relying on spaces", () => {
    expect(speakingPauseMs("すみません、京都駅までの行き方を教えていただけますか？", "ja-JP"))
      .toBeGreaterThan(speakingPauseMs("はい。", "ja-JP"));
  });
});
