// Transcript data helpers for the Edit view: paragraphs, word timing,
// short captions and keeping word timings after an edit.

export interface Word {
  word: string;
  start: number;
  end: number;
  prob?: number;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
  words?: Word[] | null;
  /** Proofread mode: a person has checked this sentence. */
  checked?: boolean | null;
}

/** A word Whisper was less sure about than this is flagged for checking. */
export const UNSURE_BELOW = 0.5;

// ── Time formatting ───────────────────────────────────────────────────────────

/** 0:07, 12:03 or 1:02:03 */
export function fmtShort(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/** 00:01:23 for the player clock and copied timecodes */
export function fmtClock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function speakerLabel(speaker: string | null | undefined): string {
  if (!speaker) return "";
  const m = /^SPEAKER_(\d+)$/.exec(speaker);
  return m ? `Speaker ${Number(m[1]) + 1}` : speaker;
}

// ── Words ─────────────────────────────────────────────────────────────────────

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Word timings are only trusted while they still spell out the segment text. */
export function timedWords(seg: Segment): Word[] | null {
  const words = (seg.words ?? []).filter((w) => w.word.trim());
  if (!words.length) return null;
  return norm(words.map((w) => w.word).join("")) === norm(seg.text) ? words : null;
}

/**
 * New text for a segment, keeping word timings so the highlight still works.
 * Same word count (spelling fixes): each word keeps its slot. Otherwise the
 * unchanged words at the start and end keep their timings, and the edited
 * middle shares the time of the words it replaced. Edited words count as checked.
 */
export function withNewText(seg: Segment, text: string): Segment {
  const tokens = norm(text).split(" ").filter(Boolean);
  const old = timedWords(seg);
  const clean = tokens.join(" ");
  if (!old || !tokens.length) return { ...seg, text: clean, words: null };

  if (old.length === tokens.length) {
    const words = old.map((w, i) => {
      const changed = w.word.trim() !== tokens[i];
      return { ...w, word: " " + tokens[i], prob: changed ? 1 : w.prob };
    });
    return { ...seg, text: clean, words };
  }

  let pre = 0;
  while (pre < old.length && pre < tokens.length && old[pre].word.trim() === tokens[pre]) pre++;
  let suf = 0;
  while (
    suf < old.length - pre && suf < tokens.length - pre &&
    old[old.length - 1 - suf].word.trim() === tokens[tokens.length - 1 - suf]
  ) suf++;

  const oldMid = old.slice(pre, old.length - suf);
  const newMid = tokens.slice(pre, tokens.length - suf);
  // Time available to the edited words: what the replaced words used, or the gap they sit in.
  const from = oldMid.length ? oldMid[0].start : pre > 0 ? old[pre - 1].end : seg.start;
  const to = oldMid.length ? oldMid[oldMid.length - 1].end : suf > 0 ? old[old.length - suf].start : seg.end;
  const step = newMid.length ? Math.max(to - from, 0) / newMid.length : 0;
  const mid = newMid.map((t, i) => ({
    word: " " + t,
    start: +(from + step * i).toFixed(3),
    end: +(from + step * (i + 1)).toFixed(3),
    prob: 1,
  }));
  const words = [...old.slice(0, pre), ...mid, ...old.slice(old.length - suf)];
  return { ...seg, text: clean, words };
}

/** Character range of the n-th word in a text, for selecting it in the editor. */
export function wordRange(text: string, n: number): [number, number] | null {
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (i++ === n) return [m.index, m.index + m[0].length];
  }
  return null;
}

/** Split a segment at a character position, keeping word timings where possible. */
export function splitSegment(seg: Segment, before: string, after: string): [Segment, Segment] {
  const words = timedWords(seg);
  const nBefore = norm(before).split(" ").filter(Boolean).length;
  if (words && nBefore > 0 && nBefore < words.length && norm(before + " " + after) === norm(seg.text)) {
    const w1 = words.slice(0, nBefore);
    const w2 = words.slice(nBefore);
    return [
      { ...seg, text: norm(before), end: w1[w1.length - 1].end, words: w1 },
      { ...seg, text: norm(after), start: w2[0].start, words: w2 },
    ];
  }
  const total = before.length + after.length || 1;
  const cut = Math.round((seg.start + (seg.end - seg.start) * (before.length / total)) * 1000) / 1000;
  return [
    { ...seg, text: norm(before), end: cut, words: null },
    { ...seg, text: norm(after), start: cut, words: null },
  ];
}

// ── Paragraphs ────────────────────────────────────────────────────────────────

export interface Paragraph {
  first: number; // index of first segment
  last: number; // index of last segment (inclusive)
  start: number;
  end: number;
  speaker: string | null;
}

/**
 * Group segments into readable paragraphs: a new one starts on a speaker change,
 * a pause of 2 s or more, or after a sentence once the paragraph has ~60 words.
 */
export function buildParagraphs(segments: Segment[]): Paragraph[] {
  const paras: Paragraph[] = [];
  let words = 0;
  segments.forEach((seg, i) => {
    const prev = paras[paras.length - 1];
    const prevSeg = segments[i - 1];
    const speaker = seg.speaker ?? null;
    const startNew =
      !prev ||
      speaker !== prev.speaker ||
      seg.start - prevSeg.end >= 2 ||
      (words >= 60 && /[.?!]$/.test(prevSeg.text.trim()));
    if (startNew) {
      paras.push({ first: i, last: i, start: seg.start, end: seg.end, speaker });
      words = 0;
    } else {
      prev.last = i;
      prev.end = seg.end;
    }
    words += seg.text.split(/\s+/).length;
  });
  return paras;
}

