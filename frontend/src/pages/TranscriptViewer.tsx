import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { Job, TranscriptResponse } from "@/api/types";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
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

// ── Player view ────────────────────────────────────────────────────────────────

function PlayerView({
  videoUrl,
  segments,
}: {
  videoUrl: string | null | undefined;
  segments: TranscriptSegment[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const allSpeakers = [...new Set(segments.map((s) => s.speaker).filter(Boolean))] as string[];

  // Find the last segment whose start ≤ currentTime (segments are ordered)
  let activeIdx = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].start <= currentTime) activeIdx = i;
    else break;
  }

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
      <div className="lg:w-1/2 flex flex-col">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
            className="w-full rounded-2xl bg-black"
            style={{ maxHeight: "100%", border: "1px solid var(--border)" }}
          />
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
            const colour = speakerColour(seg.speaker, allSpeakers);
            return (
              <div
                key={i}
                ref={isActive ? activeRef : null}
                onClick={() => seekTo(seg.start)}
                className="px-3 py-2 rounded-xl cursor-pointer transition-ui select-none border"
                style={
                  isActive
                    ? { backgroundColor: "var(--brand-subtle)", borderColor: "var(--brand-tint)" }
                    : { borderColor: "transparent" }
                }
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface-raised)"; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-[11px] font-mono shrink-0 pt-0.5 tabular-nums w-10" style={{ color: "var(--text-tertiary)" }}>
                    {fmtTime(seg.start)}
                  </span>
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
                    <span
                      className="text-sm leading-relaxed"
                      style={{ color: isActive ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: isActive ? 500 : 400 }}
                    >
                      {seg.text}
                    </span>
                  </div>
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
      {/* Search bar */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
            style={{ color: "var(--text-tertiary)" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
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

      {/* Text content */}
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

function SpeakerView({ segments }: { segments: TranscriptSegment[] }) {
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

  // Merge consecutive segments from the same speaker
  const groups: { speaker: string; segs: TranscriptSegment[] }[] = [];
  for (const seg of segments) {
    const spk = seg.speaker ?? "Unknown";
    const last = groups[groups.length - 1];
    if (last && last.speaker === spk) {
      last.segs.push(seg);
    } else {
      groups.push({ speaker: spk, segs: [seg] });
    }
  }

  return (
    <div className="max-w-2xl space-y-3">
      {groups.map((g, i) => {
        const colour = speakerColour(g.speaker, allSpeakers);
        const start = g.segs[0].start;
        const end = g.segs[g.segs.length - 1].end;
        return (
          <div
            key={i}
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
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {g.segs.map((s) => s.text).join(" ")}
            </p>
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

// ── Main component ─────────────────────────────────────────────────────────────

export default function TranscriptViewer() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const [tab, setTab] = useState<Tab>("player");

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
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!id,
    staleTime: 4 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const jsonUrl = meta?.downloads?.json?.url;

  const { data: content, isLoading: contentLoading } = useQuery<TranscriptContent>({
    queryKey: ["transcript-content", jsonUrl],
    queryFn: () => fetch(jsonUrl!).then((r) => r.json()),
    enabled: !!jsonUrl,
    staleTime: 4 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const segments = content?.segments ?? [];
  const hasSpeakers = segments.some((s) => s.speaker);

  if (metaLoading || contentLoading) return <Skeleton />;

  if (!meta || !content) {
    return (
      <div className="max-w-lg">
        <Link
          to={`/jobs/${id}`}
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
            to={`/jobs/${id}`}
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
        <TabBar tab={tab} onTab={setTab} hasSpeakers={hasSpeakers} />

        {/* Export download buttons — matches wireframe header */}
        {meta && (
          <div className="flex items-center gap-1.5 shrink-0">
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                {fmt.toUpperCase()}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Tab content */}
      {tab === "player" && <PlayerView videoUrl={meta.video_url} segments={segments} />}
      {tab === "text" && <TextView segments={segments} />}
      {tab === "speaker" && <SpeakerView segments={segments} />}
    </div>
  );
}
