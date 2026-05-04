import { useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { ActivityLogEntry, ActivityLogResponse, ActivityStatsResponse } from "@/api/types";

// ── Date range ────────────────────────────────────────────────────────────────

type Preset = "today" | "yesterday" | "7d" | "30d" | "month" | "all";

interface DateRange {
  start: Date | null;
  end: Date | null;
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: "today",     label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d",        label: "Last 7 days" },
  { value: "30d",       label: "Last 30 days" },
  { value: "month",     label: "This month" },
  { value: "all",       label: "All time" },
];

function presetToRange(preset: Preset): DateRange {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay   = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  switch (preset) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "yesterday": {
      const y = new Date(now); y.setDate(now.getDate() - 1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case "7d": {
      const s = new Date(now); s.setDate(now.getDate() - 6);
      return { start: startOfDay(s), end: endOfDay(now) };
    }
    case "30d": {
      const s = new Date(now); s.setDate(now.getDate() - 29);
      return { start: startOfDay(s), end: endOfDay(now) };
    }
    case "month":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: endOfDay(now) };
    case "all":
      return { start: null, end: null };
  }
}

function toInputValue(d: Date | null): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Event metadata ─────────────────────────────────────────────────────────────

const EVENT_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  user_signup:        { label: "Sign up",        color: "#34d399", bg: "rgba(52,211,153,0.10)",  dot: "#34d399" },
  user_login:         { label: "Login",           color: "#60a5fa", bg: "rgba(96,165,250,0.10)",  dot: "#60a5fa" },
  job_submitted:      { label: "Job submitted",   color: "#a78bfa", bg: "rgba(167,139,250,0.10)", dot: "#a78bfa" },
  job_completed:      { label: "Completed",       color: "#34d399", bg: "rgba(52,211,153,0.10)",  dot: "#34d399" },
  job_failed:         { label: "Failed",          color: "#f87171", bg: "rgba(248,113,113,0.10)", dot: "#f87171" },
  job_cancelled:      { label: "Cancelled",       color: "#94a3b8", bg: "rgba(148,163,184,0.10)", dot: "#94a3b8" },
  job_retried:        { label: "Retried",         color: "#fbbf24", bg: "rgba(251,191,36,0.10)",  dot: "#fbbf24" },
  admin_update_user:  { label: "User updated",    color: "#f97316", bg: "rgba(249,115,22,0.10)",  dot: "#f97316" },
  admin_quota_refresh:{ label: "Quota reset",     color: "#f97316", bg: "rgba(249,115,22,0.10)",  dot: "#f97316" },
};

const DEFAULT_META = { label: "Event", color: "var(--text-secondary)", bg: "rgba(255,255,255,0.05)", dot: "#64748b" };

function eventMeta(type: string) {
  return EVENT_META[type] ?? DEFAULT_META;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function describeEvent(e: ActivityLogEntry): string {
  const m = e.metadata ?? {};
  switch (e.event_type) {
    case "job_submitted": {
      const filename = m.filename as string | null;
      const dur = m.duration_seconds as number | null;
      const durStr = dur ? ` (${Math.round(dur / 60)}m)` : "";
      return filename ? `Submitted "${filename}"${durStr}` : `Submitted a job${durStr}`;
    }
    case "job_completed": {
      const cost = m.cost_usd as number | null;
      const dur = m.duration_seconds as number | null;
      const durStr = dur ? ` · ${Math.round(dur / 60)}m` : "";
      const costStr = cost ? ` · $${cost.toFixed(4)}` : "";
      return `Job completed${durStr}${costStr}`;
    }
    case "job_failed":
      return `Job failed — ${(m.failure_code as string) ?? "unknown error"}`;
    case "job_cancelled":
      return "Job cancelled";
    case "job_retried":
      return "Manual retry triggered";
    case "user_signup":
      return "New account created";
    case "user_login":
      return "Signed in";
    case "admin_update_user": {
      const parts: string[] = [];
      if (m.role != null) parts.push(`role → ${m.role}`);
      if (m.is_enabled != null) parts.push(m.is_enabled ? "enabled" : "disabled");
      if (m.access_level != null) parts.push(`access → ${m.access_level}`);
      return parts.length ? `User updated: ${parts.join(", ")}` : "User updated";
    }
    case "admin_quota_refresh":
      return "Quota manually reset";
    default:
      return e.event_type.replace(/_/g, " ");
  }
}

// ── Stats strip ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  loading: boolean;
}) {
  return (
    <div
      className="flex-1 min-w-[140px] rounded-2xl px-5 py-4"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide mb-1" style={{ color: "var(--text-tertiary)" }}>
        {label}
      </p>
      {loading ? (
        <div className="h-7 w-24 rounded-lg animate-pulse" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
      ) : (
        <>
          <p className="text-[26px] font-bold tabular-nums leading-none" style={{ color: "var(--text-primary)" }}>
            {value}
          </p>
          {sub && (
            <p className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>{sub}</p>
          )}
        </>
      )}
    </div>
  );
}

