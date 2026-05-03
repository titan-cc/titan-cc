import { useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { ActivityLogEntry, ActivityLogResponse } from "@/api/types";

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
      {/* Dot */}
      <div className="mt-[5px] shrink-0">
        <span
          className="block h-2 w-2 rounded-full"
          style={{ backgroundColor: meta.dot }}
        />
      </div>

      {/* Main */}
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

      {/* Time */}
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
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-tertiary)";
            }}
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

      {/* Filter */}
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
          <>
            {Array.from({ length: 12 }).map((_, i) => <SkeletonRow key={i} />)}
          </>
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
