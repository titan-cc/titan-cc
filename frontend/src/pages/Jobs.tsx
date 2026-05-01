import { Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { JobListResponse } from "@/api/types";
import StatusBadge from "@/components/StatusBadge";
import ProgressBar from "@/components/ProgressBar";
import { isTerminal } from "@/lib/poll";

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between px-5 py-4 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-3 w-16 rounded-full bg-slate-100" />
        <div className="h-3 w-24 rounded-full bg-slate-100" />
      </div>
      <div className="h-3 w-12 rounded-full bg-slate-100" />
    </div>
  );
}

export default function Jobs() {
  const { getToken } = useAuth();

  const { data, isLoading, error } = useQuery<JobListResponse>({
    queryKey: ["jobs"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/jobs?limit=50", { token: token! });
      return res.json();
    },
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      return jobs.some((j) => !isTerminal(j.status)) ? 5000 : false;
    },
  });

  const jobs = data?.jobs ?? [];

  return (
    <div>
      <div className="flex items-end justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>Jobs</h1>
          {!isLoading && !error && (
            <p className="text-sm mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {jobs.length === 0 ? "No transcriptions yet" : `${jobs.length} job${jobs.length !== 1 ? "s" : ""}`}
            </p>
          )}
        </div>
        <Link
          to="/upload"
          className="btn-primary inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-xl text-white active:scale-[0.97]"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          New
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4">
          <p className="text-sm font-medium text-red-700">Failed to load jobs.</p>
        </div>
      )}

      {(isLoading || (!error && jobs.length > 0)) && (
        <div
          className="rounded-2xl overflow-hidden shadow-card divide-y"
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
        >
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
            : jobs.map((job) => (
                <Link
                  key={job.id}
                  to={`/jobs/${job.id}`}
                  className="flex flex-col px-5 py-4 transition-ui group"
                  style={{ borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface-subtle)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "")}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <StatusBadge status={job.status} />
                      {job.input_filename ? (
                        <span className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                          {job.input_filename}
                        </span>
                      ) : (
                        <span className="text-sm font-mono tabular-nums truncate" style={{ color: "var(--text-tertiary)" }}>
                          {job.id.slice(0, 8)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs" style={{ color: "var(--text-tertiary)" }}>
                      <span className="font-mono">{formatDuration(job.input_duration_seconds)}</span>
                      <span>{timeAgo(job.created_at)}</span>
                      <svg
                        className="h-3.5 w-3.5 transition-ui"
                        style={{ color: "#d0d2d5" }}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                  {job.status === "processing" && job.progress_pct != null && (
                    <div className="mt-2.5">
                      <div className="flex justify-between text-[11px] mb-1.5" style={{ color: "var(--text-tertiary)" }}>
                        <span>{job.current_stage ?? "processing"}</span>
                        <span className="font-mono">{job.progress_pct}%</span>
                      </div>
                      <ProgressBar pct={job.progress_pct} />
                    </div>
                  )}
                </Link>
              ))}
        </div>
      )}

      {!isLoading && !error && jobs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="p-4 rounded-2xl mb-4" style={{ backgroundColor: "var(--surface-subtle)" }}>
            <svg className="h-8 w-8" style={{ color: "var(--text-tertiary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>No transcriptions yet</p>
          <p className="text-xs mt-1 mb-5" style={{ color: "var(--text-tertiary)" }}>Upload a file to create your first job</p>
          <Link
            to="/upload"
            className="btn-primary text-sm font-semibold px-4 py-2 rounded-xl text-white active:scale-[0.98]"
          >
            Upload a file
          </Link>
        </div>
      )}
    </div>
  );
}
