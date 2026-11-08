import { describe, expect, it } from "vitest";
import { acceptSuggestion, countWord, dismissSuggestion, findMatches, replaceAll, replaceWordEverywhere, singleWordFix, timedWords, undoAutoFixes, withNewText, wordListMarks, wordRange, type Segment } from "./model";

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


describe("fix the others", () => {
  it("offers names and terms, never everyday words", () => {
    expect(singleWordFix("we met Anthano today.", "we met Antano today.")).toEqual({ from: "Anthano", to: "Antano" });
    expect(singleWordFix("join BIG now", "join B!G now")).toEqual({ from: "BIG", to: "B!G" });
    expect(singleWordFix("a big plan", "a B!G plan")).toBeNull();
    expect(singleWordFix("one two", "one three four")).toBeNull();
    expect(singleWordFix("Anthano and Harani", "Antano and Harini")).toBeNull();
  });

  it("replaces exact occurrences only, keeping punctuation and timings", () => {
    const segs = [seg("Anthano said hi."), seg("thanks Anthano, see you"), seg("Anthanos is different")];
    expect(countWord(segs, "Anthano")).toBe(2);
    const out = replaceWordEverywhere(segs, "Anthano", "Antano");
    expect(out.map((s) => s.text)).toEqual(["Antano said hi.", "thanks Antano, see you", "Anthanos is different"]);
    expect(out[1].words?.[1]).toMatchObject({ word: " Antano,", start: 1 });
    expect(out[2]).toBe(segs[2]);
  });
});


describe("word list marks", () => {
  function marked(): Segment {
    return {
      start: 0, end: 3, text: "join Antano, big cohort",
      words: [
        { word: " join", start: 0, end: 0.5 },
        { word: " Antano,", start: 1, end: 1.5, auto_from: "Anthano," },
        { word: " big", start: 2, end: 2.5, suggest: "B!G" },
        { word: " cohort", start: 3, end: 3.5 },
      ],
    };
  }

  it("counts, accepts, dismisses and undoes", () => {
    expect(wordListMarks([marked()])).toEqual({ fixed: 1, suggested: 1 });
    const accepted = acceptSuggestion(marked(), 2);
    expect(accepted.text).toBe("join Antano, B!G cohort");
    expect(accepted.words?.[2]).toMatchObject({ word: " B!G", start: 2 });
    expect(accepted.words?.[2].suggest).toBeUndefined();
    expect(dismissSuggestion(marked(), 2).words?.[2]).toEqual({ word: " big", start: 2, end: 2.5 });
    const undone = undoAutoFixes([marked()])[0];
    expect(undone.text).toBe("join Anthano, big cohort");
    expect(undone.words?.[1].auto_from).toBeUndefined();
  });

  it("drops marks from a word a person rewrites", () => {
    const edited = withNewText(marked(), "join Antano, BIG cohort");
    expect(edited.words?.[2]).toEqual({ word: " BIG", start: 2, end: 2.5, prob: 1 });
    expect(edited.words?.[1].auto_from).toBe("Anthano,");
  });
});


describe("find and replace", () => {
  const segs = (...t: string[]) => t.map((x) => seg(x));
  it("matches whole words only", () => {
    const s = segs("his peer group, I gave up. Up next", "upon the setup up");
    expect(findMatches(s, "up").length).toBe(3);
    expect(findMatches(s, "first lever").length).toBe(0);
    expect(findMatches(segs("the first lever is"), "first lever").length).toBe(1);
    expect(findMatches(segs("join B!G now", "B!Gs"), "B!G").length).toBe(1);
  });
  it("replaces whole words only", () => {
    const out = replaceAll(segs("group up, Up"), "up", "down");
    expect(out[0].text).toBe("group down, down");
  });
});
