import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { PresignResponse, Job, UserMeResponse } from "@/api/types";

interface WorkerStatus {
  warm: boolean;
  idle_workers: number;
  running_workers: number;
}

type Stage = "idle" | "ready" | "uploading" | "creating" | "error";

interface FileInfo {
  file: File;
  durationSeconds: number;
  idempotencyKey: string;
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function detectDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = file.type.startsWith("video/")
      ? document.createElement("video")
      : document.createElement("audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (!isFinite(el.duration) || el.duration <= 0) {
        reject(new Error("Could not detect audio duration. Check the file format."));
        return;
      }
      resolve(Math.ceil(el.duration));
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read file. Is it a valid audio or video file?"));
    };
    el.src = url;
  });
}

function xhrPost(
  url: string,
  fields: Record<string, string>,
  file: File,
  onProgress: (pct: number) => void,
  xhrRef: React.MutableRefObject<XMLHttpRequest | null>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // S3 presigned POST requires multipart/form-data with all policy fields
    // appended BEFORE the file. Field order matters — S3 ignores anything
    // after the file field.
    const formData = new FormData();
    for (const [k, v] of Object.entries(fields)) formData.append(k, v);
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      xhrRef.current = null;
      // S3 presigned POST returns 204 on success (no success_action_status set)
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status} — ${xhr.responseText}`));
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      reject(new Error("Network error during upload."));
    };
    xhr.onabort = () => {
      xhrRef.current = null;
      reject(new Error("Upload cancelled."));
    };
    xhr.send(formData);
  });
}

const ACCEPTED = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
  "audio/ogg", "audio/flac", "audio/m4a", "audio/aac",
  "audio/mp4", "audio/webm",
  "video/mp4", "video/quicktime", "video/x-msvideo",
  "video/webm", "video/x-matroska",
].join(",");

const SUPPORTED_FORMATS = ["MP3", "WAV", "MP4", "MOV", "M4A", "FLAC", "OGG", "WebM", "MKV"];

function UploadIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function FileIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function QuotaMeter({ usedMinutes, maxMinutes, resetAt }: { usedMinutes: number; maxMinutes: number; resetAt: string }) {
  const pct = Math.min(100, Math.round((usedMinutes / maxMinutes) * 100));
  const remaining = Math.max(0, maxMinutes - usedMinutes);
  const isWarning = pct >= 80;
  const isCritical = pct >= 95;

  const barColor = isCritical
    ? "var(--status-failed)"
    : isWarning
    ? "var(--status-processing)"
    : "var(--brand)";

  const resetDate = new Date(resetAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-tertiary)" }}>
        Monthly quota
      </p>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: "var(--text-secondary)" }}>
            {remaining} min remaining
          </span>
          <span className="font-mono tabular-nums" style={{ color: isCritical ? "var(--status-failed)" : isWarning ? "var(--status-processing)" : "var(--text-tertiary)" }}>
            {usedMinutes} / {maxMinutes}
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-raised)" }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, backgroundColor: barColor }}
          />
        </div>
        {isWarning && (
          <p className="text-[11px]" style={{ color: isWarning ? barColor : "var(--text-tertiary)" }}>
            {isCritical ? "Almost out — new quota resets" : "Running low — resets"} {resetDate}
          </p>
        )}
        {!isWarning && (
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Resets {resetDate}
          </p>
        )}
      </div>
    </div>
  );
}

export default function Upload() {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [warmingUp, setWarmingUp] = useState(false);

  const busy = stage === "uploading" || stage === "creating";

  // Block in-app navigation during an active upload
  const blocker = useBlocker(busy);

  // Block tab close / refresh during an active upload
  useEffect(() => {
    if (!busy) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy]);

  const { data: workerStatus } = useQuery<WorkerStatus>({
    queryKey: ["worker-status"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/system/worker-status", { token: token! });
      return res.json();
    },
    refetchInterval: warmingUp ? 5_000 : 30_000,
    staleTime: 4_000,
  });

  const handleWarmup = async () => {
    if (warmingUp || workerStatus?.warm) return;
    setWarmingUp(true);
    try {
      const token = await getToken();
      await apiFetch("/system/warmup", { method: "POST", token: token! });
    } catch {
      // best-effort; polling will still detect when warm
    }
  };

  // Stop warmup spinner once worker is detected as warm
  if (warmingUp && workerStatus?.warm) setWarmingUp(false);

  const { data: me } = useQuery<UserMeResponse>({
    queryKey: ["me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/users/me", { token: token! });
      return res.json();
    },
    staleTime: 60_000,
  });

  const handleFile = useCallback(async (file: File) => {
    setStage("idle");
    setErrorMsg("");
    setUploadPct(0);
    try {
      const durationSeconds = await detectDuration(file);
      setFileInfo({ file, durationSeconds, idempotencyKey: crypto.randomUUID() });
      setStage("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to read file.");
      setStage("error");
    }
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onSubmit = async () => {
    if (!fileInfo) return;
    const { file, durationSeconds, idempotencyKey } = fileInfo;
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");

      setStage("uploading");
      setUploadPct(0);
      const presignRes = await apiFetch("/uploads/presign", {
        method: "POST",
        token,
        body: JSON.stringify({
          filename: file.name,
          content_type: file.type,
          size_bytes: file.size,
          duration_seconds: durationSeconds,
        }),
      });
      const { upload_url, form_fields, s3_key } = (await presignRes.json()) as PresignResponse;

      await xhrPost(upload_url, form_fields, file, setUploadPct, xhrRef);

      setStage("creating");
      const jobRes = await apiFetch("/jobs", {
        method: "POST",
        token,
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          s3_key,
          filename: file.name,
          duration_seconds: durationSeconds,
          config: { language: "en", enable_diarization: false, output_formats: ["json", "srt", "txt"] },
        }),
      });
      const job = (await jobRes.json()) as Job;
      navigate(`/jobs/${job.id}`);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Upload failed.");
      setStage("error");
    }
  };

  const hasFile = fileInfo && stage !== "idle";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-10 items-start">

      {/* Navigation-away confirmation dialog */}
      {blocker.state === "blocked" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 space-y-4"
            style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <div>
              <h2 className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>
                Upload in progress
              </h2>
              <p className="text-[13px] mt-1.5" style={{ color: "var(--text-secondary)" }}>
                Leaving now will cancel the upload. Your file will not be transcribed.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => blocker.reset()}
                className="flex-1 py-2 rounded-xl text-[13px] font-semibold transition-ui"
                style={{
                  backgroundColor: "var(--brand)",
                  color: "#fff",
                }}
              >
                Stay
              </button>
              <button
                onClick={() => {
                  xhrRef.current?.abort();
                  blocker.proceed();
                }}
                className="flex-1 py-2 rounded-xl text-[13px] font-medium transition-ui"
                style={{
                  backgroundColor: "rgba(255,255,255,0.06)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                }}
              >
                Leave anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Left: main upload area */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: "var(--text-primary)" }}>
          New transcription
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
          Upload an audio or video file to get started.
        </p>

        {/* Worker status banner */}
        {workerStatus && (
          <div
            className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 mb-4 text-sm"
            style={{
              backgroundColor: workerStatus.warm
                ? "color-mix(in srgb, var(--status-completed) 12%, transparent)"
                : warmingUp
                ? "color-mix(in srgb, var(--brand) 10%, transparent)"
                : "color-mix(in srgb, var(--status-processing) 12%, transparent)",
              border: `1px solid ${workerStatus.warm
                ? "color-mix(in srgb, var(--status-completed) 30%, transparent)"
                : warmingUp
                ? "color-mix(in srgb, var(--brand) 25%, transparent)"
                : "color-mix(in srgb, var(--status-processing) 30%, transparent)"}`,
            }}
          >
            <div className="flex items-center gap-2.5">
              {workerStatus.warm ? (
                <>
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: "var(--status-completed)" }} />
                  <span style={{ color: "var(--status-completed)" }} className="font-medium">
                    Worker ready — transcription will start instantly
                  </span>
                </>
              ) : warmingUp ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" style={{ color: "var(--brand)" }}>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span style={{ color: "var(--brand-dark)" }} className="font-medium">
                    Warming up worker — ready in ~90 seconds
                  </span>
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: "var(--status-processing)" }} />
                  <span style={{ color: "var(--text-secondary)" }}>
                    Worker is cold — expect a ~2 min startup delay
                  </span>
                </>
              )}
            </div>
            {!workerStatus.warm && !warmingUp && (
              <button
                onClick={handleWarmup}
                className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-ui"
                style={{
                  backgroundColor: "var(--brand)",
                  color: "#fff",
                }}
              >
                Warm up
              </button>
            )}
          </div>
        )}

        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload file"
          className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-ui ${busy ? "pointer-events-none opacity-50" : ""}`}
          style={
            dragging
              ? { borderColor: "var(--brand)", backgroundColor: "var(--brand-subtle)" }
              : { borderColor: "var(--border)", backgroundColor: "var(--surface)" }
          }
          onClick={() => !busy && !hasFile && inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && !busy && !hasFile && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input ref={inputRef} type="file" accept={ACCEPTED} className="sr-only" onChange={onInputChange} />

          {!hasFile ? (
            <div className="flex flex-col items-center gap-3">
              <div
                className="p-3 rounded-xl transition-ui"
                style={{ backgroundColor: dragging ? "var(--brand-tint)" : "var(--surface-raised)" }}
              >
                <UploadIcon
                  className="h-6 w-6 transition-ui"
                  style={{ color: dragging ? "var(--brand)" : "var(--text-tertiary)" } as React.CSSProperties}
                />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {dragging ? "Release to upload" : "Drop a file or click to browse"}
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                  Audio &amp; video · up to 5 GB · {me?.quota ? `${Math.floor(me.quota.max_duration_seconds / 3600)} hours` : "2 hours"} max
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 text-left">
              <div className="p-2.5 rounded-xl shrink-0" style={{ backgroundColor: "var(--brand-subtle)" }}>
                <FileIcon className="h-5 w-5" style={{ color: "var(--brand)" } as React.CSSProperties} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                  {fileInfo!.file.name}
                </p>
                <p className="text-xs mt-0.5 font-mono" style={{ color: "var(--text-tertiary)" }}>
                  {formatBytes(fileInfo!.file.size)} · {formatDuration(fileInfo!.durationSeconds)}
                </p>
              </div>
              {!busy && (
                <button
                  className="text-xs transition-ui shrink-0 px-2 py-1 rounded-md"
                  style={{ color: "var(--text-tertiary)" }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.color = "var(--text-secondary)"; (e.target as HTMLElement).style.backgroundColor = "var(--surface-raised)"; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.color = "var(--text-tertiary)"; (e.target as HTMLElement).style.backgroundColor = "transparent"; }}
                  onClick={(e) => { e.stopPropagation(); setFileInfo(null); setStage("idle"); setErrorMsg(""); setUploadPct(0); }}
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>

        {/* Upload progress bar */}
        {stage === "uploading" && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs" style={{ color: "var(--brand-dark)" }}>
              <div className="flex items-center gap-2">
                <svg className="animate-spin h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span className="font-medium">Uploading file…</span>
              </div>
              <span className="font-mono tabular-nums">{uploadPct}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--brand-tint)" }}>
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{ width: `${uploadPct}%`, backgroundColor: "var(--brand)" }}
              />
            </div>
          </div>
        )}

        {/* Creating job spinner */}
        {stage === "creating" && (
          <div className="mt-3 flex items-center gap-2.5 text-sm font-medium" style={{ color: "var(--brand-dark)" }}>
            <svg className="animate-spin h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span>Creating transcription job…</span>
          </div>
        )}

        {/* Error */}
        {stage === "error" && errorMsg && (
          <p className="mt-3 text-sm font-medium" style={{ color: "var(--status-failed)" }}>{errorMsg}</p>
        )}

        {/* Submit */}
        {(stage === "ready" || stage === "error") && fileInfo && (
          <button
            onClick={onSubmit}
            className="btn-primary mt-4 w-full py-2.5 px-4 rounded-xl text-sm font-semibold"
          >
            Transcribe
          </button>
        )}
      </div>

      {/* Right: sidebar with limits + quota + formats */}
      <aside className="hidden lg:block space-y-6 pt-[72px]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-tertiary)" }}>
            Limits
          </p>
          <ul className="space-y-2.5">
            {[
              ["Max file size", "5 GB"],
              ["Max duration", me?.quota ? `${Math.floor(me.quota.max_duration_seconds / 3600)} hours` : "2 hours"],
              ["Output formats", "JSON · SRT · TXT"],
            ].map(([label, value]) => (
              <li key={label} className="flex items-center justify-between gap-4">
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{label}</span>
                <span className="text-xs font-medium font-mono" style={{ color: "var(--text-primary)" }}>{value}</span>
              </li>
            ))}
          </ul>
        </div>

        {me?.quota && (
          <QuotaMeter
            usedMinutes={Math.ceil(me.quota.minutes_used_this_month)}
            maxMinutes={me.quota.max_minutes_per_month}
            resetAt={me.quota.quota_reset_at}
          />
        )}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-tertiary)" }}>
            Supported formats
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORTED_FORMATS.map((fmt) => (
              <span
                key={fmt}
                className="px-2 py-0.5 rounded-md text-[11px] font-mono"
                style={{ backgroundColor: "var(--surface-raised)", color: "var(--text-secondary)" }}
              >
                {fmt}
              </span>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