// ── Lookups by time ───────────────────────────────────────────────────────────

/** Index of the last segment that has started by time t (-1 before the first). */
export function segmentAt(segments: Segment[], t: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export interface UnsureWord {
  seg: number;
  word: number;
  start: number;
}

export function unsureWords(segments: Segment[]): UnsureWord[] {
  const out: UnsureWord[] = [];
  segments.forEach((seg, si) => {
    timedWords(seg)?.forEach((w, wi) => {
      if ((w.prob ?? 1) < UNSURE_BELOW) out.push({ seg: si, word: wi, start: w.start });
    });
  });
  return out;
}

// ── Short captions (same rules as the worker and backend) ─────────────────────

const MAX_CHARS = 42;
const MAX_SECONDS = 5;
const PAUSE = 0.5;

export interface Caption {
  start: number;
  end: number;
  text: string;
}

export function buildCaptions(segments: Segment[]): Caption[] {
  const caps: Caption[] = [];
  for (const seg of segments) {
    const words = timedWords(seg);
    if (!words) {
      caps.push({ start: seg.start, end: seg.end, text: seg.text });
      continue;
    }
    let cur: Word[] = [];
    const text = (ws: Word[]) => ws.map((w) => w.word).join("").trim();
    const flush = () => {
      if (cur.length) caps.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: text(cur) });
      cur = [];
    };
    for (const w of words) {
      if (cur.length) {
        const tooLong = text([...cur, w]).length > MAX_CHARS;
        const tooSlow = w.end - cur[0].start > MAX_SECONDS;
        const paused = w.start - cur[cur.length - 1].end >= PAUSE;
        if (tooLong || tooSlow || paused) flush();
      }
      cur.push(w);
      const tok = w.word.trim();
      if (/[.?!]$/.test(tok) || (/[,;:]$/.test(tok) && text(cur).length >= 15)) flush();
    }
    flush();
  }
  return caps;
}

export function captionAt(caps: Caption[], t: number): Caption | null {
  let lo = 0;
  let hi = caps.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (caps[mid].end < t) lo = mid + 1;
    else if (caps[mid].start > t) hi = mid - 1;
    else return caps[mid];
  }
  return null;
}

// ── Find & replace ────────────────────────────────────────────────────────────

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findRegex(query: string): RegExp | null {
  const q = query.trim();
  return q ? new RegExp(escapeRegex(q), "gi") : null;
}

export interface Match {
  seg: number;
  index: number;
}

export function findMatches(segments: Segment[], query: string): Match[] {
  const re = findRegex(query);
  if (!re) return [];
  const out: Match[] = [];
  segments.forEach((seg, i) => {
    for (const m of seg.text.matchAll(re)) out.push({ seg: i, index: m.index ?? 0 });
  });
  return out;
}

export function replaceAll(segments: Segment[], query: string, replacement: string): Segment[] {
  const re = findRegex(query);
  if (!re) return segments;
  return segments.map((seg) => {
    re.lastIndex = 0;
    return re.test(seg.text) ? withNewText(seg, seg.text.replace(re, replacement)) : seg;
  });
}

// ── Proofreading ──────────────────────────────────────────────────────────────

export function isParagraphChecked(segments: Segment[], p: Paragraph): boolean {
  for (let i = p.first; i <= p.last; i++) if (!segments[i].checked) return false;
  return true;
}

export function setParagraphChecked(segments: Segment[], p: Paragraph, checked: boolean): Segment[] {
  return segments.map((s, i) => (i >= p.first && i <= p.last ? { ...s, checked } : s));
}

// ── "Fix the others" after a one-word correction ──────────────────────────────

const PUNCT = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const bare = (tok: string) => tok.replace(PUNCT, "");

/**
 * If an edit changed exactly one word into one other word, return the pair
 * (without punctuation). Only names and terms qualify: the original word must
 * contain a capital letter, so everyday words like "big" are never offered.
 */
export function singleWordFix(before: string, after: string): { from: string; to: string } | null {
  const a = norm(before).split(" ").filter(Boolean);
  const b = norm(after).split(" ").filter(Boolean);
  if (a.length !== b.length) return null;
  const diffs = a.map((t, i) => [t, b[i]] as const).filter(([x, y]) => x !== y);
  if (diffs.length !== 1) return null;
  const from = bare(diffs[0][0]);
  const to = bare(diffs[0][1]);
  if (!from || !to || from === to || !/\p{Lu}/u.test(from)) return null;
  return { from, to };
}

/** Occurrences of a word (exact, ignoring surrounding punctuation). */
export function countWord(segments: Segment[], word: string): number {
  let n = 0;
  for (const s of segments) for (const t of s.text.split(/\s+/)) if (bare(t) === word) n++;
  return n;
}

/** Replace every exact occurrence of a word, keeping punctuation and word timings. */
export function replaceWordEverywhere(segments: Segment[], from: string, to: string): Segment[] {
  return segments.map((s) => {
    const toks = s.text.split(/\s+/);
    if (!toks.some((t) => bare(t) === from)) return s;
    return withNewText(s, toks.map((t) => (bare(t) === from ? t.replace(from, to) : t)).join(" "));
  });
}
