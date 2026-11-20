import { describe, expect, it } from "vitest";
import {
  buildCaptionList,
  captionsFromBreaks,
  DEFAULT_SETTINGS,
  fixWord,
  flattenWords,
  mergeWithNext,
  overLimit,
  splitAt,
  toSrt,
} from "./captions";
import type { Segment } from "./model";

function seg(text: string, start = 0, step = 0.3): Segment {
  const words = text.split(" ").map((w, i) => ({ word: " " + w, start: +(start + i * step).toFixed(3), end: +(start + i * step + step - 0.05).toFixed(3), prob: 0.9 }));
  return { start: words[0].start, end: words[words.length - 1].end, text, words };
}

const LONG = "OK, I'm going to give you a very quick intro into the alphabet game, and then you're going to learn how to play the alphabet game.";

describe("automatic cut", () => {
  it("keeps every caption on one line within 42 characters", () => {
    const caps = buildCaptionList([seg(LONG)], null, DEFAULT_SETTINGS);
    expect(caps.length).toBeGreaterThan(2);
    for (const c of caps) {
      expect(c.text.length).toBeLessThanOrEqual(42);
      expect(c.text).not.toContain("\n");
    }
    expect(caps.map((c) => c.text).join(" ")).toBe(LONG);
  });

  it("cuts by word count", () => {
    const caps = buildCaptionList([seg(LONG)], null, { by: "words", value: 4 });
    for (const c of caps) expect(c.words.length).toBeLessThanOrEqual(4);
  });

  it("does not end a line on a weak word when a limit forces the break", () => {
    const caps = buildCaptionList([seg("we went to the market and bought some fresh fruit for everyone here")], null, { by: "words", value: 4 });
    for (const c of caps.slice(0, -1)) expect(["the", "a", "and", "to", "for", "of"]).not.toContain(c.words[c.words.length - 1].word);
  });

  it("never leaves the last word of a sentence alone", () => {
    const caps = buildCaptionList([seg("and then you're going to learn how to play the alphabet game.")], null, { by: "words", value: 4 });
    for (const c of caps) expect(c.words.length).toBeGreaterThan(1);
    expect(caps[caps.length - 1].text).toBe("the alphabet game.");
  });

  it("handles segments without word timings", () => {
    const caps = buildCaptionList([{ start: 10, end: 20, text: LONG, words: null }], null, DEFAULT_SETTINGS);
    expect(caps[0].start).toBe(10);
    expect(caps[caps.length - 1].end).toBeCloseTo(20);
    for (const c of caps) expect(c.text.length).toBeLessThanOrEqual(42);
  });
});

describe("hand edits", () => {
  const segs = [seg(LONG)];
  const caps = buildCaptionList(segs, null, DEFAULT_SETTINGS);

  it("splits a caption before a word", () => {
    const breaks = splitAt(caps, 0, 2);
    const out = captionsFromBreaks(flattenWords(segs), breaks);
    expect(out.length).toBe(caps.length + 1);
    expect(out[0].words.length).toBe(2);
    expect(out[1].words[0].word).toBe(caps[0].words[2].word);
  });

  it("merges a caption with the next, and flags it if it runs over", () => {
    const out = captionsFromBreaks(flattenWords(segs), mergeWithNext(caps, 0));
    expect(out.length).toBe(caps.length - 1);
    expect(out[0].text).toBe(`${caps[0].text} ${caps[1].text}`);
    expect(overLimit(out[0], DEFAULT_SETTINGS)).toBe(true);
  });

  it("fixing a word changes the transcript and keeps the cut", () => {
    const w = caps[1].words[0];
    const fixed = fixWord(segs, w.seg, w.wi, "INTRO");
    const again = captionsFromBreaks(flattenWords(fixed), caps.map((c) => c.start));
    expect(again.length).toBe(caps.length);
    expect(again[1].words[0].word).toBe("INTRO");
    expect(fixed[0].text).toContain("INTRO");
  });
});

it("writes SRT", () => {
  const caps = buildCaptionList([seg("Hello there.", 3723.4)], null, DEFAULT_SETTINGS);
  expect(toSrt(caps)).toBe("1\n01:02:03,400 --> 01:02:03,950\nHello there.\n");
});
