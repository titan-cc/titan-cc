import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type {
  AdminJobListResponse,
  Folder,
  FolderListResponse,
  FolderScope,
  JobListResponse,
  UserMeResponse,
} from "@/api/types";
import StatusBadge from "@/components/StatusBadge";
import ProgressBar from "@/components/ProgressBar";
import { isTerminal } from "@/lib/poll";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getDate()} ${MO[d.getMonth()]} ${d.getFullYear()}`;
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

// ── Icons ────────────────────────────────────────────────────────────────────

function FolderFilledIcon() {
  return (
    <svg width="17" height="17" fill="none" viewBox="0 0 24 24">
      <path fill="currentColor" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function ChevronRightIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" /><path d="M12 3c-2.485 0-4.5 4.03-4.5 9s2.015 9 4.5 9 4.5-4.03 4.5-9-2.015-9-4.5-9z" />
      <path d="M3 12h18" />
    </svg>
  );
}

function UploadArrowIcon() {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function CheckAllIcon() {
  return (
    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

// ── Create Folder Modal ──────────────────────────────────────────────────────

function CreateFolderModal({
  onClose,
  onCreate,
  isPending,
}: {
  onClose: () => void;
  onCreate: (name: string, scope: FolderScope) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<FolderScope>("personal");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  function submit() {
    if (name.trim() && !isPending) onCreate(name.trim(), scope);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(26,26,26,0.62)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[460px] rounded-2xl overflow-hidden"
        style={{
          backgroundColor: "#ffffff",
          boxShadow: "0 32px 80px rgba(0,0,0,0.24), 0 0 0 1px rgba(0,0,0,0.07)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <div className="px-8 pt-9 pb-1 text-center">
          <h2
            className="text-[22px] font-bold tracking-tight"
            style={{ color: "#1A1A1A", fontFamily: "'Gotham', system-ui, sans-serif" }}
          >
            Create a new folder
          </h2>
        </div>

        <div className="px-8 pt-6 pb-7 flex flex-col gap-5">
          {/* Scope selector */}
          <div
            className="inline-flex gap-1 p-1 rounded-xl self-start"
            style={{ backgroundColor: "#F0F1F2" }}
          >
            {(["personal", "org"] as FolderScope[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150"
                style={
                  scope === s
                    ? {
                        backgroundColor: "#00AEEF",
                        color: "#fff",
                        boxShadow: "0 1px 4px rgba(0,174,239,0.32)",
                      }
                    : { color: "#777878" }
                }
              >
                {s === "personal" ? <LockIcon /> : <GlobeIcon />}
                {s === "personal" ? "Personal" : "Team"}
              </button>
            ))}
          </div>

          {/* Folder name input */}
          <div
            className="relative rounded-xl overflow-hidden transition-shadow duration-150"
            style={{
              border: "2px solid #00AEEF",
              boxShadow: "0 0 0 4px rgba(0,174,239,0.12)",
            }}
          >
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Type your folder name"
              className="w-full px-5 pt-4 pb-12 text-[15px] outline-none bg-white"
              style={{
                color: "#1A1A1A",
                fontFamily: "'Gotham', system-ui, sans-serif",
                caretColor: "#00AEEF",
              }}
            />
            {/* Bottom-left brand mark — mirrors Trint's icon detail */}
            <div className="absolute bottom-3.5 left-5 flex items-center gap-2 pointer-events-none select-none">
              <div
                className="h-[22px] w-[22px] rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: "#00AEEF" }}
              >
                {/* Titan triangle mark */}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M5 1.5L8.8 8.5H1.2L5 1.5Z" fill="white" />
                </svg>
              </div>
              <span
                className="text-[11px] font-semibold tracking-wide"
                style={{ color: "#B1B3B6" }}
              >
                Titan CC
              </span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 px-8 pb-8">
          <button
            onClick={onClose}
            className="flex-1 py-3.5 rounded-xl text-[14px] font-semibold transition-all duration-150 active:scale-[0.98]"
            style={{ backgroundColor: "#F0F1F2", color: "#1A1A1A" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#E6E7E8"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#F0F1F2"; }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || isPending}
            className="flex-1 py-3.5 rounded-xl text-[14px] font-semibold text-white transition-all duration-150 active:scale-[0.98]"
            style={{
              backgroundColor: "#00AEEF",
              opacity: !name.trim() || isPending ? 0.45 : 1,
              cursor: !name.trim() || isPending ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => {
              if (name.trim() && !isPending)
                (e.currentTarget as HTMLElement).style.backgroundColor = "#0076A3";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "#00AEEF";
            }}
          >
            {isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Table grid shared style (6 cols: checkbox | name | status | duration | created | edited) ──

const TABLE_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "44px 1fr 114px 82px 128px 128px",
  alignItems: "center",
};

// ── Table header ─────────────────────────────────────────────────────────────

function TableHeader({
  allChecked,
  someChecked,
  onToggleAll,
}: {
  allChecked: boolean;
  someChecked: boolean;
  onToggleAll: (v: boolean) => void;
}) {
  const cols = [
    { label: "Name", cls: "col-span-1" },
    { label: "Status" },
    { label: "Duration" },
    { label: "Created" },
    { label: "Edited", icon: true },
  ];

  return (
    <div
      className="px-2 sticky top-0 z-10"
      style={{
        ...TABLE_GRID,
        height: 40,
        borderBottom: "1px solid var(--border)",
        backgroundColor: "var(--surface-subtle, #F8F9FA)",
      }}
    >
      {/* Master checkbox */}
      <div className="flex items-center justify-center">
        <button
          onClick={() => onToggleAll(!allChecked)}
          className="h-[15px] w-[15px] rounded border flex items-center justify-center transition-all duration-100"
          style={{
            borderColor: allChecked || someChecked ? "#00AEEF" : "#D0D2D5",
            backgroundColor: allChecked ? "#00AEEF" : "transparent",
            color: "#fff",
          }}
        >
          {allChecked && <CheckAllIcon />}
          {!allChecked && someChecked && (
            <span className="w-1.5 h-[2px] rounded-full" style={{ backgroundColor: "#00AEEF" }} />
          )}
        </button>
      </div>

      {/* Column labels */}
      {cols.map((c) => (
        <div key={c.label} className="flex items-center gap-1 pr-2">
          <span
            className="text-[11px] font-semibold uppercase tracking-wide select-none truncate"
            style={{ color: "#777878" }}
          >
            {c.label}
          </span>
          {c.icon && (
            <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} style={{ color: "#B1B3B6", flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div
      className="px-2 animate-pulse"
      style={{ ...TABLE_GRID, height: 52, borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex justify-center">
        <div className="h-3.5 w-3.5 rounded" style={{ backgroundColor: "#E6E7E8" }} />
      </div>
      <div className="flex items-center gap-3 pr-4">
        <div className="h-4 w-4 rounded shrink-0" style={{ backgroundColor: "#E6E7E8" }} />
        <div className="h-3 rounded-full w-44" style={{ backgroundColor: "#E6E7E8" }} />
      </div>
      <div className="h-3 rounded-full w-16" style={{ backgroundColor: "#E6E7E8" }} />
      <div className="h-3 rounded-full w-10" style={{ backgroundColor: "#E6E7E8" }} />
      <div className="h-3 rounded-full w-20" style={{ backgroundColor: "#E6E7E8" }} />
      <div className="h-3 rounded-full w-14" style={{ backgroundColor: "#E6E7E8" }} />
    </div>
  );
}

// ── Folder Table Row ─────────────────────────────────────────────────────────

interface FolderRowProps {
  folder: Folder;
  selected: boolean;
  onSelect: (id: string, v: boolean) => void;
  onNavigate: (id: string) => void;
  onDrop: (jobId: string, folderId: string) => void;
  isAdmin: boolean;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onScopeChange: (id: string, scope: FolderScope) => void;
  renaming: boolean;
  onStartRename: (id: string) => void;
  onCancelRename: () => void;
}

function FolderTableRow({
  folder, selected, onSelect, onNavigate, onDrop,
  isAdmin, onDelete, onRename, onScopeChange,
  renaming, onStartRename, onCancelRename,
}: FolderRowProps) {
  const [hovered, setHovered] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const [editVal, setEditVal] = useState(folder.name);
  const enterCount = useRef(0);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); enterCount.current += 1;
    if (enterCount.current === 1) setIsOver(true);
  };
  const handleDragLeave = () => {
    enterCount.current -= 1;
    if (enterCount.current === 0) setIsOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); enterCount.current = 0; setIsOver(false);
    const jobId = e.dataTransfer.getData("text/plain");
    if (jobId) onDrop(jobId, folder.id);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="px-2 transition-colors duration-100 select-none"
      style={{
        ...TABLE_GRID,
        height: 52,
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
        backgroundColor: isOver
          ? "rgba(0,174,239,0.07)"
          : selected
          ? "rgba(0,174,239,0.04)"
          : hovered
          ? "var(--surface-subtle)"
          : undefined,
        outline: isOver ? "2px solid rgba(0,174,239,0.30)" : undefined,
        outlineOffset: "-2px",
        borderRadius: isOver ? 2 : undefined,
      }}
      onClick={() => !renaming && onNavigate(folder.id)}
    >
      {/* Checkbox */}
      <div
        className="flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(folder.id, e.target.checked)}
          className="h-[15px] w-[15px] rounded cursor-pointer"
          style={{ accentColor: "#00AEEF" }}
        />
      </div>

      {/* Name column */}
      <div
        className="flex items-center gap-2.5 pr-3 min-w-0"
        onClick={(e) => { if (!renaming) { e.stopPropagation(); onNavigate(folder.id); } }}
      >
        <span className="shrink-0" style={{ color: "#1A1A1A" }}>
          <FolderFilledIcon />
        </span>

        {renaming ? (
          <form
            className="flex-1 min-w-0"
            onSubmit={(e) => {
              e.preventDefault();
              if (editVal.trim() && editVal.trim() !== folder.name) onRename(folder.id, editVal.trim());
              else onCancelRename();
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              onBlur={() => {
                if (editVal.trim() && editVal.trim() !== folder.name) onRename(folder.id, editVal.trim());
                else onCancelRename();
              }}
              onKeyDown={(e) => { if (e.key === "Escape") onCancelRename(); }}
              className="w-full text-sm bg-transparent outline-none border-b-2 px-0 pb-0.5"
              style={{ borderColor: "#00AEEF", color: "#1A1A1A", fontWeight: 600, caretColor: "#00AEEF" }}
            />
          </form>
        ) : (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span
              className="text-sm font-semibold truncate"
              style={{ color: isOver ? "#00AEEF" : "#1A1A1A" }}
            >
              {isOver ? "Move here" : folder.name}
            </span>
            {/* Scope badge */}
            <span
              className="shrink-0 opacity-40"
              style={{ color: folder.scope === "org" ? "#00AEEF" : "#777878" }}
              title={folder.scope === "org" ? "Team folder" : "Personal folder"}
            >
              {folder.scope === "org" ? <GlobeIcon /> : <LockIcon />}
            </span>
            {folder.job_count > 0 && (
              <span
                className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums"
                style={{ backgroundColor: "#F0F1F2", color: "#777878" }}
              >
                {folder.job_count}
              </span>
            )}
          </div>
        )}

        {!renaming && hovered && !isOver && (
          <span className="shrink-0 ml-auto" style={{ color: "#B1B3B6" }}>
            <ChevronRightIcon />
          </span>
        )}
      </div>

      {/* Status — folders have none */}
      <div className="hidden md:block">
        <span style={{ color: "#D0D2D5", fontSize: 14 }}>—</span>
      </div>

      {/* Duration — folders have none */}
      <div className="hidden md:block">
        <span style={{ color: "#D0D2D5", fontSize: 14 }}>—</span>
      </div>

      {/* Created */}
      <div className="hidden md:block pr-2 truncate">
        <span className="text-[12px] tabular-nums" style={{ color: "#777878" }}>
          {formatDate(folder.created_at)}
        </span>
      </div>

      {/* Edited + hover actions */}
      <div className="hidden md:flex items-center justify-between pr-2 gap-1">
        <span className="text-[12px] tabular-nums truncate" style={{ color: "#777878" }}>
          {timeAgo(folder.created_at)}
        </span>

        {hovered && !renaming && (
          <div
            className="flex items-center gap-0.5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {(folder.owned_by_me || isAdmin) && (
              <>
                {/* Scope toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onScopeChange(folder.id, folder.scope === "personal" ? "org" : "personal");
                  }}
                  className="p-1.5 rounded-lg transition-colors"
                  title={folder.scope === "personal" ? "Make team folder" : "Make personal folder"}
                  style={{ color: "#B1B3B6" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#00AEEF"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#B1B3B6"; }}
                >
                  {folder.scope === "org" ? <GlobeIcon /> : <LockIcon />}
                </button>
                {/* Rename */}
                <button
                  onClick={(e) => { e.stopPropagation(); setEditVal(folder.name); onStartRename(folder.id); }}
                  className="p-1.5 rounded-lg transition-colors"
                  title="Rename"
                  style={{ color: "#B1B3B6" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#1A1A1A"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#B1B3B6"; }}
                >
                  <PencilIcon />
                </button>
              </>
            )}
            {isAdmin && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete folder "${folder.name}" and all its transcripts?`)) onDelete(folder.id);
                }}
                className="p-1.5 rounded-lg transition-colors"
                title="Delete folder"
                style={{ color: "#B1B3B6" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#EC008C"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#B1B3B6"; }}
              >
                <TrashIcon />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Job Table Row ────────────────────────────────────────────────────────────

interface JobRowProps {
  job: {
    id: string;
    status: string;
    input_filename: string | null;
    input_duration_seconds: number;
    current_stage: string | null;
    progress_pct: number | null;
    created_at: string;
    user_email?: string;
    folder_id?: string | null;
  };
  selected: boolean;
  onSelect: (id: string, v: boolean) => void;
  isDragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  showUser?: boolean;
  onContextMenu?: (e: React.MouseEvent, jobId: string, currentFolderId: string | null) => void;
}

function JobTableRow({ job, selected, onSelect, isDragging, onDragStart, onDragEnd, showUser, onContextMenu }: JobRowProps) {
  const [hovered, setHovered] = useState(false);
  const isActive = ["queued", "dispatched", "processing"].includes(job.status);
  const to = job.status === "completed" ? `/jobs/${job.id}/transcript` : `/jobs/${job.id}`;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", job.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(job.id);
      }}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e, job.id, job.folder_id ?? null);
      }}
      className="px-2 transition-colors duration-100"
      style={{
        ...TABLE_GRID,
        minHeight: 52,
        paddingTop: isActive ? 12 : 0,
        paddingBottom: isActive ? 12 : 0,
        borderBottom: "1px solid var(--border)",
        backgroundColor: selected
          ? "rgba(0,174,239,0.04)"
          : hovered
          ? "var(--surface-subtle)"
          : undefined,
        opacity: isDragging ? 0.4 : 1,
        cursor: isDragging ? "grabbing" : "default",
      }}
    >
      {/* Checkbox */}
      <div
        className="flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(job.id, e.target.checked)}
          className="h-[15px] w-[15px] rounded cursor-pointer"
          style={{ accentColor: "#00AEEF" }}
        />
      </div>

      {/* Name */}
      <Link
        to={to}
        draggable={false}
        className="flex flex-col min-w-0 pr-4 group"
        onClick={(e) => e.stopPropagation()}
        style={{ alignSelf: "stretch", display: "flex", justifyContent: "center" }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="shrink-0 transition-colors duration-150" style={{ color: hovered ? "#00AEEF" : "#B1B3B6" }}>
            <FileIcon />
          </span>
          <div className="min-w-0 flex-1">
            <span
              className="text-sm font-medium truncate block transition-colors duration-150"
              style={{ color: hovered ? "#00AEEF" : "#1A1A1A" }}
            >
              {job.input_filename ?? `${job.id.slice(0, 8)}…`}
            </span>
            {showUser && job.user_email && (
              <span className="text-[11px] truncate block" style={{ color: "#B1B3B6" }}>
                {job.user_email}
              </span>
            )}
          </div>
        </div>

        {isActive && (
          <div className="mt-2.5 ml-[26px]">
            <div className="flex justify-between text-[11px] mb-1.5" style={{ color: "#B1B3B6" }}>
              <span>
                {job.status === "queued" && "Waiting in queue"}
                {job.status === "dispatched" && "Warming up GPU — usually 60–90 s"}
                {job.status === "processing" && (job.current_stage ?? "Transcribing…")}
              </span>
              {job.status === "processing" && job.progress_pct != null && (
                <span className="font-mono tabular-nums">{job.progress_pct}%</span>
              )}
            </div>
            {job.status === "processing" && job.progress_pct != null
              ? <ProgressBar pct={job.progress_pct} />
              : <ProgressBar indeterminate />
            }
          </div>
        )}
      </Link>

      {/* Status */}
      <div className="hidden md:block">
        <StatusBadge status={job.status as never} />
      </div>

      {/* Duration */}
      <div className="hidden md:block">
        <span className="text-[12px] font-mono tabular-nums" style={{ color: "#777878" }}>
          {formatDuration(job.input_duration_seconds)}
        </span>
      </div>

      {/* Created */}
      <div className="hidden md:block pr-2 truncate">
        <span className="text-[12px] tabular-nums" style={{ color: "#777878" }}>
          {formatDate(job.created_at)}
        </span>
      </div>

      {/* Edited (time-ago) */}
      <div className="hidden md:block pr-2">
        <span className="text-[12px] tabular-nums" style={{ color: "#777878" }}>
          {timeAgo(job.created_at)}
        </span>
      </div>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ inFolder }: { inFolder: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="p-5 rounded-2xl mb-5"
        style={{ backgroundColor: "var(--surface-subtle)" }}
      >
        <svg className="h-9 w-9" style={{ color: "var(--text-tertiary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.3}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      {inFolder ? (
        <>
          <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
            This folder is empty
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
            Drag a transcript here to move it
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
            No transcripts yet
          </p>
          <p className="text-xs mt-1 mb-6" style={{ color: "var(--text-tertiary)" }}>
            Upload a file to create your first transcript
          </p>
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl text-white active:scale-[0.98] transition-transform"
            style={{ backgroundColor: "#00AEEF" }}
          >
            <UploadArrowIcon />
            Upload a file
          </Link>
        </>
      )}
    </div>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

interface ToolbarProps {
  selectedIds: Set<string>;
  folderIds: Set<string>;
  onNewFolder: () => void;
  onRenameSelected: () => void;
  onDeleteSelected: () => void;
  isAdmin: boolean;
  searchVal: string;
  onSearchChange: (v: string) => void;
  onSearchSubmit: () => void;
}

function Toolbar({
  selectedIds, folderIds, onNewFolder, onRenameSelected, onDeleteSelected,
  isAdmin, searchVal, onSearchChange, onSearchSubmit,
}: ToolbarProps) {
  const hasSelection = selectedIds.size > 0;
  const hasFolder = [...selectedIds].some((id) => folderIds.has(id));
  const singleFolder = hasSelection && hasFolder && selectedIds.size === 1 && folderIds.has([...selectedIds][0]);

  const btnBase: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 6,
    padding: "6px 12px", borderRadius: 8,
    fontSize: 12, fontWeight: 600, cursor: "pointer",
    transition: "all 0.12s ease",
    border: "1px solid var(--border)",
    backgroundColor: "var(--surface)",
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
  };

  const btnActive: React.CSSProperties = {
    ...btnBase, color: "#1A1A1A",
  };

  const btnDanger: React.CSSProperties = {
    ...btnBase, color: "#EC008C", borderColor: "rgba(236,0,140,0.2)",
  };

  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5 flex-wrap"
      style={{ borderBottom: "1px solid var(--border)", backgroundColor: "var(--surface)" }}
    >
      {/* Left actions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* New Folder */}
        <button
          onClick={onNewFolder}
          className="flex items-center gap-1.5 rounded-lg text-sm font-semibold px-3 py-1.5 transition-all duration-150 active:scale-[0.97]"
          style={{ backgroundColor: "#00AEEF", color: "#fff", border: "1px solid rgba(0,118,163,0.3)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#0076A3"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#00AEEF"; }}
        >
          <FolderPlusIcon />
          New folder
        </button>

        {/* Rename — only when single folder selected */}
        {singleFolder && (
          <button
            onClick={onRenameSelected}
            style={btnActive}
            className="flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5 transition-all duration-150 active:scale-[0.97]"
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface-subtle)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface)"; }}
          >
            <PencilIcon />
            Rename
          </button>
        )}

        {/* Delete — when anything selected AND (admin OR it's a non-folder) */}
        {hasSelection && isAdmin && (
          <button
            onClick={onDeleteSelected}
            style={btnDanger}
            className="flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5 transition-all duration-150 active:scale-[0.97]"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(236,0,140,0.06)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface)";
            }}
          >
            <TrashIcon />
            Delete
          </button>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <form
        onSubmit={(e) => { e.preventDefault(); onSearchSubmit(); }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
        style={{
          border: "1px solid var(--border)",
          backgroundColor: "var(--surface-subtle)",
          minWidth: 200,
        }}
      >
        <span style={{ color: "var(--text-tertiary)" }}><SearchIcon /></span>
        <input
          value={searchVal}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search transcripts…"
          className="bg-transparent text-[12px] outline-none flex-1 min-w-0"
          style={{ color: "var(--text-primary)" }}
        />
        {searchVal && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="text-[10px] font-semibold leading-none"
            style={{ color: "var(--text-tertiary)" }}
          >
            ×
          </button>
        )}
      </form>

      {/* Upload CTA */}
      <Link
        to="/upload"
        className="flex items-center gap-1.5 text-sm font-semibold px-3.5 py-1.5 rounded-lg text-white transition-all duration-150 active:scale-[0.97]"
        style={{ backgroundColor: "#1A1A1A" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#333"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#1A1A1A"; }}
      >
        <UploadArrowIcon />
        Upload
      </Link>
    </div>
  );
}

