import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { Job, TranscriptResponse } from "@/api/types";
import EditView from "./transcript/EditView";
import type { Segment } from "./transcript/model";

interface TranscriptContent {
  job_id: string;
  segments: Segment[];
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center justify-between mb-6">
        <div className="h-4 w-24 rounded-full" style={{ backgroundColor: "var(--surface-raised)" }} />
        <div className="h-9 w-32 rounded-xl" style={{ backgroundColor: "var(--surface-raised)" }} />
      </div>
      <div className="flex gap-4" style={{ height: 480 }}>
        <div className="flex-1 rounded-2xl" style={{ backgroundColor: "var(--surface-raised)" }} />
        <div className="flex-1 rounded-2xl" style={{ backgroundColor: "var(--surface-raised)" }} />
      </div>
    </div>
  );
}

const BackLink = (
  <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm transition-ui shrink-0" style={{ color: "var(--text-tertiary)" }}>
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
    Back
  </Link>
);

export default function TranscriptViewer() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [localSegments, setLocalSegments] = useState<Segment[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { data: job } = useQuery<Job>({
    queryKey: ["job", id],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch(`/jobs/${id}`, { token: token! });
      return res.json();
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: meta, isLoading: metaLoading } = useQuery<TranscriptResponse>({
    queryKey: ["transcript", id],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch(`/jobs/${id}/transcript`, { token: token! });
      return res.json();
    },
    enabled: !!id,
    staleTime: 4 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 4 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  const jsonUrl = meta?.downloads?.json?.url;

  const { data: content, isLoading: contentLoading } = useQuery<TranscriptContent>({
    queryKey: ["transcript-content", jsonUrl],
    queryFn: () => fetch(jsonUrl!).then((r) => r.json()),
    enabled: !!jsonUrl,
    staleTime: 4 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (content?.segments) setLocalSegments(content.segments);
  }, [content]);

  const saveMutation = useMutation({
    mutationFn: async (segments: Segment[]) => {
      const token = await getToken();
      const res = await apiFetch(`/jobs/${id}/transcript`, {
        token: token!,
        method: "PUT",
        body: JSON.stringify({ segments }),
      });
      return res.json() as Promise<TranscriptResponse>;
    },
    onMutate: () => {
      clearTimeout(savedTimer.current);
      setSaveState("saving");
    },
    onSuccess: (updatedMeta, savedSegments) => {
      queryClient.setQueryData(["transcript", id], updatedMeta);
      // Seed the new content cache key so the viewer never drops into a loading state after a save.
      const newJsonUrl = updatedMeta.downloads?.json?.url;
      if (newJsonUrl) {
        queryClient.setQueryData<TranscriptContent>(["transcript-content", newJsonUrl], { job_id: id!, segments: savedSegments });
      }
      setSaveState("saved");
      savedTimer.current = setTimeout(() => setSaveState("idle"), 2500);
    },
    onError: () => setSaveState("error"),
  });

  async function handleRemember(term: string, heardAs: string): Promise<boolean> {
    try {
      const token = await getToken();
      await apiFetch("/vocabulary/remember", {
        token: token!,
        method: "POST",
        body: JSON.stringify({ term, heard_as: heardAs }),
      });
      queryClient.invalidateQueries({ queryKey: ["vocabulary"] });
      return true;
    } catch {
      return false;
    }
  }

  function handleChange(segments: Segment[]) {
    setLocalSegments(segments);
    saveMutation.mutate(segments);
  }

  // Only block on the very first load, never during post-save refetches.
  if ((metaLoading || contentLoading) && localSegments.length === 0) return <Skeleton />;

  if (!meta || (!content && localSegments.length === 0)) {
    return (
      <div className="max-w-lg">
        <div className="mb-6">{BackLink}</div>
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4">
          <p className="text-sm font-medium text-red-700">Transcript unavailable.</p>
        </div>
      </div>
    );
  }

  return (
    <EditView
      filename={job?.input_filename ?? "Transcript"}
      segments={localSegments}
      videoUrl={meta.video_url}
      downloads={meta.downloads}
      saveState={saveState}
      onChange={handleChange}
      onRemember={handleRemember}
      backLink={BackLink}
    />
  );
}
