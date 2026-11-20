// Captions (SRT) for the Captions mode: always one line.
//
// Captions are break points over the transcript's words, never a separate copy
// of the text, so a word fixed anywhere shows up in the captions and timing
// stays exact. `breaks` are the start times (seconds) of each caption's first
// word; null means "Titan's automatic cut" with the current settings.

import { timedWords, withNewText, type Segment } from "./model";

export interface CaptionSettings {
  by: "chars" | "words";
  value: number;
  /** Hand-made splits and merges since the last automatic cut. */
  manual?: number;
}

export const DEFAULT_SETTINGS: CaptionSettings = { by: "chars", value: 42, manual: 0 };
export const LIMITS = { chars: { min: 10, max: 80 }, words: { min: 1, max: 15 } };

const MAX_SECONDS = 5;
const PAUSE = 0.5;
const EPS = 0.0005;
// A caption should not end on these when a limit forces the break.
const WEAK = new Set(["a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "that", "is", "my", "your", "our", "their", "his", "her", "its"]);

export interface CapWord {
  seg: number;
  /** Index of the word in its segment (timed words), or token index when the segment has no timings. */
  wi: number;
  word: string;
  start: number;
  end: number;
}

export interface Caption {
  start: number;
  end: number;
  text: string;
  words: CapWord[];
}

/** Every word of the transcript in order, with timing. Untimed segments get proportional times. */
export function flattenWords(segments: Segment[]): CapWord[] {
  const out: CapWord[] = [];
  segments.forEach((seg, si) => {
    const words = timedWords(seg);
    if (words) {
      words.forEach((w, wi) => out.push({ seg: si, wi, word: w.word.trim(), start: w.start, end: w.end }));
      return;
    }
    const tokens = seg.text.split(/\s+/).filter(Boolean);
    const total = tokens.reduce((n, t) => n + t.length, 0) || 1;
    let t = seg.start;
    const span = Math.max(seg.end - seg.start, 0);
    tokens.forEach((tok, wi) => {
      const end = t + (span * tok.length) / total;
      out.push({ seg: si, wi, word: tok, start: t, end });
      t = end;
    });
  });
  return out;
}

const join = (ws: CapWord[]) => ws.map((w) => w.word).join(" ");
const bare = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();

function tooBig(ws: CapWord[], s: CaptionSettings): boolean {
  return s.by === "words" ? ws.length > s.value : join(ws).length > s.value;
}

/** Titan's automatic cut: one line within the limit, breaking at natural points. */
export function autoBreaks(words: CapWord[], settings: CaptionSettings, segments?: Segment[]): number[] {
  const groups: CapWord[][] = [];
  let cur: CapWord[] = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };

  for (const w of words) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const speakerChange = segments && segments[last.seg]?.speaker !== segments[w.seg]?.speaker;
      const paused = w.start - last.end >= PAUSE;
      const tooSlow = w.end - cur[0].start > MAX_SECONDS;
      if (speakerChange || paused || tooSlow) flush();
      else if (tooBig([...cur, w], settings)) {
        const carry: CapWord[] = [];
        // Don't leave the last word of a sentence alone on its own line ("game.").
        if (/[.?!]$/.test(w.word) && cur.length > 1) carry.unshift(cur.pop()!);
        // Don't leave a weak word dangling at the end of a line.
        while (cur.length > 1 && WEAK.has(bare(cur[cur.length - 1].word))) carry.unshift(cur.pop()!);
        flush();
        cur = carry;
      }
    }
    cur.push(w);
    const tok = w.word;
    const softEnough = settings.by === "chars" ? join(cur).length >= 15 : cur.length >= Math.max(2, settings.value - 1);
    if (/[.?!]$/.test(tok) || (/[,;:]$/.test(tok) && softEnough)) flush();
  }
  flush();

  // Fold a lone trailing word into the caption before it when it still fits the limit.
  const merged: CapWord[][] = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    if (prev && g.length === 1 && !/[.?!]$/.test(prev[prev.length - 1].word)
        && g[0].start - prev[prev.length - 1].end < PAUSE && !tooBig([...prev, ...g], settings)) {
      prev.push(...g);
    } else merged.push(g);
  }
  return merged.map((g) => g[0].start);
}

/** Group words into captions starting at each break time. */
export function captionsFromBreaks(words: CapWord[], breaks: number[]): Caption[] {
  const sorted = [...breaks].sort((a, b) => a - b);
  const caps: Caption[] = [];
  let bi = 0;
  for (const w of words) {
    let startNew = caps.length === 0;
    while (bi < sorted.length && w.start >= sorted[bi] - EPS) { startNew = true; bi++; }
    if (startNew) caps.push({ start: w.start, end: w.end, text: "", words: [] });
    const c = caps[caps.length - 1];
    c.words.push(w);
    c.end = w.end;
  }
  for (const c of caps) c.text = join(c.words);
  return caps;
}

export function buildCaptionList(segments: Segment[], breaks: number[] | null | undefined, settings: CaptionSettings): Caption[] {
  const words = flattenWords(segments);
  return captionsFromBreaks(words, breaks ?? autoBreaks(words, settings, segments));
}

export const currentBreaks = (caps: Caption[]) => caps.map((c) => c.start);

/** Split caption i so that its word k starts a new caption. */
export function splitAt(caps: Caption[], i: number, k: number): number[] {
  const breaks = currentBreaks(caps);
  const w = caps[i]?.words[k];
  if (!w || k === 0) return breaks;
  return [...breaks, w.start].sort((a, b) => a - b);
}

/** Merge caption i with the one after it. */
export function mergeWithNext(caps: Caption[], i: number): number[] {
  if (i < 0 || i >= caps.length - 1) return currentBreaks(caps);
  return currentBreaks(caps).filter((_, j) => j !== i + 1);
}

export function overLimit(c: Caption, s: CaptionSettings): boolean {
  return s.by === "words" ? c.words.length > s.value : c.text.length > s.value;
}

/** Replace one word (from a caption) in the transcript, keeping timings. */
export function fixWord(segments: Segment[], seg: number, wi: number, value: string): Segment[] {
  const s = segments[seg];
  if (!s) return segments;
  const timed = timedWords(s);
  const tokens = timed ? timed.map((w) => w.word.trim()) : s.text.split(/\s+/).filter(Boolean);
  if (wi < 0 || wi >= tokens.length) return segments;
  const next = [...tokens.slice(0, wi), ...value.trim().split(/\s+/).filter(Boolean), ...tokens.slice(wi + 1)];
  return segments.map((x, i) => (i === seg ? withNewText(x, next.join(" ")) : x));
}

export function captionAt(caps: Caption[], t: number): number {
  let lo = 0;
  let hi = caps.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (caps[mid].end < t) lo = mid + 1;
    else if (caps[mid].start > t) hi = mid - 1;
    else return mid;
  }
  return -1;
}

function srtTime(sec: number): string {
  const ms = Math.round(Math.max(0, sec) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms % 1000, 3)}`;
}

export function toSrt(caps: Caption[]): string {
  return caps.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

/** The shape the backend stores and writes the SRT from. */
export function forSaving(caps: Caption[]) {
  return caps.map((c) => ({ start: +c.start.toFixed(3), end: +c.end.toFixed(3), text: c.text }));
}
