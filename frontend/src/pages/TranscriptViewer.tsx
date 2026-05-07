import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { Job, TranscriptResponse } from "@/api/types";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  words?: unknown[];
}

interface TranscriptContent {
  job_id: string;
  segments: TranscriptSegment[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Tab bar ────────────────────────────────────────────────────────────────────

type Tab = "player" | "text" | "speaker";

function TabBar({
  tab,
  onTab,
  hasSpeakers,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  hasSpeakers: boolean;
}) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "player", label: "Player" },
    { id: "text", label: "Text" },
    ...(hasSpeakers ? [{ id: "speaker" as Tab, label: "Speakers" }] : []),
  ];
  return (
    <div className="flex gap-1 rounded-xl p-1" style={{ backgroundColor: "var(--surface-subtle)" }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onTab(t.id)}
          className="px-4 py-1.5 rounded-lg text-sm font-medium transition-ui"
          style={
            tab === t.id
              ? { backgroundColor: "var(--surface)", color: "var(--brand)", boxShadow: "0 1px 3px rgba(236,0,140,0.12)" }
              : { color: "var(--text-tertiary)" }
          }
          onMouseEnter={(e) => { if (tab !== t.id) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
          onMouseLeave={(e) => { if (tab !== t.id) (e.currentTarget as HTMLElement).style.color = "var(--text-tertiary)"; }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Speaker colour palette ─────────────────────────────────────────────────────

const SPEAKER_COLOURS = [
  { pillText: "#0076A3", pillBg: "#e6f6fd", dot: "#00AEEF" },
  { pillText: "#14732C", pillBg: "#e8f5eb", dot: "#39B54A" },
  { pillText: "#62005A", pillBg: "#f5e6f5", dot: "#9A258F" },
  { pillText: "#7a4a00", pillBg: "#fff4d6", dot: "#FFC20E" },
  { pillText: "#A70063", pillBg: "#fce8f3", dot: "#EC008C" },
];

function speakerColour(speaker: string | undefined, allSpeakers: string[]) {
  if (!speaker) return SPEAKER_COLOURS[0];
  const idx = allSpeakers.indexOf(speaker) % SPEAKER_COLOURS.length;
  return SPEAKER_COLOURS[Math.max(idx, 0)];
}

// ── Inline segment editor ──────────────────────────────────────────────────────

function SegmentEditor({
  text,
  saving,
  onSave,
  onCancel,
  onSplit,
}: {
  text: string;
  saving: boolean;
  onSave: (newText: string) => void;
  onCancel: () => void;
  onSplit: (text1: string, text2: string) => void;
}) {
  const [value, setValue] = useState(text);
  const [cursorPos, setCursorPos] = useState(text.length);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const len = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(len, len);
    setCursorPos(len);
  }, []);

  function updateCursor() {
    setCursorPos(ref.current?.selectionStart ?? value.length);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(value.trim()); }
  }

  function handleSplit() {
    const before = value.slice(0, cursorPos).trimEnd();
    const after = value.slice(cursorPos).trimStart();
    if (before && after) onSplit(before, after);
  }

  const canSplit = cursorPos > 0 && cursorPos < value.length
    && value.slice(0, cursorPos).trim().length > 0
    && value.slice(cursorPos).trim().length > 0;

  return (
    <div className="flex-1 min-w-0">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onSelect={updateCursor}
        onClick={updateCursor}
        onKeyUp={updateCursor}
        rows={Math.max(2, Math.ceil(value.length / 60))}
        className="w-full text-sm leading-relaxed resize-none rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2"
        style={{
          border: "1px solid var(--brand)",
          color: "var(--text-primary)",
          backgroundColor: "var(--surface)",
        }}
        disabled={saving}
      />
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <button
          onClick={() => onSave(value.trim())}
          disabled={saving || value.trim() === text.trim()}
          className="px-3 py-1 rounded-lg text-xs font-medium transition-ui disabled:opacity-40"
          style={{ backgroundColor: "var(--brand)", color: "#fff" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={handleSplit}
          disabled={saving || !canSplit}
          className="px-3 py-1 rounded-lg text-xs font-medium transition-ui disabled:opacity-40 flex items-center gap-1"
          style={{ border: "1px solid var(--brand)", color: "var(--brand)", backgroundColor: "var(--surface)" }}
          title="Split segment at cursor position"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 7h8M8 12h8M8 17h4M3 7l2 5-2 5" />
          </svg>
          Split here
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1 rounded-lg text-xs font-medium transition-ui"
          style={{ border: "1px solid var(--border)", color: "var(--text-secondary)", backgroundColor: "var(--surface)" }}
        >
          Cancel
        </button>
        <span className="text-[10px] ml-auto" style={{ color: "var(--text-tertiary)" }}>
          Ctrl+↵ save · Esc cancel · place cursor then Split
        </span>
      </div>
    </div>
  );
}

// ── Player view ────────────────────────────────────────────────────────────────

function PlayerView({
  videoUrl,
  segments,
  editingIdx,
  saving,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onSplitEdit,
}: {
  videoUrl: string | null | undefined;
  segments: TranscriptSegment[];
  editingIdx: number | null;
  saving: boolean;
  onStartEdit: (idx: number) => void;
  onSaveEdit: (idx: number, text: string) => void;
  onCancelEdit: () => void;
  onSplitEdit: (idx: number, text1: string, text2: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);

  const allSpeakers = [...new Set(segments.map((s) => s.speaker).filter(Boolean))] as string[];

  let activeIdx = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].start <= currentTime) activeIdx = i;
    else break;
  }

  // Caption text: only show while inside the active segment's time range
  const captionText =
    captionsEnabled && activeIdx >= 0 && segments[activeIdx].end >= currentTime
      ? segments[activeIdx].text
      : null;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx]);

  function seekTo(t: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = t;
    videoRef.current.play().catch(() => {});
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4" style={{ height: "calc(100vh - 224px)", minHeight: 400 }}>
      {/* Video panel */}
      <div className="lg:w-1/2 flex flex-col gap-2">
        {/* CC toggle — sits in the same row as the video, flush right */}
        <div className="flex items-center justify-end">
          <button
            onClick={() => setCaptionsEnabled(!captionsEnabled)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-ui"
            style={
              captionsEnabled
                ? { backgroundColor: "var(--brand)", color: "#fff" }
                : { border: "1px solid var(--border)", color: "var(--text-secondary)", backgroundColor: "var(--surface)" }
            }
            title={captionsEnabled ? "Hide captions" : "Show captions below video"}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 8h10M7 12h6m-8 8h14a2 2 0 002-2V6a2 2 0 00-2-2H3a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            CC
          </button>
        </div>

        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
              className="w-full rounded-2xl bg-black"
              style={{ border: "1px solid var(--border)" }}
            />
            {/* Caption bar — always reserves space when CC is on to prevent layout shift */}
            {captionsEnabled && (
              <div
                className="rounded-xl px-4 py-2.5 text-sm text-center leading-snug min-h-[2.5rem] flex items-center justify-center"
                style={{ backgroundColor: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              >
                {captionText ?? <span style={{ color: "var(--text-tertiary)" }}>—</span>}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 rounded-2xl flex items-center justify-center"
            style={{ border: "1px solid var(--border)", backgroundColor: "var(--surface-subtle)" }}>
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Video not available</p>
          </div>
        )}
      </div>

      {/* Transcript panel */}
      <div
        className="lg:w-1/2 rounded-2xl overflow-y-auto shadow-card"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div className="p-3 space-y-0.5">
          {segments.map((seg, i) => {
            const isActive = i === activeIdx;
            const isEditing = editingIdx === i;
            const colour = speakerColour(seg.speaker, allSpeakers);
            return (
              <div
                key={i}
                ref={isActive ? activeRef : null}
                className={`group px-3 py-2 rounded-xl border transition-ui${!isEditing ? " cursor-pointer" : ""}`}
                style={
                  isEditing
                    ? { backgroundColor: "var(--surface-raised)", borderColor: "var(--brand-tint)" }
                    : isActive
                    ? { backgroundColor: "var(--brand-subtle)", borderColor: "var(--brand-tint)", cursor: "pointer" }
                    : { borderColor: "transparent", cursor: "pointer" }
                }
                onClick={() => { if (!isEditing) seekTo(seg.start); }}
                onMouseEnter={(e) => { if (!isActive && !isEditing) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface-raised)"; }}
                onMouseLeave={(e) => { if (!isActive && !isEditing) (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
              >
                <div className="flex items-start gap-2.5">
                  {/* Timestamp — click to seek */}
                  <button
                    onClick={(e) => { e.stopPropagation(); seekTo(seg.start); }}
                    className="text-[11px] font-mono shrink-0 pt-0.5 tabular-nums w-10 text-left"
                    style={{ color: "var(--text-tertiary)" }}
                    title="Jump to this position"
                  >
                    {fmtTime(seg.start)}
                  </button>

                  <div className="flex-1 min-w-0">
                    {seg.speaker && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full mr-1.5"
                        style={{ color: colour.pillText, backgroundColor: colour.pillBg }}
                      >
                        <span className="h-1 w-1 rounded-full" style={{ backgroundColor: colour.dot }} />
                        {seg.speaker.replace("SPEAKER_", "S")}
                      </span>
                    )}

                    {isEditing ? (
                      <SegmentEditor
                        text={seg.text}
                        saving={saving}
                        onSave={(newText) => onSaveEdit(i, newText)}
                        onCancel={onCancelEdit}
                        onSplit={(t1, t2) => onSplitEdit(i, t1, t2)}
                      />
                    ) : (
                      <span
                        className="text-sm leading-relaxed"
                        style={{
                          color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                          fontWeight: isActive ? 500 : 400,
                        }}
                      >
                        {seg.text}
                      </span>
                    )}
                  </div>

                  {/* Edit pencil */}
                  {!isEditing && (
                    <button
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onStartEdit(i); }}
                      className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-lg transition-ui"
                      style={{ color: "var(--text-tertiary)" }}
                      title="Edit segment"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Text view ──────────────────────────────────────────────────────────────────

function TextView({ segments }: { segments: TranscriptSegment[] }) {
  const [query, setQuery] = useState("");
  const fullText = segments.map((s) => s.text).join(" ");

  const parts = query.trim()
    ? fullText.split(new RegExp(`(${escapeRegex(query)})`, "gi"))
    : [fullText];

  const matchCount = query.trim()
    ? (fullText.match(new RegExp(escapeRegex(query), "gi")) ?? []).length
    : 0;

  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
            style={{ color: "var(--text-tertiary)" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcript…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              backgroundColor: "var(--surface)",
            }}
          />
        </div>
        {query.trim() && (
          <span className="text-xs shrink-0 tabular-nums" style={{ color: "var(--text-tertiary)" }}>
            {matchCount} match{matchCount !== 1 ? "es" : ""}
          </span>
        )}
      </div>

      <div className="rounded-2xl p-6 shadow-card text-sm leading-loose"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
        {parts.map((chunk, i) =>
          query && chunk.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5 not-italic">
              {chunk}
            </mark>
          ) : (
            <span key={i}>{chunk}</span>
          )
        )}
      </div>
    </div>
  );
}

// ── Speaker view ───────────────────────────────────────────────────────────────

function SpeakerView({
  segments,
  editingIdx,
  saving,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onSplitEdit,
}: {
  segments: TranscriptSegment[];
  editingIdx: number | null;
  saving: boolean;
  onStartEdit: (idx: number) => void;
  onSaveEdit: (idx: number, text: string) => void;
  onCancelEdit: () => void;
  onSplitEdit: (idx: number, text1: string, text2: string) => void;
}) {
  const allSpeakers = [...new Set(segments.map((s) => s.speaker).filter(Boolean))] as string[];

  if (allSpeakers.length === 0) {
    return (
      <div className="rounded-2xl p-8 text-center max-w-md"
        style={{ border: "1px solid var(--border)", backgroundColor: "var(--surface-subtle)" }}>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Speaker diarization was not enabled for this job.
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
          Re-submit with diarization enabled to see speaker attribution.
        </p>
      </div>
    );
  }

  const groups: { speaker: string; segs: { idx: number; seg: TranscriptSegment }[] }[] = [];
  segments.forEach((seg, idx) => {
    const spk = seg.speaker ?? "Unknown";
    const last = groups[groups.length - 1];
    if (last && last.speaker === spk) {
      last.segs.push({ idx, seg });
    } else {
      groups.push({ speaker: spk, segs: [{ idx, seg }] });
    }
  });

  return (
    <div className="max-w-2xl space-y-3">
      {groups.map((g, gi) => {
        const colour = speakerColour(g.speaker, allSpeakers);
        const start = g.segs[0].seg.start;
        const end = g.segs[g.segs.length - 1].seg.end;
        return (
          <div
            key={gi}
            className="rounded-2xl p-4 shadow-card"
            style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between mb-2.5">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                style={{ color: colour.pillText, backgroundColor: colour.pillBg }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colour.dot }} />
                {g.speaker.replace("SPEAKER_", "Speaker ")}
              </span>
              <span className="text-[11px] font-mono tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                {fmtTime(start)} → {fmtTime(end)}
              </span>
            </div>
            <div className="space-y-1.5">
              {g.segs.map(({ idx, seg }) => (
                <div key={idx} className="group flex items-start gap-2">
                  {editingIdx === idx ? (
                    <SegmentEditor
                      text={seg.text}
                      saving={saving}
                      onSave={(newText) => onSaveEdit(idx, newText)}
                      onCancel={onCancelEdit}
                      onSplit={(t1, t2) => onSplitEdit(idx, t1, t2)}
                    />
                  ) : (
                    <>
                      <span className="text-sm leading-relaxed flex-1" style={{ color: "var(--text-secondary)" }}>
                        {seg.text}
                      </span>
                      <button
                        onClick={() => onStartEdit(idx)}
                        className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-lg transition-ui mt-0.5"
                        style={{ color: "var(--text-tertiary)" }}
                        title="Edit segment"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center justify-between mb-6">
        <div className="h-4 w-24 rounded-full" style={{ backgroundColor: "var(--surface-raised)" }} />
        <div className="h-9 w-48 rounded-xl" style={{ backgroundColor: "var(--surface-raised)" }} />
      </div>
      <div className="flex gap-4" style={{ height: 480 }}>
        <div className="flex-1 rounded-2xl" style={{ backgroundColor: "var(--surface-raised)" }} />
        <div className="flex-1 rounded-2xl" style={{ backgroundColor: "var(--surface-raised)" }} />
      </div>
    </div>
  );
}

// ── Save toast ─────────────────────────────────────────────────────────────────

function SavedBadge({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
      style={{ backgroundColor: "#e8f5eb", color: "#14732C" }}
    >
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
      Saved
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TranscriptViewer() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("player");
  const [localSegments, setLocalSegments] = useState<TranscriptSegment[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [savedVisible, setSavedVisible] = useState(false);

  const { data: job } = useQuery<Job>({
    queryKey: ["job", id],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch(`/jobs/${id}`, { token: token! });
      return res.json();
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: meta, isLoading: metaLoading } = useQuery<TranscriptResponse>({
    queryKey: ["transcript", id],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch(`/jobs/${id}/transcript`, { token: token! });
      return res.json();
    },
    enabled: !!id,
    staleTime: 4 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 4 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  const jsonUrl = meta?.downloads?.json?.url;

  const { data: content, isLoading: contentLoading } = useQuery<TranscriptContent>({
    queryKey: ["transcript-content", jsonUrl],
    queryFn: () => fetch(jsonUrl!).then((r) => r.json()),
    enabled: !!jsonUrl,
    staleTime: 4 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (content?.segments) setLocalSegments(content.segments);
  }, [content]);

  const hasSpeakers = localSegments.some((s) => s.speaker);

  const saveMutation = useMutation({
    mutationFn: async (segments: TranscriptSegment[]) => {
      const token = await getToken();
      const res = await apiFetch(`/jobs/${id}/transcript`, {
        token: token!,
        method: "PUT",
        body: JSON.stringify({ segments }),
      });
      return res.json() as Promise<TranscriptResponse>;
    },
    onSuccess: (updatedMeta, savedSegments) => {
      queryClient.setQueryData(["transcript", id], updatedMeta);
      // Populate the new content cache key directly — avoids a round-trip to S3
      // and prevents the content query from entering a loading state (which would
      // unmount the viewer and snap scroll back to top).
      const newJsonUrl = updatedMeta.downloads?.json?.url;
      if (newJsonUrl) {
        queryClient.setQueryData<TranscriptContent>(["transcript-content", newJsonUrl], {
          job_id: id!,
          segments: savedSegments,
        });
      }
      setEditingIdx(null);
      setSavedVisible(true);
      setTimeout(() => setSavedVisible(false), 2500);
    },
  });

  function handleStartEdit(idx: number) {
    setEditingIdx(idx);
  }

  function handleSaveEdit(idx: number, newText: string) {
    const updated = localSegments.map((seg, i) =>
      i === idx ? { ...seg, text: newText } : seg
    );
    setLocalSegments(updated);
    saveMutation.mutate(updated);
  }

  function handleSplitEdit(idx: number, text1: string, text2: string) {
    const original = localSegments[idx];
    // Split time proportional to character count (best approximation without word-level data)
    const totalChars = text1.length + text2.length;
    const splitTime = totalChars > 0
      ? original.start + (original.end - original.start) * (text1.length / totalChars)
      : (original.start + original.end) / 2;

    const seg1: TranscriptSegment = {
      start: original.start,
      end: Math.round(splitTime * 1000) / 1000,
      text: text1,
      speaker: original.speaker,
    };
    const seg2: TranscriptSegment = {
      start: Math.round(splitTime * 1000) / 1000,
      end: original.end,
      text: text2,
      speaker: original.speaker,
    };

    const updated = [
      ...localSegments.slice(0, idx),
      seg1,
      seg2,
      ...localSegments.slice(idx + 1),
    ];
    setLocalSegments(updated);
    saveMutation.mutate(updated);
  }

  function handleCancelEdit() {
    setEditingIdx(null);
  }

  // Only block the UI on the very first load — never during post-save refetches
  // where localSegments is already populated and the viewer should stay mounted.
  if ((metaLoading || contentLoading) && localSegments.length === 0) return <Skeleton />;

  if (!meta || (!content && localSegments.length === 0)) {
    return (
      <div className="max-w-lg">
        <Link
          to="/jobs"
          className="inline-flex items-center gap-1.5 text-sm transition-ui mb-6"
          style={{ color: "var(--text-tertiary)" }}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to job
        </Link>
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4">
          <p className="text-sm font-medium text-red-700">Transcript unavailable.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Link
            to="/jobs"
            className="inline-flex items-center gap-1.5 text-sm transition-ui shrink-0"
            style={{ color: "var(--text-tertiary)" }}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </Link>
          {job?.input_filename && (
            <>
              <span style={{ color: "var(--border-strong, var(--border))" }}>/</span>
              <span className="text-sm font-medium truncate" style={{ color: "var(--text-secondary)" }}>
                {job.input_filename}
              </span>
            </>
          )}
        </div>

        <TabBar tab={tab} onTab={(t) => { setTab(t); setEditingIdx(null); }} hasSpeakers={hasSpeakers} />

        <div className="flex items-center gap-2 shrink-0">
          <SavedBadge visible={savedVisible} />

          {/* Download buttons */}
          {meta && (
            <div className="flex items-center gap-1.5">
              {Object.entries(meta.downloads).map(([fmt, info]) => (
                <a
                  key={fmt}
                  href={info.url}
                  download
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-ui"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)", backgroundColor: "var(--surface)" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface-raised)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface)")}
                >
                  <svg className="h-3 w-3" style={{ color: "var(--text-tertiary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  {fmt.toUpperCase()}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Save error */}
      {saveMutation.isError && (
        <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5">
          <p className="text-sm text-red-700">Save failed — please try again.</p>
        </div>
      )}

      {/* Tab content */}
      {tab === "player" && (
        <PlayerView
          videoUrl={meta.video_url}
          segments={localSegments}
          editingIdx={editingIdx}
          saving={saveMutation.isPending}
          onStartEdit={handleStartEdit}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={handleCancelEdit}
          onSplitEdit={handleSplitEdit}
        />
      )}
      {tab === "text" && <TextView segments={localSegments} />}
      {tab === "speaker" && (
        <SpeakerView
          segments={localSegments}
          editingIdx={editingIdx}
          saving={saveMutation.isPending}
          onStartEdit={handleStartEdit}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={handleCancelEdit}
          onSplitEdit={handleSplitEdit}
        />
      )}
    </div>
  );
}
