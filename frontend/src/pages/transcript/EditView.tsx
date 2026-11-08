import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildCaptions,
  buildParagraphs,
  captionAt,
  countWord,
  findMatches,
  findRegex,
  fmtClock,
  fmtShort,
  isParagraphChecked,
  replaceAll,
  replaceWordEverywhere,
  segmentAt,
  setParagraphChecked,
  singleWordFix,
  speakerLabel,
  splitSegment,
  timedWords,
  wordRange,
  UNSURE_BELOW,
  unsureWords,
  withNewText,
  type Paragraph,
  type Segment,
} from "./model";

// ── Small pieces ──────────────────────────────────────────────────────────────

const SPEAKER_COLOURS = ["#0076A3", "#14732C", "#62005A", "#7a4a00", "#A70063"];
const RATES = [0.75, 1, 1.25, 1.5, 2];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-block min-w-[18px] px-1.5 py-px rounded-md text-[11px] font-mono text-center"
      style={{ border: "1px solid var(--border-strong)", backgroundColor: "var(--surface)", color: "var(--text-secondary)" }}
    >
      {children}
    </kbd>
  );
}

function Icon({ d, fill = false, size = 16 }: { d: string; fill?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"}
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  back5: "M11 17l-5-5 5-5M18 17l-5-5 5-5",
  fwd5: "M13 17l5-5-5-5M6 17l5-5-5-5",
  play: "M7 4l13 8-13 8z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
  full: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4-4",
  chevron: "M6 9l6 6 6-6",
  keys: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  sound: "M11 5L6 9H3v6h3l5 4V5zM16 9a4 4 0 010 6",
  mute: "M11 5L6 9H3v6h3l5 4V5zM17 9l4 6M21 9l-4 6",
  check: "M5 12l5 5 9-10",
  download: "M12 4v11m0 0l-4-4m4 4l4-4M4 19h16",
};

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, onOutside, active]);
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

// ── Segment editor (inline) ───────────────────────────────────────────────────

function SegmentEditor({
  text,
  select,
  onSave,
  onCancel,
  onSplit,
}: {
  text: string;
  /** Characters to select when it opens (the word that was double-clicked). */
  select?: [number, number] | null;
  onSave: (text: string) => void;
  onCancel: () => void;
  onSplit: (before: string, after: string) => void;
}) {
  const [value, setValue] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (select) el.setSelectionRange(select[0], select[1]);
    else el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- select only once, when the editor opens
  }, []);

  function split() {
    const el = ref.current;
    if (!el) return;
    const pos = el.selectionStart;
    const before = value.slice(0, pos).trim();
    const after = value.slice(pos).trim();
    if (before && after) onSplit(before, after);
  }

  return (
    <span className="block my-1.5">
      <textarea
        ref={ref}
        value={value}
        aria-label="Edit text"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
          else if (e.key === "Enter" && e.altKey) { e.preventDefault(); split(); }
          else if (e.key === "Enter") { e.preventDefault(); onSave(value); }
        }}
        rows={Math.max(2, Math.ceil(value.length / 70))}
        className="w-full rounded-lg px-3 py-2 text-[16px] leading-relaxed resize-none focus:outline-none"
        style={{ border: "1.5px solid var(--brand)", color: "var(--text-primary)", backgroundColor: "var(--surface)" }}
      />
      <span className="flex flex-wrap items-center gap-2 mt-1.5">
        <button onClick={() => onSave(value)} disabled={value.trim() === text.trim()}
          className="h-8 px-3 rounded-lg text-xs font-semibold disabled:opacity-40"
          style={{ backgroundColor: "var(--brand-dark)", color: "#fff" }}>Save</button>
        <button onClick={split}
          className="h-8 px-3 rounded-lg text-xs font-medium"
          style={{ border: "1px solid var(--border-strong)", color: "var(--text-secondary)", backgroundColor: "var(--surface)" }}>
          Split at cursor</button>
        <button onClick={onCancel}
          className="h-8 px-3 rounded-lg text-xs font-medium"
          style={{ color: "var(--text-secondary)" }}>Cancel</button>
        <span className="ml-auto text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          <Kbd>Enter</Kbd> save · <Kbd>Alt Enter</Kbd> split · <Kbd>Esc</Kbd> cancel
        </span>
      </span>
    </span>
  );
}

// ── One paragraph ─────────────────────────────────────────────────────────────

interface ParagraphProps {
  para: Paragraph;
  segments: Segment[];
  /** Playback time, only for the paragraph that is playing (keeps the rest from re-rendering). */
  time: number | null;
  status: "past" | "active" | "future";
  editing: number | null;
  /** Word to pre-select in the sentence being edited. */
  editWord: number | null;
  query: string;
  speakerColour: string;
  showUnsure: boolean;
  onSeek: (t: number) => void;
  onEdit: (seg: number, word?: number) => void;
  onSave: (seg: number, text: string) => void;
  onSplit: (seg: number, before: string, after: string) => void;
  onCancel: () => void;
  proofread: boolean;
  checked: boolean;
  onToggleCheck: (p: Paragraph) => void;
}

