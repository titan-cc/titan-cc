import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { SearchResponse } from "@/api/types";
import StatusBadge from "@/components/StatusBadge";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Render ts_headline output (which uses <mark>…</mark> tags) safely
function Snippet({ html }: { html: string }) {
  return (
    <p
      className="text-xs leading-relaxed mt-1.5"
      style={{ color: "var(--text-secondary)" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function Search() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const initialQ = params.get("q") ?? "";
  const [inputVal, setInputVal] = useState(initialQ);

  // Sync input when URL changes (e.g. browser back)
  useEffect(() => { setInputVal(params.get("q") ?? ""); }, [params]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  const q = params.get("q") ?? "";

  const { data, isFetching, error } = useQuery<SearchResponse>({
    queryKey: ["search", q],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch(`/search?q=${encodeURIComponent(q)}`, { token: token! });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: q.trim().length > 0,
    staleTime: 30_000,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inputVal.trim();
    if (trimmed) navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  const hits = data?.hits ?? [];

  return (
    <div className="max-w-2xl">
      {/* Search bar */}
      <form onSubmit={handleSubmit} className="mb-8">
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-2xl"
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border-strong, var(--border))" }}
        >
          <svg className="h-4 w-4 shrink-0" style={{ color: "var(--text-tertiary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="Search across all transcripts…"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          {isFetching && (
            <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>Searching…</span>
          )}
          {inputVal && (
            <button
              type="button"
              onClick={() => { setInputVal(""); navigate("/search"); inputRef.current?.focus(); }}
              className="text-[11px] px-2 py-0.5 rounded-md"
              style={{ color: "var(--text-tertiary)" }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {/* Results */}
      {q && !isFetching && !error && hits.length === 0 && (
        <div className="text-center py-16">
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            No results for "<span style={{ color: "var(--text-primary)" }}>{q}</span>"
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
            Only completed transcriptions are searchable.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4">
          <p className="text-sm font-medium text-red-700">Search failed. Please try again.</p>
        </div>
      )}

      {hits.length > 0 && (
        <div>
          <p className="text-xs mb-4" style={{ color: "var(--text-tertiary)" }}>
            {hits.length} result{hits.length !== 1 ? "s" : ""} for "<span style={{ color: "var(--text-secondary)" }}>{q}</span>"
          </p>
          <div
            className="rounded-2xl overflow-hidden divide-y shadow-card"
            style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
          >
            {hits.map((hit) => (
              <Link
                key={hit.job_id}
                to={`/jobs/${hit.job_id}`}
                className="flex flex-col px-5 py-4 transition-ui"
                style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface-subtle)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "")}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusBadge status={hit.status} />
                    <span className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                      {hit.input_filename ?? hit.job_id.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {hit.folder_name && (
                      <span
                        className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: "var(--surface-subtle)", color: "var(--text-tertiary)", border: "1px solid var(--border)" }}
                      >
                        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                        </svg>
                        {hit.folder_name}
                      </span>
                    )}
                    <span className="text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                      {timeAgo(hit.created_at)}
                    </span>
                  </div>
                </div>
                {hit.snippet && <Snippet html={hit.snippet} />}
              </Link>
            ))}
          </div>
        </div>
      )}

      {!q && (
        <div className="text-center py-16">
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Type a keyword to search across all your transcripts.
          </p>
        </div>
      )}
    </div>
  );
}
