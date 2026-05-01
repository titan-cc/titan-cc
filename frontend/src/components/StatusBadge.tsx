import type { JobStatus } from "@/api/types";

const STATUS: Record<JobStatus, { dot: string; label: string; textColor: string; pulse?: boolean }> = {
  queued:     { dot: "#9b8fa8",                    textColor: "#9b8fa8",                    label: "Queued"     },
  dispatched: { dot: "var(--status-dispatched)",   textColor: "var(--status-dispatched)",   label: "Dispatched" },
  processing: { dot: "var(--status-processing)",   textColor: "var(--status-processing)",   label: "Processing", pulse: true },
  completed:  { dot: "var(--status-completed)",    textColor: "var(--status-completed)",    label: "Completed"  },
  failed:     { dot: "var(--status-failed)",       textColor: "var(--status-failed)",       label: "Failed"     },
  cancelled:  { dot: "#d4c9db",                    textColor: "#9b8fa8",                    label: "Cancelled"  },
  expired:    { dot: "#e8e0ec",                    textColor: "#b09dbf",                    label: "Expired"    },
};

export default function StatusBadge({ status }: { status: JobStatus }) {
  const { dot, textColor, label, pulse } = STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: textColor }}>
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${pulse ? "animate-pulse-brand" : ""}`}
        style={{ backgroundColor: dot }}
      />
      {label}
    </span>
  );
}