const ParagraphBlock = memo(function ParagraphBlock({
  para, segments, time, status, editing, editWord, query, speakerColour, showUnsure,
  onSeek, onEdit, onSave, onSplit, onCancel, proofread, checked, onToggleCheck,
}: ParagraphProps) {
  const re = findRegex(query);
  const items = [];

  for (let si = para.first; si <= para.last; si++) {
    const seg = segments[si];
    if (editing === si) {
      items.push(
        <SegmentEditor key={si} text={seg.text} select={editWord !== null ? wordRange(seg.text, editWord) : null}
          onSave={(t) => onSave(si, t)} onCancel={onCancel} onSplit={(a, b) => onSplit(si, a, b)} />,
      );
      continue;
    }

    const words = timedWords(seg);
    let body: React.ReactNode;

    if (re) {
      // Find mode: plain text with matches marked.
      const parts = seg.text.split(new RegExp(`(${re.source})`, "gi"));
      body = parts.map((p, i) =>
        i % 2 === 1 ? <mark key={i} className="rounded px-0.5" style={{ backgroundColor: "#FDE68A", color: "inherit" }}>{p}</mark> : <span key={i}>{p}</span>,
      );
      body = <span data-s={seg.start} data-e={seg.end}>{body}</span>;
    } else if (words) {
      body = words.map((w, wi) => {
        const now = time !== null && time >= w.start && time < w.end;
        const played = status === "past" || (time !== null && w.end <= time);
        const unsure = showUnsure && (w.prob ?? 1) < UNSURE_BELOW;
        return (
          <span key={wi}>
            {wi > 0 && " "}
            <span
              data-s={w.start}
              data-e={w.end}
              onClick={() => onSeek(w.start)}
              onDoubleClick={(e) => { e.stopPropagation(); onEdit(si, wi); }}
              title={unsure ? `Unclear audio: ${Math.round((w.prob ?? 0) * 100)}% sure` : undefined}
              className="cursor-pointer rounded-[3px]"
              style={{
                color: now ? "#fff" : played ? "var(--text-primary)" : undefined,
                backgroundColor: now ? "var(--brand-dark)" : undefined,
                padding: now ? "0 2px" : undefined,
                textDecoration: unsure ? "underline dotted #B45309 2px" : undefined,
                textUnderlineOffset: unsure ? 4 : undefined,
              }}
            >
              {w.word.trim()}
            </span>
          </span>
        );
      });
    } else {
      const playing = time !== null && time >= seg.start && time < seg.end;
      body = (
        <span data-s={seg.start} data-e={seg.end} onClick={() => onSeek(seg.start)} className="cursor-pointer rounded"
          style={{ backgroundColor: playing ? "var(--brand-subtle)" : undefined, color: status === "past" || playing ? "var(--text-primary)" : undefined }}>
          {seg.text}
        </span>
      );
    }

    items.push(
      <span key={si} onDoubleClick={() => onEdit(si)} className="seg-hover rounded">
        {si > para.first && " "}
        {body}
      </span>,
    );
  }

  return (
    <div
      data-para-start={para.start}
      className="flex gap-4 px-4 py-3 rounded-xl"
      style={{
        backgroundColor: status === "active" ? "var(--brand-subtle)" : undefined,
        opacity: proofread && checked && status !== "active" ? 0.6 : 1,
      }}
    >
      <div className="w-[72px] shrink-0 flex flex-col gap-1 pt-0.5">
        {para.speaker && (
          <span className="text-xs font-semibold truncate" style={{ color: speakerColour }}>{speakerLabel(para.speaker)}</span>
        )}
        <button onClick={() => onSeek(para.start)} className="text-left text-[11px] font-mono tabular-nums hover:underline"
          style={{ color: "var(--text-tertiary)" }} title="Play from here">
          {fmtShort(para.start)}
        </button>
      </div>
      <p className={`m-0 flex-1 min-w-0 ${proofread ? "text-[18px] leading-[1.8]" : "text-[16px] leading-[1.75]"}`}
        style={{ color: status === "past" || proofread ? "var(--text-primary)" : "var(--text-secondary)" }}>
        {items}
      </p>
      {proofread && (
        <button
          onClick={() => onToggleCheck(para)}
          aria-label={checked ? "Paragraph checked, click to undo" : "Mark paragraph checked"}
          aria-pressed={checked}
          title={checked ? "Checked" : "Mark checked (Ctrl Enter)"}
          className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center mt-0.5"
          style={checked
            ? { backgroundColor: "#1F9D5C", border: "1.5px solid #1F9D5C", color: "#fff" }
            : { backgroundColor: "var(--surface)", border: "1.5px solid var(--border-strong)", color: "transparent" }}
        >
          <Icon d={ICONS.check} size={15} />
        </button>
      )}
    </div>
  );
});

// ── The Edit view ─────────────────────────────────────────────────────────────

