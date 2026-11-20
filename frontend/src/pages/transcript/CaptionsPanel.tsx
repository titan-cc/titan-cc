import { memo, useCallback, useEffect, useRef, useState } from "react";
import { LIMITS, overLimit, type Caption, type CaptionSettings } from "./captions";

// Captions mode: one setting (caption length) and three hand actions:
// split (click the gap between words), merge with next, fix a word (double-click).

function fmt(t: number): string {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${sec.toFixed(1).padStart(4, "0")}`;
}

function WordEditor({ word, onSave, onCancel }: { word: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(word);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && value.trim() && value.trim() !== word) onSave(value.trim());
    else onCancel();
  };
  return (
    <input
      ref={ref}
      value={value}
      aria-label={`Fix the word ${word}`}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
      }}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      size={Math.max(value.length + 1, 3)}
      className="px-1 rounded-[4px] outline-none text-[16px]"
      style={{ border: "1.5px solid var(--brand)", backgroundColor: "var(--surface)", color: "var(--text-primary)", font: "inherit" }}
    />
  );
}

interface RowProps {
  cap: Caption;
  index: number;
  isLast: boolean;
  active: boolean;
  selected: boolean;
  over: boolean;
  limitLabel: string;
  onSelect: (i: number) => void;
  onSeek: (t: number) => void;
  onSplit: (i: number, k: number) => void;
  onMerge: (i: number) => void;
  onFixWord: (seg: number, wi: number, value: string) => void;
}

const CaptionRow = memo(function CaptionRow({
  cap, index, isLast, active, selected, over, limitLabel, onSelect, onSeek, onSplit, onMerge, onFixWord,
}: RowProps) {
  const [editing, setEditing] = useState<number | null>(null);
  const count = cap.text.length;

  return (
    <div
      data-cap={index}
      onClick={() => onSelect(index)}
      className="grid items-center gap-x-3.5 px-4 py-3 cursor-pointer"
      style={{
        gridTemplateColumns: "34px 96px minmax(0,1fr)",
        borderTop: "1px solid var(--border)",
        backgroundColor: selected || active ? "var(--brand-subtle)" : undefined,
        boxShadow: selected ? "inset 3px 0 0 var(--brand-dark)" : undefined,
      }}
    >
      <span className="text-xs tabular-nums" style={{ color: selected || active ? "var(--brand-dark)" : "var(--text-tertiary)", fontWeight: selected || active ? 600 : 400 }}>
        {index + 1}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onSelect(index); onSeek(cap.start); }}
        className="text-left font-mono text-[11px] leading-[1.5] tabular-nums hover:underline"
        style={{ color: "var(--text-tertiary)" }}
        title="Play this caption"
      >
        {fmt(cap.start)}<br />{fmt(cap.end)}
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
        <span className="text-[16px] leading-[1.6] min-w-0" style={{ color: "var(--text-primary)", fontWeight: selected ? 500 : 400 }}>
          {cap.words.map((w, k) => (
            <span key={`${w.seg}-${w.wi}`} className="inline">
              {k > 0 && (
                // The space between two words is itself the split button, so copied text
                // still reads normally; <wbr> keeps a line-break opportunity on narrow screens.
                <>
                  <button
                    className="cap-gap"
                    aria-label={`Split before "${w.word}"`}
                    title="Split here"
                    onClick={(e) => { e.stopPropagation(); onSplit(index, k); }}
                  >{" "}</button>
                  <wbr />
                </>
              )}
              {editing === k ? (
                <WordEditor word={w.word} onCancel={() => setEditing(null)}
                  onSave={(v) => { setEditing(null); onFixWord(w.seg, w.wi, v); }} />
              ) : (
                <span
                  onClick={(e) => { e.stopPropagation(); onSelect(index); onSeek(w.start); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditing(k); }}
                  className="rounded-[3px] hover:bg-[var(--surface-raised)]"
                  title="Click to play · double-click to fix"
                >
                  {w.word}
                </span>
              )}
            </span>
          ))}
          <span className="ml-2 text-[11px] tabular-nums align-middle rounded-md"
            style={over
              ? { color: "#92400E", backgroundColor: "#FEF3C7", padding: "1px 6px" }
              : { color: "var(--text-tertiary)" }}>
            {over ? `${count} · longer than ${limitLabel}` : count}
          </span>
        </span>
        {selected && !isLast && (
          <button
            onClick={(e) => { e.stopPropagation(); onMerge(index); }}
            className="ml-auto h-8 px-3 rounded-lg text-xs font-medium whitespace-nowrap"
            style={{ border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text-primary)" }}
          >
            Merge with next
          </button>
        )}
      </div>
    </div>
  );
});

function CaptionsPanel({
  captions, settings, activeIdx, playing, onSeek, onSplit, onMerge, onFixWord, onApply,
}: {
  captions: Caption[];
  settings: CaptionSettings;
  activeIdx: number;
  playing: boolean;
  onSeek: (t: number) => void;
  onSplit: (i: number, k: number) => void;
  onMerge: (i: number) => void;
  onFixWord: (seg: number, wi: number, value: string) => void;
  onApply: (s: CaptionSettings) => void;
}) {
  const [by, setBy] = useState(settings.by);
  const [value, setValue] = useState(settings.value);
  const [selected, setSelected] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastUserScroll = useRef(0);

  useEffect(() => { setBy(settings.by); setValue(settings.value); }, [settings.by, settings.value]);

  // Follow playback, unless the person scrolled in the last 4 seconds.
  useEffect(() => {
    if (!playing || activeIdx < 0 || Date.now() - lastUserScroll.current < 4000) return;
    listRef.current?.querySelector(`[data-cap="${activeIdx}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIdx, playing]);

  const handleSplit = useCallback((ci: number, k: number) => { onSplit(ci, k); setSelected(ci + 1); }, [onSplit]);

  const limits = LIMITS[by];
  const clamp = (n: number) => Math.min(limits.max, Math.max(limits.min, n));
  const manual = settings.manual ?? 0;
  const unchanged = by === settings.by && value === settings.value && manual === 0;
  const limitLabel = settings.by === "words" ? `${settings.value} words` : String(settings.value);
  const overCount = captions.filter((c) => overLimit(c, settings)).length;

  function apply() {
    if (manual > 0 && !confirming) { setConfirming(true); return; }
    setConfirming(false);
    setSelected(null);
    onApply({ by, value: clamp(value), manual: 0 });
  }

  const segBtn = (on: boolean) => on
    ? { backgroundColor: "var(--surface)", color: "var(--brand-dark)", boxShadow: "0 1px 2px rgba(30,20,40,.12)" }
    : { color: "var(--text-secondary)" };

  return (
    <section aria-label="Captions" className="flex-1 min-w-0 h-[75vh] lg:h-auto lg:min-h-0 lg:order-1 rounded-2xl flex flex-col overflow-hidden"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}>
      <style>{`.cap-gap{display:inline;font:inherit;line-height:inherit;color:inherit;padding:0 0.08em;margin:0;border:0;border-radius:2px;background:transparent;cursor:col-resize}
.cap-gap:hover,.cap-gap:focus-visible{background:var(--brand-dark);outline:none}`}</style>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Caption length</span>
        <div role="radiogroup" aria-label="Measure by" className="inline-flex p-[3px] gap-0.5 rounded-xl" style={{ backgroundColor: "var(--surface-raised)" }}>
          {(["chars", "words"] as const).map((b) => (
            <button key={b} role="radio" aria-checked={by === b}
              onClick={() => { setBy(b); setValue(b === settings.by ? settings.value : b === "words" ? 5 : 42); setConfirming(false); }}
              className="h-8 px-3 rounded-[9px] text-[13px] font-medium" style={segBtn(by === b)}>
              {b === "chars" ? "Characters" : "Words"}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center rounded-[10px] overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <button aria-label="Fewer" onClick={() => { setValue((v) => clamp(v - 1)); setConfirming(false); }}
            className="w-9 h-9 text-lg" style={{ color: "var(--text-secondary)" }}>−</button>
          <input aria-label={by === "chars" ? "Characters per caption" : "Words per caption"} value={value} inputMode="numeric"
            onChange={(e) => { const n = parseInt(e.target.value, 10); setValue(Number.isFinite(n) ? n : limits.min); setConfirming(false); }}
            onBlur={() => setValue((v) => clamp(v))}
            className="w-11 h-9 text-center font-mono text-[15px] outline-none bg-transparent" style={{ color: "var(--text-primary)" }} />
          <button aria-label="More" onClick={() => { setValue((v) => clamp(v + 1)); setConfirming(false); }}
            className="w-9 h-9 text-lg" style={{ color: "var(--text-secondary)" }}>+</button>
        </div>
        <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {by === "chars" ? "characters" : "words"} per caption · always one line
        </span>
        <div className="flex-1" />
        {manual > 0 && !confirming && (
          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{manual} manual {manual === 1 ? "change" : "changes"}</span>
        )}
        {confirming ? (
          <span className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "#92400E" }}>
            This replaces your {manual} manual {manual === 1 ? "change" : "changes"}.
            <button onClick={apply} className="h-8 px-3 rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: "var(--brand-dark)" }}>Replace</button>
            <button onClick={() => setConfirming(false)} className="h-8 px-2 rounded-lg text-xs" style={{ color: "var(--text-secondary)" }}>Cancel</button>
          </span>
        ) : (
          <button onClick={apply} disabled={unchanged}
            className="h-9 px-3.5 rounded-[10px] text-[13px] font-medium disabled:opacity-40"
            style={{ border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text-primary)" }}>
            Apply to all
          </button>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto"
        onWheel={() => { lastUserScroll.current = Date.now(); }}
        onTouchMove={() => { lastUserScroll.current = Date.now(); }}>
        <div className="grid gap-x-3.5 px-4 py-2 text-[11px] uppercase tracking-wide sticky top-0 z-10"
          style={{ gridTemplateColumns: "34px 96px minmax(0,1fr)", color: "var(--text-tertiary)", backgroundColor: "var(--surface)" }}>
          <span>#</span><span>Time</span><span>Caption</span>
        </div>
        {captions.map((c, i) => (
          <CaptionRow
            key={`${c.start}-${i}`}
            cap={c}
            index={i}
            isLast={i === captions.length - 1}
            active={i === activeIdx}
            selected={i === selected}
            over={overLimit(c, settings)}
            limitLabel={limitLabel}
            onSelect={setSelected}
            onSeek={onSeek}
            onSplit={handleSplit}
            onMerge={onMerge}
            onFixWord={onFixWord}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-xs" style={{ borderTop: "1px solid var(--border)", color: "var(--text-tertiary)" }}>
        <span>Click the gap between words to split · select a caption to merge · double-click a word to fix it</span>
        <span className="ml-auto tabular-nums">
          {captions.length.toLocaleString()} captions{overCount > 0 && ` · ${overCount} longer than ${limitLabel}`}
        </span>
      </div>
    </section>
  );
}

// Playback redraws the screen every frame; only redraw captions when their inputs change.
export default memo(CaptionsPanel);
