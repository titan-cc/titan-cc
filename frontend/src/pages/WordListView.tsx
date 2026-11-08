import { useMemo, useState } from "react";

// The team word list screen. Data and saving come from the page wrapper (WordList.tsx).

export type TermMode = "fix" | "context" | "hint";
export type TermKind = "person" | "brand" | "programme" | "place" | "term";

export interface VocabularyTerm {
  id: string;
  term: string;
  kind: TermKind;
  mode: TermMode;
  variants: string[];
  clues: string[];
  confirmations: number;
}

export interface TermDraft {
  term: string;
  kind: TermKind;
  mode: TermMode;
  variants: string[];
  clues: string[];
}

export const MAX_HINTS = 60;

const MODE_INFO: Record<TermMode, { label: string; help: string; colour: string; bg: string }> = {
  fix: {
    label: "Auto-correct",
    help: "Replace the exact spellings below every time. For names that are never everyday words.",
    colour: "#166534", bg: "#DCFCE7",
  },
  context: {
    label: "Suggest in context",
    help: "Never replaces on its own. Marks it for a person to accept when written in capitals or next to a clue word.",
    colour: "#92400E", bg: "#FEF3C7",
  },
  hint: {
    label: "Hint only",
    help: "Just tells Whisper the word exists.",
    colour: "#3730A3", bg: "#E0E7FF",
  },
};

const KIND_LABEL: Record<TermKind, string> = {
  person: "Person", brand: "Brand / product", programme: "Programme", place: "Place", term: "Term",
};

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function ModeBadge({ mode }: { mode: TermMode }) {
  const m = MODE_INFO[mode];
  return (
    <span className="inline-flex items-center h-6 px-2.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ color: m.colour, backgroundColor: m.bg }}>
      {m.label}
    </span>
  );
}