// ── Context Menu ─────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  jobId: string;
  currentFolderId: string | null;
}

function ContextMenu({
  state,
  folders,
  onMove,
  onClose,
}: {
  state: ContextMenuState;
  folders: Folder[];
  onMove: (jobId: string, folderId: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Nudge into viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuW = 220;
  const menuH = Math.min(48 + folders.length * 36 + (state.currentFolderId ? 44 : 0), 400);
  const x = state.x + menuW > vw ? state.x - menuW : state.x;
  const y = state.y + menuH > vh ? state.y - menuH : state.y;

  return (
    <div
      ref={ref}
      className="fixed z-50 py-1 rounded-xl overflow-hidden"
      style={{
        left: x,
        top: y,
        width: menuW,
        backgroundColor: "var(--surface)",
        border: "1px solid var(--border)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      {/* Header */}
      <div
        className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest"
        style={{ color: "#B1B3B6", borderBottom: "1px solid var(--border)" }}
      >
        Move to folder
      </div>

      {/* Folder options */}
      <div className="py-1 max-h-60 overflow-y-auto">
        {folders.map((f) => {
          const isCurrent = f.id === state.currentFolderId;
          return (
            <button
              key={f.id}
              onClick={() => { onMove(state.jobId, f.id); onClose(); }}
              disabled={isCurrent}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors duration-100"
              style={{
                color: isCurrent ? "#B1B3B6" : "var(--text-primary)",
                cursor: isCurrent ? "default" : "pointer",
                backgroundColor: "transparent",
                border: "none",
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => {
                if (!isCurrent) (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(0,174,239,0.06)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
              }}
            >
              <span style={{ color: isCurrent ? "#B1B3B6" : "#1A1A1A", flexShrink: 0 }}>
                <FolderFilledIcon />
              </span>
              <span className="truncate font-medium">{f.name}</span>
              {isCurrent && (
                <span className="ml-auto shrink-0 text-[10px] font-semibold" style={{ color: "#00AEEF" }}>
                  current
                </span>
              )}
            </button>
          );
        })}

        {folders.length === 0 && (
          <div className="px-3 py-3 text-xs italic" style={{ color: "#B1B3B6" }}>
            No folders yet
          </div>
        )}
      </div>

      {/* Remove from folder — only when currently in one */}
      {state.currentFolderId && (
        <>
          <div style={{ borderTop: "1px solid var(--border)" }} />
          <button
            onClick={() => { onMove(state.jobId, null); onClose(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors duration-100"
            style={{
              color: "var(--text-secondary)",
              cursor: "pointer",
              backgroundColor: "transparent",
              border: "none",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(236,0,140,0.05)";
              (e.currentTarget as HTMLElement).style.color = "#EC008C";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
            }}
          >
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z M9 12l6 0M12 9l0 6" />
            </svg>
            <span className="font-medium">Remove from folder</span>
          </button>
        </>
      )}
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────────

function Toast({ message, type, onDismiss }: { message: string; type: "success" | "info"; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl"
      style={{
        backgroundColor: type === "success" ? "#00AEEF" : "var(--surface)",
        border: type === "info" ? "1px solid var(--border)" : "none",
        color: type === "success" ? "#fff" : "var(--text-primary)",
        boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
      }}
    >
      {type === "success" ? (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
}

// ── Drive Table (renders folders + jobs as table rows) ────────────────────────

type FolderFilter = "all" | "unfiled" | string;

interface DriveTableProps {
  tab: "my" | "all";
  folderFilter: FolderFilter;
  folders: Folder[];
  selectedIds: Set<string>;
  onSelect: (id: string, v: boolean) => void;
  onToggleAll: (v: boolean) => void;
  onNavigateFolder: (id: string) => void;
  onDropJob: (jobId: string, folderId: string | null) => void;
  isAdmin: boolean;
  onDeleteFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onScopeChange: (id: string, scope: FolderScope) => void;
  renamingFolderId: string | null;
  onStartRename: (id: string) => void;
  onCancelRename: () => void;
  onJobContextMenu: (e: React.MouseEvent, jobId: string, currentFolderId: string | null) => void;
}

function DriveTable({
  tab, folderFilter, folders, selectedIds, onSelect, onToggleAll,
  onNavigateFolder, onDropJob, isAdmin, onDeleteFolder, onRenameFolder, onScopeChange,
  renamingFolderId, onStartRename, onCancelRename, onJobContextMenu,
}: DriveTableProps) {
  const { getToken } = useAuth();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Jobs query
  const { data: myJobsData, isLoading: myLoading, error: myError } = useQuery<JobListResponse>({
    queryKey: ["jobs", folderFilter],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams({ limit: "50" });
      if (folderFilter === "unfiled") params.set("folder_id", "unfiled");
      else if (folderFilter !== "all") params.set("folder_id", folderFilter);
      const res = await apiFetch(`/jobs?${params}`, { token: token! });
      return res.json();
    },
    enabled: tab === "my",
    refetchInterval: (q) => (q.state.data?.jobs ?? []).some((j) => !isTerminal(j.status)) ? 5000 : false,
  });

  const { data: adminJobsData, isLoading: adminLoading, error: adminError } = useQuery<AdminJobListResponse>({
    queryKey: ["admin-jobs", folderFilter],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams({ limit: "100" });
      if (folderFilter === "unfiled") params.set("folder_id", "unfiled");
      else if (folderFilter !== "all") params.set("folder_id", folderFilter);
      const res = await apiFetch(`/admin/jobs?${params}`, { token: token! });
      return res.json();
    },
    enabled: tab === "all",
    refetchInterval: (q) => (q.state.data?.jobs ?? []).some((j) => !isTerminal(j.status)) ? 5000 : false,
  });

  const isLoading = tab === "my" ? myLoading : adminLoading;
  const error = tab === "my" ? myError : adminError;
  const jobs = tab === "my" ? (myJobsData?.jobs ?? []) : (adminJobsData?.jobs ?? []);

  // Show folder rows only at the root "all" view, not inside a specific folder.
  // Split into personal (owned by user) and team (org-scoped, shared with everyone).
  // Both sections appear in "My Files" so non-admin users can still access team folders.
  const showFolderRows = folderFilter === "all";
  const personalFolders = showFolderRows ? folders.filter((f) => f.scope === "personal") : [];
  const teamFolders = showFolderRows ? folders.filter((f) => f.scope === "org") : [];
  const visibleFolders = [...personalFolders, ...teamFolders];

  const totalItems = visibleFolders.length + jobs.length;
  const allChecked = totalItems > 0 && [...visibleFolders.map((f) => f.id), ...jobs.map((j) => j.id)]
    .every((id) => selectedIds.has(id));
  const someChecked = selectedIds.size > 0 && !allChecked;

  function handleToggleAll(v: boolean) {
    onToggleAll(v);
  }

  if (error) {
    return (
      <div
        className="rounded-xl border px-5 py-4 m-4"
        style={{ borderColor: "#FFC0CB", backgroundColor: "#FFF5F5" }}
      >
        <p className="text-sm font-medium" style={{ color: "#EC008C" }}>
          Failed to load transcripts.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-b-2xl overflow-hidden"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <TableHeader
        allChecked={allChecked}
        someChecked={someChecked}
        onToggleAll={handleToggleAll}
      />

      {/* Personal folder rows */}
      {personalFolders.map((folder) => (
        <FolderTableRow
          key={folder.id}
          folder={folder}
          selected={selectedIds.has(folder.id)}
          onSelect={onSelect}
          onNavigate={onNavigateFolder}
          onDrop={(jobId, folderId) => onDropJob(jobId, folderId)}
          isAdmin={isAdmin}
          onDelete={onDeleteFolder}
          onRename={onRenameFolder}
          onScopeChange={onScopeChange}
          renaming={renamingFolderId === folder.id}
          onStartRename={onStartRename}
          onCancelRename={onCancelRename}
        />
      ))}

      {/* Team Folders section — org-scoped, visible to all users */}
      {teamFolders.length > 0 && (
        <>
          <div className="px-4 py-1" style={{ backgroundColor: "var(--surface-subtle)" }}>
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
              <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#B1B3B6" }}>
                Team Folders
              </span>
              <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
            </div>
          </div>
          {teamFolders.map((folder) => (
            <FolderTableRow
              key={folder.id}
              folder={folder}
              selected={selectedIds.has(folder.id)}
              onSelect={onSelect}
              onNavigate={onNavigateFolder}
              onDrop={(jobId, folderId) => onDropJob(jobId, folderId)}
              isAdmin={isAdmin}
              onDelete={onDeleteFolder}
              onRename={onRenameFolder}
              onScopeChange={onScopeChange}
              renaming={renamingFolderId === folder.id}
              onStartRename={onStartRename}
              onCancelRename={onCancelRename}
            />
          ))}
        </>
      )}

      {/* Thin separator between folders and files */}
      {visibleFolders.length > 0 && jobs.length > 0 && (
        <div className="px-4 py-1" style={{ backgroundColor: "var(--surface-subtle)" }}>
          <div className="flex items-center gap-2">
            <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#B1B3B6" }}>
              Files
            </span>
            <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
          </div>
        </div>
      )}

      {/* Job rows / loading / empty */}
      {isLoading ? (
        Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
      ) : jobs.length === 0 && visibleFolders.length === 0 ? (
        <EmptyState inFolder={folderFilter !== "all"} />
      ) : (
        jobs.map((job) => (
          <JobTableRow
            key={job.id}
            job={job}
            selected={selectedIds.has(job.id)}
            onSelect={onSelect}
            isDragging={draggingId === job.id}
            onDragStart={(id) => setDraggingId(id)}
            onDragEnd={() => setDraggingId(null)}
            showUser={tab === "all"}
            onContextMenu={onJobContextMenu}
          />
        ))
      )}
    </div>
  );
}

// ── Jobs Page ─────────────────────────────────────────────────────────────────

type Tab = "my" | "all";

export default function Jobs() {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>("my");
  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" } | null>(null);
  const [searchVal, setSearchVal] = useState("");

  const { data: me } = useQuery<UserMeResponse>({
    queryKey: ["me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/users/me", { token: token! });
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: foldersData } = useQuery<FolderListResponse>({
    queryKey: ["folders"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/folders", { token: token! });
      return res.json();
    },
    staleTime: 30_000,
  });

  const folders = foldersData?.folders ?? [];
  const folderIdSet = new Set(folders.map((f) => f.id));
  const isAdmin = me?.role === "admin";

  // Find current folder (when we're inside one)
  const currentFolder = typeof folderFilter === "string" && folderFilter !== "all" && folderFilter !== "unfiled"
    ? folders.find((f) => f.id === folderFilter)
    : null;

  // ── Mutations ──────────────────────────────────────────────────────────────

  const { mutate: createFolder, isPending: isCreating } = useMutation({
    mutationFn: async ({ name, scope }: { name: string; scope: FolderScope }) => {
      const token = await getToken();
      const res = await apiFetch("/folders", { method: "POST", token: token!, body: JSON.stringify({ name, scope }) });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      setShowCreateModal(false);
      setToast({ message: `Folder "${data.name}" created`, type: "success" });
    },
  });

  const { mutate: updateFolder } = useMutation({
    mutationFn: async ({ id, name, scope }: { id: string; name?: string; scope?: FolderScope }) => {
      const token = await getToken();
      await apiFetch(`/folders/${id}`, { method: "PATCH", token: token!, body: JSON.stringify({ name, scope }) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["folders"] }),
  });

  const { mutate: deleteFolder } = useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      await apiFetch(`/folders/${id}`, { method: "DELETE", token: token! });
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      if (folderFilter === id) setFolderFilter("all");
      setSelectedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      setToast({ message: "Folder deleted", type: "success" });
    },
  });

  const { mutate: moveJob } = useMutation({
    mutationFn: async ({ jobId, folderId }: { jobId: string; folderId: string | null }) => {
      const token = await getToken();
      await apiFetch(`/jobs/${jobId}/folder`, {
        method: "PATCH",
        token: token!,
        body: JSON.stringify({ folder_id: folderId }),
      });
    },
    onSuccess: (_, { folderId }) => {
      const folderName = folderId ? (folders.find((f) => f.id === folderId)?.name ?? "folder") : null;
      setToast({
        message: folderName ? `Moved to "${folderName}"` : "Moved to Unfiled",
        type: "success",
      });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["admin-jobs"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
    },
  });

  // ── Selection handlers ────────────────────────────────────────────────────

  function handleSelect(id: string, v: boolean) {
    setSelectedIds((prev) => {
      const s = new Set(prev);
      if (v) s.add(id); else s.delete(id);
      return s;
    });
  }

  function handleToggleAll(v: boolean) {
    if (!v) { setSelectedIds(new Set()); return; }
    const allIds = new Set<string>();
    if (folderFilter === "all") folders.forEach((f) => allIds.add(f.id));
    // Jobs would be added by DriveTable — for now just handle folders in root
    setSelectedIds(allIds);
  }

  // ── Toolbar handlers ──────────────────────────────────────────────────────

  function handleRenameSelected() {
    const selectedFolderIds = [...selectedIds].filter((id) => folderIdSet.has(id));
    if (selectedFolderIds.length === 1) setRenamingFolderId(selectedFolderIds[0]);
  }

  function handleDeleteSelected() {
    const selectedFolderIds = [...selectedIds].filter((id) => folderIdSet.has(id));
    if (selectedFolderIds.length === 0) return;
    const names = selectedFolderIds.map((id) => folders.find((f) => f.id === id)?.name ?? id).join(", ");
    if (confirm(`Delete ${selectedFolderIds.length === 1 ? `folder "${names}"` : `${selectedFolderIds.length} folders`} and all their transcripts?`)) {
      selectedFolderIds.forEach((id) => deleteFolder(id));
      setSelectedIds(new Set());
    }
  }

  function handleDropJob(jobId: string, folderId: string | null) {
    const cached = qc.getQueryData<JobListResponse>(["jobs", folderFilter]);
    const job = cached?.jobs.find((j) => j.id === jobId);
    if (job && job.folder_id === folderId) {
      const name = folderId ? (folders.find((f) => f.id === folderId)?.name ?? "that folder") : "Unfiled";
      setToast({ message: `Already in "${name}"`, type: "info" });
      return;
    }
    moveJob({ jobId, folderId });
  }

  // ── Breadcrumb ────────────────────────────────────────────────────────────

  function Breadcrumb() {
    if (folderFilter === "all") {
      return (
        <span className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)", fontFamily: "'Gotham', system-ui, sans-serif" }}>
          My Drive
        </span>
      );
    }
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setFolderFilter("all")}
          className="text-2xl font-bold tracking-tight transition-colors"
          style={{ color: "var(--text-tertiary)", fontFamily: "'Gotham', system-ui, sans-serif" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#00AEEF"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-tertiary)"; }}
        >
          My Drive
        </button>
        <span style={{ color: "var(--text-tertiary)" }}>
          <ChevronRightIcon size={18} />
        </span>
        <span
          className="text-2xl font-bold tracking-tight"
          style={{ color: "var(--text-primary)", fontFamily: "'Gotham', system-ui, sans-serif" }}
        >
          {folderFilter === "unfiled" ? "Unfiled" : (currentFolder?.name ?? "…")}
        </span>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Page header */}
      <div className="flex items-end justify-between mb-6">
        <Breadcrumb />
        {/* Admin tab switcher */}
        {isAdmin && (
          <div
            className="flex gap-1 p-1 rounded-xl"
            style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
          >
            {(["my", "all"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150"
                style={
                  tab === t
                    ? { backgroundColor: "#00AEEF", color: "#fff" }
                    : { color: "var(--text-secondary)" }
                }
              >
                {t === "my" ? "My Files" : "All Files"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Drive container */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
          boxShadow: "0 4px 20px rgba(0,174,239,0.05)",
        }}
      >
        {/* Toolbar */}
        <Toolbar
          selectedIds={selectedIds}
          folderIds={folderIdSet}
          onNewFolder={() => setShowCreateModal(true)}
          onRenameSelected={handleRenameSelected}
          onDeleteSelected={handleDeleteSelected}
          isAdmin={!!isAdmin}
          searchVal={searchVal}
          onSearchChange={setSearchVal}
          onSearchSubmit={() => {
            const q = searchVal.trim();
            if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
          }}
        />

        {/* Table */}
        <DriveTable
          tab={tab}
          folderFilter={folderFilter}
          folders={folders}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onToggleAll={handleToggleAll}
          onNavigateFolder={(id) => { setFolderFilter(id); setSelectedIds(new Set()); }}
          onDropJob={handleDropJob}
          isAdmin={!!isAdmin}
          onDeleteFolder={(id) => deleteFolder(id)}
          onRenameFolder={(id, name) => { updateFolder({ id, name }); setRenamingFolderId(null); }}
          onScopeChange={(id, scope) => updateFolder({ id, scope })}
          renamingFolderId={renamingFolderId}
          onStartRename={(id) => setRenamingFolderId(id)}
          onCancelRename={() => setRenamingFolderId(null)}
          onJobContextMenu={(e, jobId, currentFolderId) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, jobId, currentFolderId });
          }}
        />
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          folders={folders}
          onMove={handleDropJob}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Create Folder Modal */}
      {showCreateModal && (
        <CreateFolderModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(name, scope) => createFolder({ name, scope })}
          isPending={isCreating}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}
