import { describe, expect, it } from "vitest";
import { timedWords, withNewText, wordRange, type Segment } from "./model";

function seg(text: string): Segment {
  const words = text.split(" ").map((w, i) => ({ word: " " + w, start: i, end: i + 0.8, prob: 0.4 }));
  return { start: 0, end: words[words.length - 1].end, text, words };
}

describe("withNewText", () => {
  it("keeps every slot on a spelling fix", () => {
    const out = withNewText(seg("we met Anthano today"), "we met Antano today");
    expect(timedWords(out)?.map((w) => [w.word.trim(), w.start])).toEqual([
      ["we", 0], ["met", 1], ["Antano", 2], ["today", 3],
    ]);
    expect(out.words?.[2].prob).toBe(1);
    expect(out.words?.[0].prob).toBe(0.4);
  });

  it("keeps timings when a phrase is rewritten with more words", () => {
    const out = withNewText(seg("smaller sub over there so"), "the smaller group over there so");
    const w = timedWords(out)!;
    expect(w.map((x) => x.word.trim())).toEqual(["the", "smaller", "group", "over", "there", "so"]);
    expect(w[w.length - 1].start).toBe(4); // unchanged tail keeps its time
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBeGreaterThanOrEqual(w[i - 1].start);
  });

  it("keeps timings when words are deleted", () => {
    const out = withNewText(seg("you know what I want"), "what I want");
    const w = timedWords(out)!;
    expect(w.map((x) => [x.word.trim(), x.start])).toEqual([["what", 2], ["I", 3], ["want", 4]]);
  });

  it("rewrites a whole sentence and still has timed words", () => {
    const out = withNewText(seg("a b c d"), "completely different words here now");
    expect(timedWords(out)?.length).toBe(5);
    expect(out.words?.[0].start).toBe(0);
    expect(out.words?.[4].end).toBeCloseTo(3.8);
  });
});

describe("wordRange", () => {
  it("finds the n-th word", () => {
    expect(wordRange("we met Antano today", 2)).toEqual([7, 13]);
    expect(wordRange("one", 3)).toBeNull();
  });
});