function formatHours(h: number): string {
  if (h < 0.01) return "0h";
  if (h < 1) return `${Math.round(h * 60)}m`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins > 0 ? `${whole}h ${mins}m` : `${whole}h`;
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: ActivityLogEntry }) {
  const meta = eventMeta(event.event_type);
  const isAdmin = event.event_type.startsWith("admin_");
  const displayEmail = event.user_email ?? event.user_id?.slice(0, 8) ?? "unknown";
  const actorEmail = event.actor_email ?? event.actor_id?.slice(0, 8);

  return (
    <div
      className="flex items-start gap-4 px-5 py-3.5 transition-colors"
      style={{ borderBottom: "1px solid var(--border)" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.025)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
    >
      <div className="mt-[5px] shrink-0">
        <span className="block h-2 w-2 rounded-full" style={{ backgroundColor: meta.dot }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md"
            style={{ backgroundColor: meta.bg, color: meta.color }}
          >
            {meta.label}
          </span>
          <span className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
            {displayEmail}
          </span>
          {isAdmin && actorEmail && (
            <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              by {actorEmail}
            </span>
          )}
        </div>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
          {describeEvent(event)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className="text-[11px] tabular-nums"
          style={{ color: "var(--text-tertiary)" }}
          title={formatDate(event.created_at)}
        >
          {timeAgo(event.created_at)}
        </p>
      </div>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const FILTER_OPTIONS = [
  { value: "",                  label: "All" },
  { value: "user_login",        label: "Logins" },
  { value: "user_signup",       label: "Sign-ups" },
  { value: "job_submitted",     label: "Submissions" },
  { value: "job_completed",     label: "Completed" },
  { value: "job_failed",        label: "Failed" },
  { value: "admin_update_user", label: "Admin actions" },
];

function FilterBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {FILTER_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="text-[12px] font-medium px-3 py-1.5 rounded-xl transition-ui"
            style={{
              backgroundColor: active ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
              color: active ? "var(--text-primary)" : "var(--text-tertiary)",
              border: `1px solid ${active ? "rgba(255,255,255,0.15)" : "var(--border)"}`,
            }}
            onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
            onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-tertiary)"; }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-start gap-4 px-5 py-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="mt-[5px] h-2 w-2 rounded-full animate-pulse shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />
      <div className="flex-1 space-y-2">
        <div className="flex gap-2 items-center">
          <div className="h-4 w-16 rounded-md animate-pulse" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
          <div className="h-3 w-32 rounded-md animate-pulse" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
        </div>
        <div className="h-3 w-56 rounded-md animate-pulse" style={{ backgroundColor: "rgba(255,255,255,0.05)" }} />
      </div>
      <div className="h-3 w-12 rounded-md animate-pulse shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminActivity() {
  const { getToken } = useAuth();
  const [filter, setFilter] = useState("");
  const [preset, setPreset] = useState<Preset>("all");
  const [range, setRange] = useState<DateRange>({ start: null, end: null });

  function applyPreset(p: Preset) {
    setPreset(p);
    setRange(presetToRange(p));
  }

  function handleCustomDate(field: "start" | "end", value: string) {
    setPreset("all"); // deselect preset
    const d = value ? new Date(value) : null;
    if (d && field === "end") {
      // end of that day
      d.setHours(23, 59, 59, 999);
    }
    setRange((r) => ({ ...r, [field]: d }));
  }

  const statsParams = new URLSearchParams();
  if (range.start) statsParams.set("start", range.start.toISOString());
  if (range.end)   statsParams.set("end",   range.end.toISOString());

  const { data: stats, isLoading: statsLoading } = useQuery<ActivityStatsResponse>({
    queryKey: ["admin", "activity-stats", range.start?.toISOString(), range.end?.toISOString()],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch(`/admin/activity/stats?${statsParams}`, { token: token! });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, error } =
    useInfiniteQuery<ActivityLogResponse>({
      queryKey: ["admin", "activity", filter],
      queryFn: async ({ pageParam }) => {
        const token = await getToken();
        const params = new URLSearchParams({ limit: "50" });
        if (filter) params.set("event_type", filter);
        if (pageParam) params.set("cursor", String(pageParam));
        const res = await apiFetch(`/admin/activity?${params}`, { token: token! });
        if (!res.ok) throw new Error("Failed to fetch activity log");
        return res.json();
      },
      initialPageParam: null as number | null,
      getNextPageParam: (last) => last.next_cursor ?? null,
      staleTime: 30_000,
    });

  const allEvents = data?.pages.flatMap((p) => p.events) ?? [];

  const rangeLabel = (() => {
    if (!range.start && !range.end) return "all time";
    if (range.start && range.end) {
      const s = range.start.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
      const e = range.end.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
      return s === e ? s : `${s} – ${e}`;
    }
    if (range.start) return `from ${range.start.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
    return "";
  })();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Activity
        </h1>
        <p className="text-[13px] mt-1" style={{ color: "var(--text-secondary)" }}>
          Organisation-wide log of logins, jobs, and admin actions
        </p>
      </div>

      {/* Date range picker */}
      <div
        className="rounded-2xl px-5 py-4 space-y-3"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
      >
        {/* Preset pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {PRESETS.map((p) => {
            const active = preset === p.value;
            return (
              <button
                key={p.value}
                onClick={() => applyPreset(p.value)}
                className="text-[12px] font-medium px-3 py-1.5 rounded-xl transition-ui"
                style={{
                  backgroundColor: active ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
                  color: active ? "var(--text-primary)" : "var(--text-tertiary)",
                  border: `1px solid ${active ? "rgba(255,255,255,0.15)" : "var(--border)"}`,
                }}
                onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
                onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-tertiary)"; }}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Custom date inputs */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
              From
            </label>
            <input
              type="date"
              value={toInputValue(range.start)}
              onChange={(e) => handleCustomDate("start", e.target.value)}
              className="text-[12px] px-2.5 py-1.5 rounded-lg outline-none"
              style={{
                backgroundColor: "rgba(255,255,255,0.06)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
                colorScheme: "dark",
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>
              To
            </label>
            <input
              type="date"
              value={toInputValue(range.end)}
              onChange={(e) => handleCustomDate("end", e.target.value)}
              className="text-[12px] px-2.5 py-1.5 rounded-lg outline-none"
              style={{
                backgroundColor: "rgba(255,255,255,0.06)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
                colorScheme: "dark",
              }}
            />
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="flex gap-3 flex-wrap">
        <StatCard
          label="Hours transcribed"
          value={stats ? formatHours(stats.hours_transcribed) : "—"}
          sub={rangeLabel}
          loading={statsLoading}
        />
        <StatCard
          label="Jobs completed"
          value={stats ? String(stats.jobs_completed) : "—"}
          loading={statsLoading}
        />
        <StatCard
          label="Jobs submitted"
          value={stats ? String(stats.jobs_submitted) : "—"}
          loading={statsLoading}
        />
        <StatCard
          label="Jobs failed"
          value={stats ? String(stats.jobs_failed) : "—"}
          loading={statsLoading}
        />
      </div>

      {/* Event filter */}
      <FilterBar value={filter} onChange={(v) => setFilter(v)} />

      {/* Feed */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
      >
        {error ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[13px]" style={{ color: "#f87171" }}>
              Failed to load activity log.
            </p>
          </div>
        ) : isLoading ? (
          <>{Array.from({ length: 12 }).map((_, i) => <SkeletonRow key={i} />)}</>
        ) : allEvents.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
              No activity yet{filter ? " for this filter" : ""}.
            </p>
          </div>
        ) : (
          <>
            {allEvents.map((e) => <EventRow key={e.id} event={e} />)}
            {hasNextPage && (
              <div className="px-5 py-4 flex justify-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="text-[12px] font-medium px-4 py-2 rounded-xl transition-ui disabled:opacity-50"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.06)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
