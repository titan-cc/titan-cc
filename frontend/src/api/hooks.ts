import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { TranscriptResponse, UserMeResponse } from "./types";

export function useCurrentUser() {
  const { getToken } = useAuth();
  return useQuery<UserMeResponse>({
    queryKey: ["me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/users/me", { token: token! });
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useTranscript(jobId: string, enabled: boolean) {
  const { getToken } = useAuth();
  return useQuery<TranscriptResponse>({
    queryKey: ["transcript", jobId],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch(`/jobs/${jobId}/transcript`, { token: token! });
      return res.json();
    },
    enabled,
    staleTime: 4 * 60 * 1000,          // presigned URLs valid for 5 min; keep fresh
    gcTime: 5 * 60 * 1000,
    refetchInterval: 4 * 60 * 1000,    // auto-refresh every 4 min so links never silently expire
    refetchIntervalInBackground: false, // pause when tab hidden; refetchOnWindowFocus handles return
  });
}
