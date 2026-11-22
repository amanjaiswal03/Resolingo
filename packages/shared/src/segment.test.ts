import { describe, expect, it } from "vitest";
import { groupBunsetsu, segmenterAvailable, segmentWords, splitSentences } from "./segment.js";

describe("sentence breaks", () => {
  it("splits Japanese and fullwidth stops with or without a space", () => {
    expect(splitSentences("駅はどこですか。次の電車は何時ですか？")).toEqual([
      "駅はどこですか。",
      "次の電車は何時ですか？",
    ]);
    expect(splitSentences("Ich bin hier.Du bist da.")).toEqual(["Ich bin hier.", "Du bist da."]);
  });

  it("keeps Spanish question and exclamation marks on the sentence they open", () => {
    expect(splitSentences("¿Dónde está la estación?")).toEqual(["¿Dónde está la estación?"]);
    expect(splitSentences("¿Dónde está? El tren sale.")).toEqual(["¿Dónde está?", "El tren sale."]);
    expect(splitSentences("¡Hola! ¿Qué tal?")).toEqual(["¡Hola!", "¿Qué tal?"]);
  });

  it("keeps abbreviations and decimals together", () => {
    expect(splitSentences("Mr. Smith left. He was late.")).toEqual(["Mr. Smith left.", "He was late."]);
    expect(splitSentences("It costs 3.14 euros.")).toEqual(["It costs 3.14 euros."]);
    expect(splitSentences("No. I disagree.")).toEqual(["No.", "I disagree."]);
    expect(splitSentences("U.S. is big. He left.")).toEqual(["U.S. is big.", "He left."]);
  });
});

describe("word breaks", () => {
  it("uses Intl.Segmenter on this runtime", () => {
    expect(segmenterAvailable()).toBe(true);
  });

  it("groups Japanese particles onto the word before them", () => {
    expect(segmentWords("駅はどこですか。", "ja-JP")).toEqual(["駅", "は", "どこ", "です", "か"]);
    expect(groupBunsetsu(segmentWords("駅はどこですか。", "ja-JP"), "ja-JP")).toEqual(["駅は", "どこですか"]);
  });

  it("splits spaced Korean and peels a long unspaced line", () => {
    expect(segmentWords("화장실이 어디예요?", "ko-KR")).toEqual(["화장실이", "어디예요"]);
    expect(groupBunsetsu(segmentWords("화장실이어디예요", "ko-KR"), "ko-KR")).toEqual(["화장실이", "어디예요"]);
    expect(segmentWords("안녕하세요.", "ko-KR")).toEqual(["안녕하세요"]);
  });

  it("splits Mandarin into words", () => {
    expect(segmentWords("火車站在哪裡？", "zh-TW")).toEqual(["火車站", "在", "哪裡"]);
    expect(segmentWords("the train station", "en-US")).toEqual(["the", "train", "station"]);
  });
});
