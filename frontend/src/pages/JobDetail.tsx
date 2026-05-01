import { Link, useParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useTranscript } from "@/api/hooks";
import type { Job } from "@/api/types";
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-3 gap-6" style={{ borderBottom: "1px solid var(--border)" }}>
      <span className="text-xs font-medium uppercase tracking-wide shrink-0 pt-px" style={{ color: "var(--text-tertiary)" }}>
        {label}
      </span>
      <span className="text-sm text-right font-mono tabular-nums" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

const FORMAT_LABELS: Record<string, string> = {
  json: "JSON",
  srt: "SRT",
  txt: "Plain text",
};

function DownloadCard({ jobId }: { jobId: string }) {
  const { data, isLoading, error, refetch } = useTranscript(jobId, true);

  if (isLoading) {
    return (
      <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-card animate-pulse">
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-24 rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mt-4 bg-white border border-red-100 rounded-2xl p-5">
        <p className="text-sm text-red-600 font-medium mb-2">Could not load download links.</p>
        <button
          onClick={() => refetch()}
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  const formats = Object.keys(data.downloads);

  return (
    <div
      className="mt-4 rounded-2xl p-5 shadow-card"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border-strong, var(--border))" }}
    >
      <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-tertiary)" }}>
        Download transcript
      </p>
      <div className="flex flex-wrap gap-2">
        {formats.map((fmt) => (
          <a
            key={fmt}
            href={data.downloads[fmt].url}
            download
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium active:scale-[0.97] transition-ui shadow-sm"
            style={{ border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text-primary)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface-subtle)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface)")}
          >
            <svg className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {FORMAT_LABELS[fmt] ?? fmt.toUpperCase()}
          </a>
        ))}
      </div>
      <p className="text-[11px] mt-3" style={{ color: "var(--text-tertiary)" }}>
        Links expire in 5 minutes. Reload to refresh.
      </p>
    </div>
  );
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
    onSuccess: (updated) => {
      qc.setQueryData(["job", jobId], updated);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["failures"] });
    },
  });
  return (
    <button
      onClick={() => mutate()}
      disabled={isPending}
      className="btn-primary text-sm font-semibold px-4 py-2 rounded-xl text-white active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isPending ? "Retrying…" : "Retry"}
    </button>
  );
}

function CancelButton({ jobId }: { jobId: string }) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await apiFetch(`/jobs/${jobId}/cancel`, { method: "POST", token: token! });
      return res.json();
    },
    onSuccess: (updated) => {
      qc.setQueryData(["job", jobId], updated);
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  return (
    <button
      onClick={() => mutate()}
      disabled={isPending}
      className="text-sm font-medium px-4 py-2 rounded-xl active:scale-[0.97] transition-ui disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ border: "1px solid var(--border)", color: "var(--text-secondary)", backgroundColor: "var(--surface)" }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface-subtle)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface)")}
    >
      {isPending ? "Cancelling…" : "Cancel"}
    </button>
  );
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();

  const { data: job, isLoading, error } = useQuery<Job>({
    queryKey: ["job", id],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch(`/jobs/${id}`, { token: token! });
      return res.json();
    },
    refetchInterval: (query) => {
      const j = query.state.data;
      return j && !isTerminal(j.status) ? 3000 : false;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="max-w-lg animate-pulse space-y-4">
        <div className="h-4 w-24 bg-slate-100 rounded-full" />
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="h-5 w-20 bg-slate-100 rounded-full mb-6" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex justify-between py-3 border-b border-slate-100">
              <div className="h-3 w-16 bg-slate-100 rounded-full" />
              <div className="h-3 w-24 bg-slate-100 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-lg">
        <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-ui mb-6">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Jobs
        </Link>
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4">
          <p className="text-sm font-medium text-red-700">Job not found or access denied.</p>
        </div>
      </div>
    );
  }

  const cancellable = ["queued", "dispatched", "processing"].includes(job.status);

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
        Jobs
      </Link>

      <div
        className="rounded-2xl p-5 shadow-card"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border-strong, var(--border))" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <StatusBadge status={job.status} />
          <span className="text-[11px] font-mono tabular-nums" style={{ color: "#d0d2d5" }}>{job.id.slice(0, 8)}</span>
        </div>

        {/* Progress bar for all active states */}
        {(job.status === "queued" || job.status === "dispatched" || job.status === "processing") && (
          <div
            className="mb-5 p-3.5 rounded-xl"
            style={{ backgroundColor: "var(--surface-subtle)", border: "1px solid var(--border)" }}
          >
            <div className="flex justify-between text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
              <span className="font-medium">
                {job.status === "queued" && "Waiting in queue"}
                {job.status === "dispatched" && "Waiting for GPU…"}
                {job.status === "processing" && (job.current_stage ?? "Transcribing…")}
              </span>
              {job.status === "processing" && job.progress_pct != null && (
                <span className="font-mono tabular-nums">{job.progress_pct}%</span>
              )}
            </div>
            {job.status === "processing" && job.progress_pct != null ? (
              <ProgressBar pct={job.progress_pct} />
            ) : (
              <ProgressBar indeterminate />
            )}
          </div>
        )}

        {/* Failure banner */}
        {job.status === "failed" && (
          <div
            className="mb-5 rounded-xl px-4 py-3"
            style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca" }}
          >
            <p className="text-xs font-semibold mb-0.5 font-mono" style={{ color: "var(--status-failed)" }}>
              {job.failure_code ?? "UNKNOWN_ERROR"}
            </p>
            <p className="text-sm" style={{ color: "#991b1b" }}>
              {job.failure_message ?? "The transcription failed."}
            </p>
          </div>
        )}

        {/* Meta rows */}
        {job.input_filename && (
          <MetaRow
            label="File"
            value={
              <span className="truncate max-w-[220px] block text-right" title={job.input_filename} style={{ fontFamily: "inherit", fontWeight: 400 }}>
                {job.input_filename}
              </span>
            }
          />
        )}
        <MetaRow label="Duration" value={formatDuration(job.input_duration_seconds)} />
        <MetaRow label="Retries" value={job.retry_count} />
        <MetaRow label="Created" value={formatDate(job.created_at)} />
        {job.started_at && <MetaRow label="Started" value={formatDate(job.started_at)} />}
        {job.completed_at && <MetaRow label="Completed" value={formatDate(job.completed_at)} />}
        <MetaRow label="Expires" value={formatDate(job.expires_at)} />
      </div>

      {/* View Transcript + Downloads */}
      {job.status === "completed" && (
        <>
          <div className="mt-4">
            <Link
              to={`/jobs/${job.id}/transcript`}
              className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold active:scale-[0.97]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
              View Transcript
            </Link>
          </div>
          <DownloadCard jobId={job.id} />
        </>
      )}

      {/* Actions */}
      {(job.status === "failed" || cancellable) && (
        <div className="mt-4 flex gap-2">
          {job.status === "failed" && <RetryButton jobId={job.id} />}
          {cancellable && <CancelButton jobId={job.id} />}
        </div>
      )}
    </div>
  );
}
