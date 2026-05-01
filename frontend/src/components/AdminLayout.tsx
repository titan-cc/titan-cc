import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { UserMeResponse } from "@/api/types";

export default function AdminLayout() {
  const { getToken } = useAuth();

  const { data: me, isLoading } = useQuery<UserMeResponse>({
    queryKey: ["me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/users/me", { token: token! });
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div
          className="h-6 w-6 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "var(--brand)" }}
        />
      </div>
    );
  }

  if (!me || me.role !== "admin") {
    return <Navigate to="/upload" replace />;
  }

  return <Outlet />;
}
