import { useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useCurrentUser } from "@/api/hooks";
import WordListView, { type TermDraft, type VocabularyTerm } from "./WordListView";

export default function WordList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { data: me } = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: terms, isLoading, isError } = useQuery<VocabularyTerm[]>({
    queryKey: ["vocabulary"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/vocabulary", { token: token! });
      return res.json();
    },
  });

  async function call(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      await apiFetch(path, { token: token!, method, body: body ? JSON.stringify(body) : undefined });
      await queryClient.invalidateQueries({ queryKey: ["vocabulary"] });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return <div className="animate-pulse h-64 rounded-2xl" style={{ backgroundColor: "var(--surface-raised)" }} />;
  }
  if (isError) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 max-w-lg">
        <p className="text-sm font-medium text-red-700">The word list couldn't be loaded. Refresh to try again.</p>
      </div>
    );
  }

  return (
    <WordListView
      terms={terms ?? []}
      isAdmin={me?.role === "admin"}
      busy={busy}
      error={error}
      onClearError={() => setError(null)}
      onCreate={(d: TermDraft) => call("/vocabulary", "POST", d)}
      onUpdate={(id: string, d: TermDraft) => call(`/vocabulary/${id}`, "PATCH", d)}
      onDelete={(id: string) => call(`/vocabulary/${id}`, "DELETE")}
    />
  );
}