export interface EditViewProps {
  filename: string;
  segments: Segment[];
  videoUrl: string | null | undefined;
  downloads: Record<string, { url: string }>;
  saveState: "idle" | "saving" | "saved" | "error";
  onChange: (segments: Segment[]) => void;
  backLink: React.ReactNode;
}

const EXPORT_LABELS: Record<string, [string, string]> = {
  srt: ["SRT captions", "YouTube, Premiere, most players"],
  txt: ["Plain text", ".txt"],
  json: ["JSON with word timings", ".json"],
};

export default function EditView({ filename, segments, videoUrl, downloads, saveState, onChange, backLink }: EditViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const lastUserScroll = useRef(0);
  const stopAt = useRef<number | null>(null);

  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [cc, setCc] = useState(true);
  const [editing, setEditing] = useState<{ seg: number; word: number | null } | null>(null);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  const [showUnsure, setShowUnsure] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ x: number; y: number; start: number; end: number; text: string } | null>(null);
  const [mode, setModeState] = useState<"edit" | "proofread">(() => {
    try { return localStorage.getItem("titan.transcriptMode") === "proofread" ? "proofread" : "edit"; } catch { return "edit"; }
  });
  const [pauseOnEdit, setPauseOnEdit] = useState(true);
  const [rewindOnResume, setRewindOnResume] = useState(true);
  const [fixOffer, setFixOffer] = useState<{ from: string; to: string; count: number } | null>(null);
  const proofread = mode === "proofread";

  function setMode(m: "edit" | "proofread") {
    setModeState(m);
    try { localStorage.setItem("titan.transcriptMode", m); } catch { /* private window */ }
  }

  const paragraphs = useMemo(() => buildParagraphs(segments), [segments]);
  const captions = useMemo(() => buildCaptions(segments), [segments]);
  const allUnsure = useMemo(() => unsureWords(segments), [segments]);
  // Off by default: Whisper confidence alone flags many correct words (phase 1 feedback).
  const unsure = showUnsure ? allUnsure : [];
  const matches = useMemo(() => findMatches(segments, query), [segments, query]);
  const speakers = useMemo(() => [...new Set(segments.map((s) => s.speaker).filter(Boolean))] as string[], [segments]);
  const wordCount = useMemo(() => segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0), [segments]);
  const totalLength = duration || (segments.length ? segments[segments.length - 1].end : 0);

  const activeSeg = segmentAt(segments, time);
  const activePara = activeSeg < 0 ? -1 : paragraphs.findIndex((p) => activeSeg >= p.first && activeSeg <= p.last);
  const caption = cc ? captionAt(captions, time) : null;
  const checkedFlags = useMemo(() => paragraphs.map((p) => isParagraphChecked(segments, p)), [paragraphs, segments]);
  const checkedCount = checkedFlags.filter(Boolean).length;

  // ── Playback ────────────────────────────────────────────────────────────────

  // Smooth word highlight: read the clock every frame while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        if (stopAt.current !== null && v.currentTime >= stopAt.current) {
          v.pause();
          stopAt.current = null;
        }
        setTime(v.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = useCallback((t: number, play = true) => {
    const v = videoRef.current;
    stopAt.current = null;
    setTime(t);
    if (!v) return;
    v.currentTime = Math.max(0, t);
    if (play) v.play().catch(() => {});
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (proofread && rewindOnResume && v.currentTime > 2) v.currentTime -= 2;
      v.play().catch(() => {});
    } else v.pause();
  }, [proofread, rewindOnResume]);

  const skip = useCallback((d: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, v.currentTime + d);
    setTime(v.currentTime);
  }, []);

  function cycleRate() {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }

  function toggleFullscreen() {
    const el = playerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  }

  // Keep the playing paragraph in view, unless the person scrolled in the last 4 s.
  useEffect(() => {
    if (activePara < 0 || !playing || Date.now() - lastUserScroll.current < 4000) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-para-start="${paragraphs[activePara].start}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activePara, playing, paragraphs]);

  // ── Editing ─────────────────────────────────────────────────────────────────

  const handleSave = useCallback((si: number, text: string) => {
    const clean = text.trim();
    setEditing(null);
    if (!clean || clean === segments[si].text.trim()) return;
    const next = segments.map((s, i) => (i === si ? withNewText(s, clean) : s));
    onChange(next);
    // A name or term fixed here may be wrong elsewhere too: offer to fix the rest.
    const fix = singleWordFix(segments[si].text, clean);
    const count = fix ? countWord(next, fix.from) : 0;
    setFixOffer(fix && count > 0 ? { ...fix, count } : null);
  }, [segments, onChange]);

  const handleSplit = useCallback((si: number, before: string, after: string) => {
    setEditing(null);
    const [a, b] = splitSegment(segments[si], before, after);
    onChange([...segments.slice(0, si), a, b, ...segments.slice(si + 1)]);
  }, [segments, onChange]);

  const handleEdit = useCallback((si: number, word?: number) => {
    if (!proofread || pauseOnEdit) videoRef.current?.pause();
    window.getSelection()?.removeAllRanges(); // drop the double-click word selection
    setSelection(null);
    setEditing({ seg: si, word: word ?? null });
  }, [proofread, pauseOnEdit]);
  const handleCancel = useCallback(() => setEditing(null), []);

  // ── Proofreading ────────────────────────────────────────────────────────────

  function scrollToPara(pi: number) {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-para-start="${paragraphs[pi].start}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    lastUserScroll.current = 0;
  }

  function goToNextUnchecked(flags = checkedFlags) {
    if (!paragraphs.length) return;
    for (let k = 1; k <= paragraphs.length; k++) {
      const pi = (Math.max(activePara, -1) + k) % paragraphs.length;
      if (!flags[pi]) {
        seek(paragraphs[pi].start);
        scrollToPara(pi);
        return;
      }
    }
    setCopied("Every paragraph is checked");
    setTimeout(() => setCopied(null), 2200);
  }

  const toggleCheck = useCallback((p: Paragraph) => {
    onChange(setParagraphChecked(segments, p, !isParagraphChecked(segments, p)));
  }, [segments, onChange]);

  function checkAndNext() {
    if (activePara < 0) return goToNextUnchecked();
    const p = paragraphs[activePara];
    onChange(setParagraphChecked(segments, p, true));
    goToNextUnchecked(checkedFlags.map((f, i) => (i === activePara ? true : f)));
  }

  function replay(seconds: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, v.currentTime - seconds);
    v.play().catch(() => {});
  }

  function setRateTo(r: number) {
    setRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  }

  function fixTheOthers() {
    if (!fixOffer) return;
    onChange(replaceWordEverywhere(segments, fixOffer.from, fixOffer.to));
    setCopied(`Fixed ${fixOffer.count} more`);
    setTimeout(() => setCopied(null), 1800);
    setFixOffer(null);
  }

  function reviewTheOthers() {
    if (!fixOffer) return;
    setQuery(fixOffer.from);
    setReplacement(fixOffer.to);
    setShowReplace(true);
    setMatchIdx(0);
    setFixOffer(null);
  }

  useEffect(() => {
    if (!fixOffer) return;
    const t = setTimeout(() => setFixOffer(null), 20000);
    return () => clearTimeout(t);
  }, [fixOffer]);

  function replaceEverything() {
    if (!matches.length) return;
    onChange(replaceAll(segments, query, replacement));
    setQuery("");
    setReplacement("");
    setShowReplace(false);
  }

  function goToMatch(step: number) {
    if (!matches.length) return;
    const next = (matchIdx + step + matches.length) % matches.length;
    setMatchIdx(next);
    seek(segments[matches[next].seg].start, false);
    const el = scrollRef.current?.querySelectorAll("mark")[next];
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function nextUnsure() {
    if (!unsure.length) return;
    const next = unsure.find((u) => u.start > time + 0.05) ?? unsure[0];
    seek(Math.max(0, next.start - 1));
    lastUserScroll.current = 0;
  }

  // ── Selection toolbar ───────────────────────────────────────────────────────

  function readSelection() {
    const sel = window.getSelection();
    const box = scrollRef.current;
    if (!sel || sel.isCollapsed || !box || !box.contains(sel.anchorNode)) {
      setSelection(null);
      return;
    }
    const timeOf = (n: Node | null, key: "s" | "e") => {
      const el = (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-s]");
      return el ? Number(el.dataset[key]) : null;
    };
    const a = timeOf(sel.anchorNode, "s");
    const b = timeOf(sel.focusNode, "s");
    const ae = timeOf(sel.anchorNode, "e");
    const be = timeOf(sel.focusNode, "e");
    if (a === null || b === null || ae === null || be === null) return setSelection(null);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const host = box.getBoundingClientRect();
    const top = rect.top - host.top + box.scrollTop;
    setSelection({
      x: rect.left - host.left + rect.width / 2,
      // Above the selection when there is room in view, otherwise below it.
      y: rect.top - host.top >= 50 ? top - 46 : top + rect.height + 8,
      start: Math.min(a, b),
      end: Math.max(ae, be),
      text: sel.toString().replace(/\s+/g, " ").trim(),
    });
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied("Copy failed");
      setTimeout(() => setCopied(null), 1800);
    }
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTyping(e.target);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === "Space") { e.preventDefault(); togglePlay(); return; }
      if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); findRef.current?.focus(); findRef.current?.select(); return; }
      if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); replay(3); return; }
      if (e.key === "Escape") { setHelpOpen(false); setExportOpen(false); setSelection(null); if (!typing) setQuery(""); return; }
      if (typing) return;
      if (proofread && mod && e.key === "Enter") { e.preventDefault(); checkAndNext(); return; }
      if (proofread && e.key === "Tab" && !e.shiftKey) {
        const t = e.target as HTMLElement;
        const onControl = t.closest?.("button, a, input, select, textarea, [role=slider]");
        if (!onControl) { e.preventDefault(); goToNextUnchecked(); return; }
      }
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); skip(-5); }
      else if (e.key === "ArrowRight") { e.preventDefault(); skip(5); }
      else if (e.key === "?") setHelpOpen((o) => !o);
      else if (e.key.toLowerCase() === "e" && activeSeg >= 0) { e.preventDefault(); handleEdit(activeSeg); }
      else if (e.key.toLowerCase() === "n") nextUnsure();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useClickOutside(exportRef, useCallback(() => setExportOpen(false), []), exportOpen);

  // ── Render ──────────────────────────────────────────────────────────────────

  const btn = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-[10px] text-[13px] font-medium transition-ui";
  const btnStyle = { border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text-primary)" };
  const panel = { backgroundColor: "var(--surface)", border: "1px solid var(--border)" };

  return (
    <div className="flex flex-col gap-4">
      <style>{`.seg-hover:hover{background:var(--surface-raised)}`}</style>

      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {backLink}
        <span style={{ color: "var(--border-strong)" }} aria-hidden="true">/</span>
        <h1 className="m-0 text-base font-semibold truncate max-w-[40ch]" style={{ color: "var(--text-primary)" }}>{filename}</h1>
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          {fmtShort(totalLength)}{speakers.length > 1 ? ` · ${speakers.length} speakers` : ""}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs" aria-live="polite"
          style={{ color: saveState === "error" ? "var(--status-failed)" : saveState === "saving" ? "var(--text-tertiary)" : "#14732C" }}>
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && (<><Icon d={ICONS.check} size={13} />Saved</>)}
          {saveState === "error" && "Save failed, try again"}
        </span>
        <div className="flex-1" />
        <div role="tablist" aria-label="Mode" className="inline-flex p-[3px] gap-0.5 rounded-xl" style={{ backgroundColor: "var(--surface-raised)" }}>
          {(["edit", "proofread"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className="h-8 px-3.5 rounded-[9px] text-[13px] font-medium"
              style={mode === m
                ? { backgroundColor: "var(--surface)", color: "var(--brand-dark)", boxShadow: "0 1px 2px rgba(30,20,40,.12)" }
                : { color: "var(--text-secondary)" }}>
              {m === "edit" ? "Edit" : "Proofread"}
            </button>
          ))}
        </div>
        <button className={btn} style={btnStyle} onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts">
          <Icon d={ICONS.keys} />
        </button>
        <div className="relative" ref={exportRef}>
          <button className={btn} aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)}
            style={{ backgroundColor: "var(--brand-dark)", color: "#fff", border: "1px solid var(--brand-dark)" }}>
            <Icon d={ICONS.download} size={15} />Export<Icon d={ICONS.chevron} size={14} />
          </button>
          {exportOpen && (
            <div role="menu" className="absolute right-0 top-11 z-30 w-[340px] max-w-[calc(100vw-32px)] rounded-[14px] p-1.5"
              style={{ ...panel, boxShadow: "0 16px 40px rgba(30,20,40,.18)" }}>
              {Object.entries(downloads).map(([fmt, info]) => (
                <a key={fmt} role="menuitem" href={info.url} download onClick={() => setExportOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] hover:bg-[var(--surface-raised)]"
                  style={{ color: "var(--text-primary)" }}>
                  <span className="whitespace-nowrap">{EXPORT_LABELS[fmt]?.[0] ?? fmt.toUpperCase()}</span>
                  <span className="ml-auto text-[11px]" style={{ color: "var(--text-tertiary)" }}>{EXPORT_LABELS[fmt]?.[1] ?? ""}</span>
                </a>
              ))}
              <div className="my-1 mx-2" style={{ borderTop: "1px solid var(--border)" }} />
              <button role="menuitem" onClick={() => { copy(segments.map((s) => s.text).join(" "), "Transcript copied"); setExportOpen(false); }}
                className="w-full text-left flex items-center px-3 py-2.5 rounded-lg text-[13px] hover:bg-[var(--surface-raised)]"
                style={{ color: "var(--text-primary)" }}>Copy all text</button>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-5 items-stretch lg:h-[calc(100vh-200px)] lg:min-h-[520px]">

        {/* Player column */}
        <section aria-label="Player" className={`flex flex-col gap-3 min-w-0 shrink-0 lg:overflow-y-auto ${proofread ? "lg:w-[340px] lg:order-2" : "lg:w-[46%]"}`}>
          <div ref={playerRef} className="relative rounded-2xl overflow-hidden bg-black flex items-center justify-center" style={{ aspectRatio: "16 / 9" }}>
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full"
                onClick={togglePlay}
                onPlay={() => setPlaying(true)}
                onPause={() => { setPlaying(false); setTime(videoRef.current?.currentTime ?? 0); }}
                onSeeked={() => setTime(videoRef.current?.currentTime ?? 0)}
                onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
                onTimeUpdate={() => { if (!playing) setTime(videoRef.current?.currentTime ?? 0); }}
                playsInline
              />
            ) : (
              <span className="text-sm" style={{ color: "#9b8fa8" }}>Video not available</span>
            )}
            {caption && (
              <div className="absolute inset-x-0 bottom-[6%] flex justify-center pointer-events-none px-4">
                <span className="text-white text-[17px] font-medium px-3 py-1 rounded-md text-center" style={{ backgroundColor: "rgba(0,0,0,.72)" }}>
                  {caption.text}
                </span>
              </div>
            )}
          </div>

          {/* Transport */}
          <div className="flex flex-wrap items-center gap-2 rounded-[14px] px-3 py-2.5" style={panel}>
            <button className={btn} style={{ ...btnStyle, width: 36, padding: 0 }} onClick={() => skip(-5)} aria-label="Back 5 seconds"><Icon d={ICONS.back5} /></button>
            <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}
              className="inline-flex items-center justify-center w-11 h-11 rounded-full text-white"
              style={{ backgroundColor: "var(--brand-dark)" }}>
              <Icon d={playing ? ICONS.pause : ICONS.play} fill size={18} />
            </button>
            <button className={btn} style={{ ...btnStyle, width: 36, padding: 0 }} onClick={() => skip(5)} aria-label="Forward 5 seconds"><Icon d={ICONS.fwd5} /></button>
            <span className="font-mono text-[13px] tabular-nums ml-1" style={{ color: "var(--text-primary)" }}>
              {fmtClock(time)} <span style={{ color: "var(--text-tertiary)" }}>/ {fmtClock(totalLength)}</span>
            </span>
            <div className="flex-1" />
            <button className={btn} style={btnStyle} onClick={cycleRate} aria-label={`Playback speed ${rate}x`} title="Playback speed">{rate}×</button>
            <button className={btn} style={{ ...btnStyle, ...(cc ? { color: "var(--brand-dark)", border: "1px solid var(--brand-tint)", backgroundColor: "var(--brand-subtle)" } : {}) }}
              onClick={() => setCc((c) => !c)} aria-pressed={cc} title="Captions on the video">CC</button>
            <button className={btn} style={{ ...btnStyle, width: 36, padding: 0 }} aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }}>
              <Icon d={muted ? ICONS.mute : ICONS.sound} />
            </button>
            <button className={btn} style={{ ...btnStyle, width: 36, padding: 0 }} onClick={toggleFullscreen} aria-label="Full screen"><Icon d={ICONS.full} /></button>
          </div>

          {/* Timeline */}
          <div className="rounded-[14px] px-3.5 pt-3 pb-3" style={panel}>
            <div className="flex justify-between text-[11px] mb-2" style={{ color: "var(--text-tertiary)" }}>
              <span>Timeline</span>
              {unsure.length > 0 && <span><span style={{ color: "#B45309" }}>●</span> words to check</span>}
            </div>
            <div
              role="slider" tabIndex={0} aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(totalLength)} aria-valuenow={Math.round(time)}
              className="relative h-8 cursor-pointer rounded-lg"
              style={{ backgroundColor: "var(--surface-raised)" }}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                if (totalLength) seek(((e.clientX - r.left) / r.width) * totalLength, false);
              }}
            >
              <div className="absolute inset-y-0 left-0 rounded-lg" style={{ width: `${totalLength ? (time / totalLength) * 100 : 0}%`, backgroundColor: "var(--brand-tint)" }} />
              {totalLength > 0 && unsure.map((u, i) => (
                <span key={i} className="absolute bottom-1 w-[3px] h-2.5 rounded-sm" style={{ left: `${(u.start / totalLength) * 100}%`, backgroundColor: "#D97706" }} />
              ))}
              <span className="absolute -top-1 -bottom-1 w-0.5" style={{ left: `${totalLength ? (time / totalLength) * 100 : 0}%`, backgroundColor: "var(--brand-dark)" }} />
            </div>
          </div>

          {proofread && (
            <>
              <div className="rounded-[14px] px-4 py-3.5 flex flex-col gap-3" style={panel}>
                <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>Listening</span>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] flex-1" style={{ color: "var(--text-primary)" }}>Speed</span>
                  <div className="inline-flex p-0.5 gap-0.5 rounded-[10px]" style={{ backgroundColor: "var(--surface-raised)" }}>
                    {[0.75, 0.9, 1].map((r) => (
                      <button key={r} onClick={() => setRateTo(r)} aria-pressed={rate === r}
                        className="h-7 px-2.5 rounded-lg text-xs font-medium"
                        style={rate === r ? { backgroundColor: "var(--surface)", color: "var(--brand-dark)" } : { color: "var(--text-secondary)" }}>{r}×</button>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: "var(--text-primary)" }}>
                  <input type="checkbox" checked={pauseOnEdit} onChange={(e) => setPauseOnEdit(e.target.checked)} />Pause while I edit
                </label>
                <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: "var(--text-primary)" }}>
                  <input type="checkbox" checked={rewindOnResume} onChange={(e) => setRewindOnResume(e.target.checked)} />Rewind 2 s when I press play
                </label>
              </div>
              <div className="rounded-[14px] px-4 py-3.5 hidden lg:grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs items-center" style={{ ...panel, color: "var(--text-secondary)" }}>
                <Kbd>Tab</Kbd><span>Next unchecked paragraph</span>
                <Kbd>Ctrl Enter</Kbd><span>Mark checked and move on</span>
                <Kbd>Ctrl Space</Kbd><span>Play / pause</span>
                <Kbd>Ctrl J</Kbd><span>Replay the last 3 seconds</span>
                <Kbd>Double-click</Kbd><span>Edit a sentence</span>
              </div>
            </>
          )}
        </section>

        {/* Transcript column */}
        <section aria-label="Transcript" className="flex-1 min-w-0 h-[75vh] lg:h-auto lg:min-h-0 lg:order-1 rounded-2xl flex flex-col overflow-hidden" style={panel}>
          {proofread && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex-1 min-w-[220px] flex flex-col gap-1.5">
                <div className="flex justify-between text-[13px]">
                  <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{checkedCount} of {paragraphs.length} paragraphs checked</span>
                  <span style={{ color: "var(--text-tertiary)" }}>{paragraphs.length ? Math.round((checkedCount / paragraphs.length) * 100) : 0}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-raised)" }}>
                  <div className="h-full rounded-full" style={{ width: `${paragraphs.length ? (checkedCount / paragraphs.length) * 100 : 0}%`, backgroundColor: "#1F9D5C" }} />
                </div>
              </div>
              <button className={btn} onClick={() => goToNextUnchecked()}
                style={{ backgroundColor: "var(--brand-dark)", color: "#fff", border: "1px solid var(--brand-dark)" }}>
                Next unchecked <Kbd>Tab</Kbd>
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 px-3.5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <label className="flex-1 min-w-[200px] flex items-center gap-2 h-9 px-3 rounded-[10px]" style={{ border: "1px solid var(--border)", color: "var(--text-tertiary)" }}>
              <Icon d={ICONS.search} size={15} />
              <input
                ref={findRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setMatchIdx(0); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); goToMatch(e.shiftKey ? -1 : 1); } }}
                placeholder="Find in transcript"
                aria-label="Find in transcript"
                className="flex-1 bg-transparent outline-none text-[13px]"
                style={{ color: "var(--text-primary)" }}
              />
              {query.trim() ? (
                <span className="text-xs tabular-nums shrink-0">{matches.length ? `${Math.min(matchIdx + 1, matches.length)} of ${matches.length}` : "No matches"}</span>
              ) : (
                <Kbd>Ctrl F</Kbd>
              )}
            </label>
            <button className={btn} style={btnStyle} onClick={() => setShowReplace((r) => !r)} aria-expanded={showReplace}>Replace</button>
            {unsure.length > 0 && (
              <button className={btn} onClick={nextUnsure} title="Jump to the next word Whisper was unsure about (N)"
                style={{ color: "#92400E", border: "1px solid #F5D49A", backgroundColor: "#FFFBEB" }}>
                {unsure.length} {unsure.length === 1 ? "word" : "words"} to check
              </button>
            )}
          </div>

          {showReplace && (
            <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--border)", backgroundColor: "var(--surface-subtle)" }}>
              <input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Replace with"
                aria-label="Replace with" className="flex-1 min-w-[180px] h-9 px-3 rounded-[10px] text-[13px] outline-none"
                style={{ border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text-primary)" }} />
              <button className={btn} disabled={!matches.length} onClick={replaceEverything}
                style={{ backgroundColor: "var(--brand-dark)", color: "#fff", border: "1px solid var(--brand-dark)", opacity: matches.length ? 1 : 0.4 }}>
                Replace all {matches.length || ""}
              </button>
            </div>
          )}

          <div
            ref={scrollRef}
            className="relative flex-1 overflow-y-auto px-1.5 py-2"
            onWheel={() => { lastUserScroll.current = Date.now(); }}
            onTouchMove={() => { lastUserScroll.current = Date.now(); }}
            onMouseUp={() => setTimeout(readSelection, 0)}
            onScroll={() => selection && setSelection(null)}
          >
            {paragraphs.map((p, pi) => (
              <ParagraphBlock
                key={`${p.first}-${p.start}`}
                para={p}
                segments={segments}
                time={pi === activePara ? time : null}
                status={pi < activePara ? "past" : pi === activePara ? "active" : "future"}
                editing={editing !== null && editing.seg >= p.first && editing.seg <= p.last ? editing.seg : null}
                editWord={editing !== null && editing.seg >= p.first && editing.seg <= p.last ? editing.word : null}
                query={query}
                speakerColour={SPEAKER_COLOURS[Math.max(0, speakers.indexOf(p.speaker ?? "")) % SPEAKER_COLOURS.length]}
                showUnsure={showUnsure}
                onSeek={seek}
                onEdit={handleEdit}
                onSave={handleSave}
                onSplit={handleSplit}
                onCancel={handleCancel}
                proofread={proofread}
                checked={checkedFlags[pi]}
                onToggleCheck={toggleCheck}
              />
            ))}

            {selection && (
              <div role="toolbar" aria-label="Selection actions"
                className="absolute z-20 flex gap-0.5 p-1 rounded-[10px] -translate-x-1/2"
                style={{ left: Math.min(Math.max(170, selection.x), (scrollRef.current?.clientWidth ?? 600) - 170), top: selection.y, backgroundColor: "#2A2431", boxShadow: "0 6px 18px rgba(30,20,40,.25)" }}
                onMouseUp={(e) => e.stopPropagation()}>
                {[
                  ["Play selection", () => { seek(selection.start); stopAt.current = selection.end; setSelection(null); }],
                  ["Copy with timecode", () => { copy(`[${fmtClock(selection.start)}] ${selection.text}`, "Copied with timecode"); setSelection(null); }],
                  ["Copy", () => { copy(selection.text, "Copied"); setSelection(null); }],
                ].map(([label, fn]) => (
                  <button key={label as string} onClick={fn as () => void}
                    className="h-[30px] px-2.5 rounded-[7px] text-xs font-medium text-white whitespace-nowrap hover:bg-white/10">{label as string}</button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-xs" style={{ borderTop: "1px solid var(--border)", color: "var(--text-tertiary)" }}>
            <span>Click a word to jump · double-click to edit its sentence</span>
            <span><Kbd>Ctrl Space</Kbd> play / pause</span>
            <span><Kbd>?</Kbd> all shortcuts</span>
            {allUnsure.length > 0 && (
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showUnsure} onChange={(e) => setShowUnsure(e.target.checked)} />Show words Whisper was unsure about
              </label>
            )}
            <span className="ml-auto tabular-nums">{wordCount.toLocaleString()} words</span>
          </div>
        </section>
      </div>

      {fixOffer && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[min(560px,calc(100vw-32px))] rounded-2xl p-4 flex flex-col gap-3 text-white"
          style={{ backgroundColor: "#2A2431", boxShadow: "0 16px 40px rgba(30,20,40,.3)" }}>
          <span className="text-sm leading-relaxed">
            You changed <span className="line-through opacity-70">{fixOffer.from}</span> to <span className="font-semibold">{fixOffer.to}</span>.
            It appears <span className="font-semibold">{fixOffer.count} more {fixOffer.count === 1 ? "time" : "times"}</span> in this video.
          </span>
          <div className="flex flex-wrap gap-2">
            <button onClick={fixTheOthers} className="h-9 px-4 rounded-[10px] text-[13px] font-semibold" style={{ backgroundColor: "#fff", color: "#2A2431" }}>
              Fix all {fixOffer.count}
            </button>
            <button onClick={reviewTheOthers} className="h-9 px-4 rounded-[10px] text-[13px] font-medium" style={{ border: "1px solid #5B5566" }}>
              Review one by one
            </button>
            <button onClick={() => setFixOffer(null)} className="h-9 px-3 rounded-[10px] text-[13px] font-medium opacity-80">
              Just this one
            </button>
          </div>
        </div>
      )}

      {copied && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm text-white" style={{ backgroundColor: "#2A2431" }}>{copied}</div>
      )}

      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(26,3,21,.35)" }} onClick={() => setHelpOpen(false)}>
          <div role="dialog" aria-label="Keyboard shortcuts" className="w-full max-w-md rounded-2xl p-6" style={panel} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center mb-4">
              <h2 className="m-0 text-base font-semibold flex-1" style={{ color: "var(--text-primary)" }}>Keyboard shortcuts</h2>
              <button className={btn} style={btnStyle} onClick={() => setHelpOpen(false)}>Close</button>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[13px] items-center" style={{ color: "var(--text-secondary)" }}>
              <Kbd>Ctrl Space</Kbd><span>Play / pause, even while typing</span>
              <Kbd>Space</Kbd><span>Play / pause</span>
              <Kbd>← / →</Kbd><span>Back / forward 5 seconds</span>
              <Kbd>E</Kbd><span>Edit the sentence that is playing</span>
              <Kbd>N</Kbd><span>Next word to check</span>
              <Kbd>Ctrl F</Kbd><span>Find in transcript (Enter for next)</span>
              <Kbd>Enter</Kbd><span>Save an edit</span>
              <Kbd>Alt Enter</Kbd><span>Split the sentence at the cursor</span>
              <Kbd>Ctrl J</Kbd><span>Replay the last 3 seconds</span>
              <Kbd>Tab</Kbd><span>Proofread: next unchecked paragraph</span>
              <Kbd>Ctrl Enter</Kbd><span>Proofread: mark checked and move on</span>
              <Kbd>Esc</Kbd><span>Cancel / close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