function Editor({
  initial, isNew, busy, error, onSave, onDelete, onClose,
}: {
  initial: TermDraft;
  isNew: boolean;
  busy: boolean;
  error: string | null;
  onSave: (d: TermDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState(initial.term);
  const [kind, setKind] = useState<TermKind>(initial.kind);
  const [mode, setMode] = useState<TermMode>(initial.mode);
  const [variants, setVariants] = useState(initial.variants.join(", "));
  const [clues, setClues] = useState(initial.clues.join(", "));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const field = "h-10 px-3 rounded-[10px] text-sm outline-none w-full";
  const fieldStyle = { border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text-primary)" };

  return (
    <aside aria-label={isNew ? "Add a word" : `Edit ${initial.term}`}
      className="w-full lg:w-[400px] shrink-0 rounded-2xl p-5 flex flex-col gap-4 self-start"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-lg font-semibold flex-1" style={{ color: "var(--text-primary)" }}>{isNew ? "Add a word" : initial.term}</h2>
        <button onClick={onClose} className="h-8 px-3 rounded-lg text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Close</button>
      </div>

      <label className="flex flex-col gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
        Correct spelling
        <input value={term} onChange={(e) => setTerm(e.target.value)} className={field} style={{ ...fieldStyle, fontWeight: 600 }} placeholder="e.g. Antano" />
      </label>

      <label className="flex flex-col gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
        Type
        <select value={kind} onChange={(e) => setKind(e.target.value as TermKind)} className={field} style={fieldStyle}>
          {(Object.keys(KIND_LABEL) as TermKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 m-0 p-0 border-0">
        <legend className="text-xs mb-1.5" style={{ color: "var(--text-secondary)" }}>What should Titan do?</legend>
        {(Object.keys(MODE_INFO) as TermMode[]).map((m) => (
          <label key={m} className="flex gap-2.5 items-start px-3 py-2.5 rounded-[10px] cursor-pointer text-sm"
            style={{ border: `1px solid ${mode === m ? MODE_INFO[m].colour : "var(--border)"}`, backgroundColor: mode === m ? MODE_INFO[m].bg : "var(--surface)" }}>
            <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} className="mt-1" />
            <span>
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{MODE_INFO[m].label}</span><br />
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{MODE_INFO[m].help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {mode !== "hint" && (
        <label className="flex flex-col gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          How Whisper sometimes writes it (separate with commas)
          <input value={variants} onChange={(e) => setVariants(e.target.value)} className={field} style={fieldStyle}
            placeholder={mode === "fix" ? "Anthano, Antanu" : "big, BIG"} />
        </label>
      )}

      {mode === "context" && (
        <label className="flex flex-col gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          Suggest it when these words are nearby (separate with commas)
          <input value={clues} onChange={(e) => setClues(e.target.value)} className={field} style={fieldStyle} placeholder="programme, cohort, session" />
          <span>It is also suggested whenever it is written in capitals (BIG).</span>
        </label>
      )}

      {error && <p role="alert" className="m-0 text-sm rounded-lg px-3 py-2" style={{ color: "#B42318", backgroundColor: "#FDE7E7" }}>{error}</p>}

      <div className="flex items-center gap-2">
        {onDelete && (confirmDelete ? (
          <>
            <span className="text-xs" style={{ color: "#B42318" }}>Remove {initial.term}?</span>
            <button onClick={onDelete} disabled={busy} className="h-9 px-3 rounded-[10px] text-xs font-semibold text-white" style={{ backgroundColor: "#B42318" }}>Remove</button>
            <button onClick={() => setConfirmDelete(false)} className="h-9 px-2 rounded-[10px] text-xs" style={{ color: "var(--text-secondary)" }}>Keep</button>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="h-9 px-3 rounded-[10px] text-xs font-medium" style={{ color: "#B42318" }}>Remove</button>
        ))}
        <div className="flex-1" />
        <button
          disabled={busy || !term.trim()}
          onClick={() => onSave({ term: term.trim(), kind, mode, variants: mode === "hint" ? [] : splitList(variants), clues: mode === "context" ? splitList(clues) : [] })}
          className="h-10 px-5 rounded-[10px] text-sm font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: "var(--brand-dark)" }}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </aside>
  );
}

export default function WordListView({
  terms, isAdmin, busy, error, onCreate, onUpdate, onDelete, onClearError,
}: {
  terms: VocabularyTerm[];
  isAdmin: boolean;
  busy: boolean;
  error: string | null;
  onCreate: (d: TermDraft) => Promise<boolean>;
  onUpdate: (id: string, d: TermDraft) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onClearError: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<"new" | string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? terms.filter((t) => t.term.toLowerCase().includes(q) || t.variants.some((v) => v.toLowerCase().includes(q))) : terms;
  }, [terms, query]);
  const editing = open && open !== "new" ? terms.find((t) => t.id === open) : null;

  function close() { setOpen(null); onClearError(); }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <h1 className="m-0 text-xl font-bold" style={{ color: "var(--text-primary)" }}>Word list</h1>
          <p className="m-0 mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Names, brands and terms Titan should always get right. Shared by the whole team and used on every new transcription.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => { onClearError(); setOpen("new"); }} className="h-10 px-4 rounded-[10px] text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-dark)" }}>
            Add word
          </button>
        )}
      </header>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        <section aria-label="Words" className="flex-1 min-w-0 w-full rounded-2xl overflow-hidden" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search words" aria-label="Search words"
              className="flex-1 min-w-[180px] h-9 px-3 rounded-[10px] text-sm outline-none"
              style={{ border: "1px solid var(--border)", color: "var(--text-primary)", backgroundColor: "var(--surface)" }} />
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{terms.length} {terms.length === 1 ? "word" : "words"}</span>
          </div>

          {terms.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="m-0 text-sm font-medium" style={{ color: "var(--text-primary)" }}>No words yet</p>
              <p className="m-0 mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                When someone fixes a name in a transcript, Titan offers to remember it. Remembered words show up here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm border-collapse">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
                    <th className="font-medium px-4 py-2.5">Correct spelling</th>
                    <th className="font-medium px-2 py-2.5">Type</th>
                    <th className="font-medium px-2 py-2.5">Whisper sometimes writes</th>
                    <th className="font-medium px-2 py-2.5">What Titan does</th>
                    <th className="font-medium px-4 py-2.5 text-right" title="Times someone confirmed it">Confirmed</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id}
                      onClick={isAdmin ? () => { onClearError(); setOpen(t.id); } : undefined}
                      className={isAdmin ? "cursor-pointer hover:bg-[var(--surface-raised)]" : ""}
                      style={{ borderTop: "1px solid var(--border)", backgroundColor: open === t.id ? "var(--brand-subtle)" : undefined }}>
                      <td className="px-4 py-3">
                        {isAdmin ? (
                          <button onClick={(e) => { e.stopPropagation(); onClearError(); setOpen(t.id); }} className="text-[15px] font-semibold text-left hover:underline" style={{ color: "var(--text-primary)" }}>{t.term}</button>
                        ) : (
                          <span className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>{t.term}</span>
                        )}
                      </td>
                      <td className="px-2 py-3" style={{ color: "var(--text-secondary)" }}>{KIND_LABEL[t.kind] ?? t.kind}</td>
                      <td className="px-2 py-3">
                        <span className="flex flex-wrap gap-1.5">
                          {t.variants.length ? t.variants.map((v) => (
                            <span key={v} className="inline-flex items-center h-6 px-2 rounded-md text-xs" style={{ backgroundColor: "var(--surface-raised)", color: "var(--text-secondary)" }}>{v}</span>
                          )) : <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>none yet</span>}
                        </span>
                      </td>
                      <td className="px-2 py-3"><ModeBadge mode={t.mode} /></td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>{t.confirmations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs" style={{ borderTop: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            <span className="flex-1 min-w-[220px]">
              {Math.min(terms.length, MAX_HINTS)} of {MAX_HINTS} words are sent to Whisper as hints, most-confirmed first.
              {!isAdmin && " Ask an admin to change a word."}
            </span>
            <div className="w-40 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-raised)" }}>
              <div className="h-full" style={{ width: `${Math.min(100, (terms.length / MAX_HINTS) * 100)}%`, backgroundColor: "var(--brand-dark)" }} />
            </div>
          </div>
        </section>

        {isAdmin && open && (open === "new" || editing) && (
          <Editor
            key={open}
            isNew={open === "new"}
            initial={editing ?? { term: "", kind: "person", mode: "fix", variants: [], clues: [] }}
            busy={busy}
            error={error}
            onClose={close}
            onSave={async (d) => {
              const ok = open === "new" ? await onCreate(d) : await onUpdate(open, d);
              if (ok) close();
            }}
            onDelete={editing ? async () => { if (await onDelete(editing.id)) close(); } : undefined}
          />
        )}
      </div>
    </div>
  );
}
