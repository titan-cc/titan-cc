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
 * New text for a segment. When the word count is unchanged (a spelling fix),
 * the old timings carry over and changed words count as checked. Otherwise the
 * word timings are dropped and the segment plays as one block.
 */
export function withNewText(seg: Segment, text: string): Segment {
  const tokens = norm(text).split(" ").filter(Boolean);
  const old = timedWords(seg);
  if (old && old.length === tokens.length) {
    const words = old.map((w, i) => {
      const changed = w.word.trim() !== tokens[i];
      return { ...w, word: " " + tokens[i], prob: changed ? 1 : w.prob };
    });
    return { ...seg, text: tokens.join(" "), words };
  }
  return { ...seg, text: tokens.join(" "), words: null };
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
