import { Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { FailureClass, Job, JobListResponse } from "@/api/types";

type GroupMeta = {
  label: string;
  description: string;
  canRetry: boolean;
  pillStyle: React.CSSProperties;
  pillBorder: string;
};

const CLASS_META: Record<FailureClass, GroupMeta> = {
  user_content:     { label: "File issues",      description: "The uploaded file could not be processed.",        canRetry: false, pillStyle: { color: "#b45309", backgroundColor: "#fffbeb" }, pillBorder: "#fcd34d" },
  user_quota:       { label: "Quota exceeded",   description: "Monthly usage limit was reached.",                 canRetry: false, pillStyle: { color: "var(--brand-dark)", backgroundColor: "var(--brand-subtle)" }, pillBorder: "var(--brand-tint)" },
  system_transient: { label: "System error",     description: "Temporary failure — automatic retries exhausted.", canRetry: true,  pillStyle: { color: "#991b1b", backgroundColor: "#fef2f2" }, pillBorder: "#fecaca" },
  system_permanent: { label: "System error",     description: "Unrecoverable worker failure.",                    canRetry: true,  pillStyle: { color: "#991b1b", backgroundColor: "#fef2f2" }, pillBorder: "#fecaca" },
  timeout:          { label: "Timed out",        description: "Job exceeded the processing time limit.",          canRetry: true,  pillStyle: { color: "#c2410c", backgroundColor: "#fff7ed" }, pillBorder: "#fed7aa" },
  cancelled:        { label: "Cancelled",        description: "Cancelled by you.",                                canRetry: false, pillStyle: { color: "var(--text-tertiary)", backgroundColor: "var(--surface-raised)" }, pillBorder: "var(--border)" },
};

const FAILURE_CODE_MESSAGES: Record<string, string> = {
  FILE_UNREADABLE:     "File appears corrupt — try re-exporting.",
  FILE_NO_AUDIO_TRACK: "No audio track found.",
  AUDIO_TOO_QUIET:     "No speech detected.",
  FILE_TOO_LONG:       "File exceeds maximum duration.",
  GPU_OOM:             "Ran out of GPU memory.",
  S3_DOWNLOAD_FAILED:  "Network error downloading file.",
  WORKER_CRASHED:      "Worker crashed unexpectedly.",
  JOB_TIMEOUT:         "Exceeded processing time limit.",
  QUOTA_EXCEEDED:      "Monthly transcription limit reached.",
};

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

function RetryButton({ jobId }: { jobId: string }) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await apiFetch(`/jobs/${jobId}/retry`, { method: "POST", token: token! });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["failures"] });
    },
  });
  return (
    <button
      onClick={(e) => { e.preventDefault(); mutate(); }}
      disabled={isPending}
      className="btn-primary text-[11px] font-semibold px-2.5 py-1.5 rounded-lg active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
    >
      {isPending ? "…" : "Retry"}
    </button>
  );
}

function FailureGroup({ meta, jobs }: { cls: FailureClass; meta: GroupMeta; jobs: Job[] }) {
  return (
    <section className="mb-9">
      <div className="flex items-center gap-3 mb-3">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg"
          style={{ ...meta.pillStyle, border: `1px solid ${meta.pillBorder}` }}
        >
          {meta.label}
        </span>
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          {jobs.length} job{jobs.length !== 1 ? "s" : ""}
        </span>
        <span className="text-xs" style={{ color: "#d0d2d5" }}>·</span>
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{meta.description}</span>
      </div>

      <div
        className="rounded-2xl overflow-hidden shadow-card"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border-strong, var(--border))" }}
      >
        {jobs.map((job) => {
          const message = job.failure_code
            ? (FAILURE_CODE_MESSAGES[job.failure_code] ?? job.failure_message)
            : job.failure_message;

          return (
            <Link
              key={job.id}
              to={`/jobs/${job.id}`}
              className="flex items-center gap-4 px-5 py-4 transition-ui group"
              style={{ borderBottom: "1px solid var(--border)" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface-subtle)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "")}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  {job.input_filename ? (
                    <span className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                      {job.input_filename}
                    </span>
                  ) : (
                    <span className="text-sm font-mono tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {job.id.slice(0, 8)}
                    </span>
                  )}
                  {job.failure_code && (
                    <span
                      className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded shrink-0"
                      style={{ color: "var(--text-tertiary)", backgroundColor: "var(--surface-subtle)" }}
                    >
                      {job.failure_code}
                    </span>
                  )}
                </div>
                <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{message ?? "Unknown error"}</p>
                <p className="text-[11px] mt-0.5 font-mono" style={{ color: "var(--text-tertiary)" }}>
                  {formatDuration(job.input_duration_seconds)} · {timeAgo(job.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {meta.canRetry && <RetryButton jobId={job.id} />}
                <svg
                  className="h-3.5 w-3.5 transition-ui"
                  style={{ color: "#d0d2d5" }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const RENDER_ORDER: FailureClass[] = [
  "system_transient", "system_permanent", "timeout",
  "user_content", "user_quota", "cancelled",
];

export default function Failures() {
  const { getToken } = useAuth();

  const { data, isLoading, error } = useQuery<JobListResponse>({
    queryKey: ["failures"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/jobs?status=failed&limit=100", { token: token! });
      return res.json();
    },
  });

  const jobs = data?.jobs ?? [];

  const grouped = new Map<FailureClass, Job[]>();
  for (const job of jobs) {
    const cls = (job.failure_class ?? "system_permanent") as FailureClass;
    if (!grouped.has(cls)) grouped.set(cls, []);
    grouped.get(cls)!.push(job);
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>Failures</h1>
          {!isLoading && !error && (
            <p className="text-sm mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {jobs.length === 0 ? "No failed jobs" : `${jobs.length} failed job${jobs.length !== 1 ? "s" : ""}`}
            </p>
          )}
        </div>
        <Link to="/jobs" className="text-sm text-slate-500 hover:text-slate-700 transition-ui">
          All jobs
        </Link>
      </div>

      {isLoading && (
        <div className="space-y-3 animate-pulse">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {[1, 2, 3].map((j) => (
                <div key={j} className="flex items-center gap-4 px-5 py-4 border-b border-slate-100 last:border-0">
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-28 bg-slate-100 rounded-full" />
                    <div className="h-3 w-48 bg-slate-100 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4">
          <p className="text-sm font-medium text-red-700">Failed to load failures.</p>
        </div>
      )}

      {!isLoading && !error && jobs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="p-4 rounded-2xl mb-4" style={{ backgroundColor: "var(--surface-subtle)" }}>
            <svg className="h-8 w-8" style={{ color: "#39B54A" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>All clear</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>No failed jobs at the moment.</p>
        </div>
      )}

      {!isLoading && !error && jobs.length > 0 && RENDER_ORDER.map((cls) => {
        const group = grouped.get(cls);
        if (!group?.length) return null;
        return <FailureGroup key={cls} cls={cls} meta={CLASS_META[cls]} jobs={group} />;
      })}
    </div>
  );
}
