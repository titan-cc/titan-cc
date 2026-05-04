import { useRef, useState } from "react";
import { Link } from "react-router-dom";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Icons ─────────────────────────────────────────────────────────────────────

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

function FolderIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={filled ? 0 : 1.8}>
      {filled
        ? <path fill="currentColor" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        : <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      }
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function AllIcon() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between px-5 py-4 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-3 w-16 rounded-full" style={{ backgroundColor: "#F0F1F2" }} />
        <div className="h-3 w-32 rounded-full" style={{ backgroundColor: "#F0F1F2" }} />
      </div>
      <div className="h-3 w-14 rounded-full" style={{ backgroundColor: "#F0F1F2" }} />
    </div>
  );
}

// ── Job Row (draggable) ───────────────────────────────────────────────────────

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
  };
  showUser?: boolean;
  isDragging?: boolean;
}

function JobRow({ job, showUser, isDragging }: JobRowProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      to={job.status === "completed" ? `/jobs/${job.id}/transcript` : `/jobs/${job.id}`}
      draggable={false}
      className="flex flex-col px-5 py-4 transition-all duration-150 select-none"
      style={{
        borderBottom: "1px solid var(--border)",
        backgroundColor: hovered ? "var(--surface-subtle)" : undefined,
        opacity: isDragging ? 0.4 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {/* Grip handle — visible on hover */}
          <span
            className="shrink-0 transition-opacity duration-150"
            style={{ color: "#B1B3B6", opacity: hovered ? 1 : 0, cursor: "grab" }}
          >
            <GripIcon />
          </span>
          <StatusBadge status={job.status as never} />
          <div className="min-w-0">
            {job.input_filename ? (
              <span className="text-sm truncate block" style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                {job.input_filename}
              </span>
            ) : (
              <span className="text-sm font-mono tabular-nums truncate block" style={{ color: "var(--text-tertiary)" }}>
                {job.id.slice(0, 8)}
              </span>
            )}
            {showUser && job.user_email && (
              <span className="text-[11px] truncate block" style={{ color: "var(--text-tertiary)" }}>
                {job.user_email}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs" style={{ color: "var(--text-tertiary)" }}>
          <span className="font-mono tabular-nums">{formatDuration(job.input_duration_seconds)}</span>
          <span>{timeAgo(job.created_at)}</span>
          <svg className="h-3.5 w-3.5" style={{ color: "#D0D2D5" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>

      {(job.status === "queued" || job.status === "dispatched" || job.status === "processing") && (
        <div className="mt-2.5 ml-[22px]">
          <div className="flex justify-between text-[11px] mb-1.5" style={{ color: "var(--text-tertiary)" }}>
            <span>
              {job.status === "queued" && "Waiting in queue"}
              {job.status === "dispatched" && "Warming up GPU — usually ready in 60–90 s"}
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
  );
}

// Draggable wrapper — separates DnD concerns from the Link/display logic
function DraggableJobRow({
  job,
  showUser,
  onDragStart,
  onDragEnd,
  isDragging,
}: JobRowProps & {
  onDragStart: (jobId: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", job.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(job.id);
      }}
      onDragEnd={onDragEnd}
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
    >
      <JobRow job={job} showUser={showUser} isDragging={isDragging} />
    </div>
  );
}

// ── Folder Panel ──────────────────────────────────────────────────────────────

type FolderFilter = "all" | "unfiled" | string;

interface FolderEntryProps {
  id: FolderFilter;
  label: string;
  count?: number;
  icon: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
  onDrop: (jobId: string) => void;
  isAdmin?: boolean;
  onDelete?: () => void;
  onRename?: (name: string) => void;
  scope?: FolderScope;
  ownedByMe?: boolean;
  onScopeChange?: (scope: FolderScope) => void;
}

function FolderEntry({
  id, label, count, icon, selected, onSelect, onDrop, isAdmin, onDelete, onRename,
  scope, ownedByMe, onScopeChange,
}: FolderEntryProps) {
  const [isOver, setIsOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(label);
  const enterCount = useRef(0); // track nested dragenter/leave

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    enterCount.current += 1;
    if (enterCount.current === 1) setIsOver(true);
  };
  const handleDragLeave = () => {
    enterCount.current -= 1;
    if (enterCount.current === 0) setIsOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    enterCount.current = 0;
    setIsOver(false);
    const jobId = e.dataTransfer.getData("text/plain");
    if (jobId) onDrop(jobId);
  };

  const isStatic = id === "all" || id === "unfiled";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !editing && onSelect()}
      onKeyDown={(e) => e.key === "Enter" && !editing && onSelect()}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="group relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-150 cursor-pointer select-none"
      style={{
        backgroundColor: isOver
          ? "rgba(0,174,239,0.10)"
          : selected
          ? "rgba(0,174,239,0.07)"
          : undefined,
        border: isOver
          ? "1.5px solid rgba(0,174,239,0.55)"
          : selected
          ? "1.5px solid rgba(0,174,239,0.25)"
          : "1.5px solid transparent",
        boxShadow: isOver ? "0 0 0 3px rgba(0,174,239,0.12)" : undefined,
        transform: isOver ? "scale(1.01)" : undefined,
      }}
    >
      {/* Left accent bar */}
      <span
        className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full transition-all duration-150"
        style={{
          height: selected ? "60%" : isOver ? "40%" : "0%",
          backgroundColor: "#00AEEF",
        }}
      />

      {/* Icon */}
      <span
        className="shrink-0 transition-colors duration-150"
        style={{ color: selected || isOver ? "#00AEEF" : "var(--text-tertiary)" }}
      >
        {icon}
      </span>

      {/* Label */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editVal.trim() && editVal !== label) onRename?.(editVal.trim());
              setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              onBlur={() => setEditing(false)}
              className="w-full bg-transparent text-sm outline-none"
              style={{ color: "var(--text-primary)", fontWeight: 500 }}
            />
          </form>
        ) : (
          <span
            className="text-sm truncate block transition-colors duration-150"
            style={{
              color: selected || isOver ? "#00AEEF" : "var(--text-primary)",
              fontWeight: selected ? 600 : 500,
            }}
            onDoubleClick={(e) => {
              if (!isStatic && onRename) {
                e.stopPropagation();
                setEditVal(label);
                setEditing(true);
              }
            }}
          >
            {isOver && !selected ? "Drop here" : label}
          </span>
        )}
      </div>

      {/* Count badge */}
      {count !== undefined && !isOver && (
        <span
          className="shrink-0 text-[11px] tabular-nums font-semibold px-1.5 py-0.5 rounded-md min-w-[22px] text-center transition-all duration-150"
          style={{
            backgroundColor: selected ? "rgba(0,174,239,0.15)" : "#F0F1F2",
            color: selected ? "#00AEEF" : "#777878",
          }}
        >
          {count}
        </span>
      )}

      {/* Drop indicator chevron */}
      {isOver && (
        <span style={{ color: "#00AEEF" }}>
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      )}

      {/* Scope toggle — lock/globe, hover-only, for owner or admin */}
      {!isStatic && (ownedByMe || isAdmin) && scope && onScopeChange && !editing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onScopeChange(scope === "personal" ? "org" : "personal");
          }}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-0.5 rounded"
          style={{ color: scope === "org" ? "#00AEEF" : "#777878" }}
          title={scope === "personal" ? "Make team folder" : "Make personal folder"}
        >
          {scope === "personal" ? <LockIcon /> : <GlobeIcon />}
        </button>
      )}

      {/* Admin delete */}
      {isAdmin && !isStatic && !editing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete folder "${label}" and all its transcripts?`)) onDelete?.();
          }}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-0.5 rounded"
          style={{ color: "#EC008C" }}
          title="Delete folder"
        >
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function FolderPanel({
  selected,
  onSelect,
  isAdmin,
  onMoveJob,
}: {
  selected: FolderFilter;
  onSelect: (f: FolderFilter) => void;
  isAdmin: boolean;
  onMoveJob: (jobId: string, folderId: string | null) => void;
}) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScope, setNewScope] = useState<FolderScope>("personal");

  const { data } = useQuery<FolderListResponse>({
    queryKey: ["folders"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/folders", { token: token! });
      return res.json();
    },
    staleTime: 30_000,
  });

  const folders: Folder[] = data?.folders ?? [];
  const myFolders = folders.filter((f) => f.scope === "personal" && f.owned_by_me);
  const teamFolders = folders.filter((f) => f.scope === "org");
  const totalCount = folders.reduce((s, f) => s + f.job_count, 0);

  const { mutate: createFolder, isPending: isCreating } = useMutation({
    mutationFn: async ({ name, scope }: { name: string; scope: FolderScope }) => {
      const token = await getToken();
      const res = await apiFetch("/folders", { method: "POST", token: token!, body: JSON.stringify({ name, scope }) });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      setCreating(false);
      setNewName("");
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
      if (selected === id) onSelect("all");
    },
  });

  const renderFolder = (folder: Folder) => (
    <FolderEntry
      key={folder.id}
      id={folder.id}
      label={folder.name}
      count={folder.job_count}
      icon={<FolderIcon filled={selected === folder.id} />}
      selected={selected === folder.id}
      onSelect={() => onSelect(folder.id)}
      onDrop={(jobId) => onMoveJob(jobId, folder.id)}
      isAdmin={isAdmin}
      onDelete={() => deleteFolder(folder.id)}
      onRename={(name) => updateFolder({ id: folder.id, name })}
      scope={folder.scope}
      ownedByMe={folder.owned_by_me}
      onScopeChange={(scope) => updateFolder({ id: folder.id, scope })}
    />
  );

  return (
    <div
      className="rounded-2xl p-3 sticky top-8"
      style={{
        backgroundColor: "var(--surface)",
        border: "1px solid var(--border)",
        boxShadow: "0 4px 20px rgba(0,174,239,0.06)",
      }}
    >
      <div className="flex flex-col gap-0.5">
        {/* All */}
        <FolderEntry
          id="all" label="All" count={totalCount}
          icon={<AllIcon />}
          selected={selected === "all"}
          onSelect={() => onSelect("all")}
          onDrop={(jobId) => onMoveJob(jobId, null)}
        />

        {/* Unfiled */}
        <FolderEntry
          id="unfiled" label="Unfiled"
          icon={<InboxIcon />}
          selected={selected === "unfiled"}
          onSelect={() => onSelect("unfiled")}
          onDrop={(jobId) => onMoveJob(jobId, null)}
        />

        {/* My Folders */}
        <div className="mt-3 mb-1 px-3">
          <p className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: "#B1B3B6" }}>
            My Folders
          </p>
        </div>
        {myFolders.length === 0 && !creating && (
          <p className="text-[11px] px-3 py-0.5 italic" style={{ color: "#B1B3B6" }}>None yet</p>
        )}
        {myFolders.map(renderFolder)}

        {/* Team Folders */}
        <div className="mt-3 mb-1 px-3">
          <p className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: "#B1B3B6" }}>
            Team Folders
          </p>
        </div>
        {teamFolders.length === 0 && (
          <p className="text-[11px] px-3 py-0.5 italic" style={{ color: "#B1B3B6" }}>None yet</p>
        )}
        {teamFolders.map(renderFolder)}

        {/* Divider */}
        <div className="my-2 mx-3" style={{ borderTop: "1px solid var(--border)" }} />

        {/* New folder */}
        {creating ? (
          <form
            className="flex flex-col gap-2 px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) createFolder({ name: newName.trim(), scope: newScope });
            }}
          >
            {/* Scope toggle */}
            <div
              className="flex p-0.5 rounded-lg"
              style={{ backgroundColor: "var(--surface-subtle)", border: "1px solid var(--border)" }}
            >
              {(["personal", "org"] as FolderScope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setNewScope(s)}
                  className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-semibold transition-all duration-150"
                  style={
                    newScope === s
                      ? { backgroundColor: "#00AEEF", color: "#fff" }
                      : { color: "var(--text-tertiary)" }
                  }
                >
                  {s === "personal" ? <><LockIcon />&nbsp;Personal</> : <><GlobeIcon />&nbsp;Team</>}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => { if (!isCreating) { setCreating(false); setNewName(""); } }}
                placeholder="Folder name"
                className="flex-1 text-sm bg-transparent outline-none"
                style={{ color: "var(--text-primary)" }}
              />
              <button
                type="submit"
                onMouseDown={(e) => e.preventDefault()}
                disabled={isCreating || !newName.trim()}
                className="text-xs font-semibold px-2 py-0.5 rounded-lg text-white shrink-0"
                style={{ backgroundColor: "#00AEEF", opacity: isCreating ? 0.6 : 1 }}
              >
                {isCreating ? "…" : "Add"}
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl w-full text-left transition-all duration-150"
            style={{ color: "#B1B3B6" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#00AEEF"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#B1B3B6"; }}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-medium">New folder</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ folderId }: { folderId: FolderFilter }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="p-4 rounded-2xl mb-4" style={{ backgroundColor: "var(--surface-subtle)" }}>
        <svg className="h-8 w-8" style={{ color: "var(--text-tertiary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      {folderId === "unfiled" ? (
        <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>No unfiled transcriptions</p>
      ) : folderId !== "all" ? (
        <>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>This folder is empty</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>Drag a job here to move it</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>No transcriptions yet</p>
          <p className="text-xs mt-1 mb-5" style={{ color: "var(--text-tertiary)" }}>Upload a file to create your first job</p>
          <Link to="/upload" className="btn-primary text-sm font-semibold px-4 py-2 rounded-xl text-white active:scale-[0.98]">
            Upload a file
          </Link>
        </>
      )}
    </div>
  );
}

// ── My Jobs (with drag support) ───────────────────────────────────────────────

function MyJobs({ folderFilter }: { folderFilter: FolderFilter }) {
  const { getToken } = useAuth();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<JobListResponse>({
    queryKey: ["jobs", folderFilter],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams({ limit: "50" });
      if (folderFilter === "unfiled") params.set("folder_id", "unfiled");
      else if (folderFilter !== "all") params.set("folder_id", folderFilter);
      const res = await apiFetch(`/jobs?${params}`, { token: token! });
      return res.json();
    },
    refetchInterval: (q) => (q.state.data?.jobs ?? []).some((j) => !isTerminal(j.status)) ? 5000 : false,
  });

  const jobs = data?.jobs ?? [];

  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4">
        <p className="text-sm font-medium text-red-700">Failed to load jobs.</p>
      </div>
    );
  }

  if (!isLoading && jobs.length === 0) return <EmptyState folderId={folderFilter} />;

  return (
    <div
      className="rounded-2xl overflow-hidden shadow-card divide-y"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
    >
      {isLoading
        ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
        : jobs.map((job) => (
            <DraggableJobRow
              key={job.id}
              job={job}
              isDragging={draggingId === job.id}
              onDragStart={(id) => setDraggingId(id)}
              onDragEnd={() => setDraggingId(null)}
            />
          ))}
    </div>
  );
}

// ── All Jobs (admin) ──────────────────────────────────────────────────────────

function AllJobs() {
  const { getToken } = useAuth();
  const { data, isLoading, error } = useQuery<AdminJobListResponse>({
    queryKey: ["admin-jobs"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/admin/jobs?limit=100", { token: token! });
      return res.json();
    },
    refetchInterval: (q) => (q.state.data?.jobs ?? []).some((j) => !isTerminal(j.status)) ? 5000 : false,
  });

  const jobs = data?.jobs ?? [];

  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4">
        <p className="text-sm font-medium text-red-700">Failed to load jobs.</p>
      </div>
    );
  }

  if (!isLoading && jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>No jobs yet</p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl overflow-hidden shadow-card divide-y"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
    >
      {isLoading
        ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
        : jobs.map((job) => <JobRow key={job.id} job={job} showUser />)}
    </div>
  );
}

// ── Jobs Page ─────────────────────────────────────────────────────────────────

type Tab = "my" | "all";

export default function Jobs() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("my");
  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");

  const { data: me } = useQuery<UserMeResponse>({
    queryKey: ["me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/users/me", { token: token! });
      return res.json();
    },
    staleTime: 60_000,
  });

  const isAdmin = me?.role === "admin";

  const { mutate: moveJob } = useMutation({
    mutationFn: async ({ jobId, folderId }: { jobId: string; folderId: string | null }) => {
      const token = await getToken();
      await apiFetch(`/jobs/${jobId}/folder`, {
        method: "PATCH",
        token: token!,
        body: JSON.stringify({ folder_id: folderId }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
    },
  });

  function handleMoveJob(jobId: string, folderId: string | null) {
    moveJob({ jobId, folderId });
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between mb-7">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>Jobs</h1>
        <div className="flex items-center gap-3">
          {/* Admin tab switcher */}
          {isAdmin && (
            <div className="flex gap-1 p-1 rounded-xl" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}>
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
                  {t === "my" ? "My Jobs" : "All Jobs"}
                </button>
              ))}
            </div>
          )}

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
      </div>

      {/* Body — two column layout on My Jobs */}
      {tab === "my" ? (
        <div className="flex gap-5 items-start">
          {/* Folder panel */}
          <div className="w-48 shrink-0 hidden sm:block">
            <FolderPanel
              selected={folderFilter}
              onSelect={setFolderFilter}
              isAdmin={!!isAdmin}
              onMoveJob={handleMoveJob}
            />
          </div>

          {/* Job list */}
          <div className="flex-1 min-w-0">
            {/* Mobile: simple chip row above list */}
            <div className="flex gap-2 mb-4 sm:hidden flex-wrap">
              {(["all", "unfiled"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFolderFilter(f)}
                  className="px-3 py-1 rounded-full text-xs font-medium"
                  style={
                    folderFilter === f
                      ? { backgroundColor: "#00AEEF", color: "#fff" }
                      : { backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-secondary)" }
                  }
                >
                  {f === "all" ? "All" : "Unfiled"}
                </button>
              ))}
            </div>

            <MyJobs folderFilter={folderFilter} />
          </div>
        </div>
      ) : (
        <AllJobs />
      )}
    </div>
  );
}
