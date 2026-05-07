import React, { useState, useRef, KeyboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-react";
import { apiFetch } from "../api/client";

interface TagEditorProps {
  jobId: string;
  tags: string[];
}

export function TagEditor({ jobId, tags }: TagEditorProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { getToken } = useAuth();

  const mutation = useMutation({
    mutationFn: async (newTags: string[]) => {
      const token = await getToken();
      return apiFetch(`/jobs/${jobId}/tags`, {
        method: "PATCH",
        token: token!,
        body: JSON.stringify({ tags: newTags }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  function addTag(raw: string) {
    const t = raw.trim().toLowerCase();
    if (!t || tags.includes(t)) return;
    mutation.mutate([...tags, t]);
    setInputValue("");
  }

  function removeTag(t: string) {
    mutation.mutate(tags.filter((x) => x !== t));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && inputValue === "" && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === "Escape") {
      setEditing(false);
      setInputValue("");
    }
  }

  if (!editing) {
    return (
      <div
        className="flex flex-wrap gap-1 items-center cursor-pointer group"
        onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        title="Click to edit tags"
      >
        {tags.length === 0 ? (
          <span className="text-xs text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors">
            + add tag
          </span>
        ) : (
          tags.map((t) => (
            <TagBadge key={t} tag={t} />
          ))
        )}
        {tags.length > 0 && (
          <span className="text-xs text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors ml-1">
            ✏️
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap gap-1 items-center border border-[var(--border)] rounded-md px-2 py-1 bg-[var(--surface-raised)] min-h-[32px]"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30"
        >
          {t}
          <button
            type="button"
            className="hover:text-red-400 transition-colors leading-none"
            onClick={(e) => { e.stopPropagation(); removeTag(t); }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (inputValue) addTag(inputValue);
          setEditing(false);
          setInputValue("");
        }}
        placeholder={tags.length === 0 ? "Type tag, press Enter…" : "Add tag…"}
        className="flex-1 min-w-[120px] bg-transparent text-xs outline-none text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
      />
      {mutation.isPending && (
        <span className="text-xs text-[var(--text-tertiary)] animate-pulse">saving…</span>
      )}
    </div>
  );
}

export function TagBadge({ tag, onClick }: { tag: string; onClick?: (e?: React.MouseEvent) => void }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 ${onClick ? "cursor-pointer hover:bg-blue-500/30 transition-colors" : ""}`}
      onClick={onClick}
    >
      #{tag}
    </span>
  );
}
