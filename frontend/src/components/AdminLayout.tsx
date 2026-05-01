import { Navigate, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { UserMeResponse } from "@/api/types";

function UsersIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m4-4a4 4 0 100-8 4 4 0 000 8zm6 0a3 3 0 100-6 3 3 0 000 6zM3 20v-2a3 3 0 013-3" />
    </svg>
  );
}

function BillingIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

const ADMIN_NAV = [
  { to: "/admin/users",   label: "Users",   Icon: UsersIcon   },
  { to: "/admin/billing", label: "Billing", Icon: BillingIcon },
];

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

  return (
    <div className="flex gap-6 items-start">
      {/* Sidebar */}
      <aside
        className="w-44 shrink-0 rounded-2xl overflow-hidden sticky top-[70px]"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div className="px-3 pt-4 pb-2">
          <p
            className="text-[10px] uppercase tracking-widest font-semibold px-2 mb-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            Admin
          </p>
          <nav className="flex flex-col gap-0.5">
            {ADMIN_NAV.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-medium transition-colors ${
                    isActive ? "text-white" : ""
                  }`
                }
                style={({ isActive }) =>
                  isActive
                    ? { backgroundColor: "var(--nav-active-bg)", color: "var(--nav-active-text)" }
                    : { color: "var(--text-secondary)" }
                }
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  if (!el.getAttribute("aria-current")) {
                    el.style.backgroundColor = "rgba(255,255,255,0.05)";
                    el.style.color = "var(--text-primary)";
                  }
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  if (!el.getAttribute("aria-current")) {
                    el.style.backgroundColor = "";
                    el.style.color = "var(--text-secondary)";
                  }
                }}
              >
                <Icon />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="px-3 py-3 mt-1" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="text-[11px] px-2" style={{ color: "var(--text-tertiary)" }}>
            Signed in as admin
          </p>
          <p className="text-[11px] px-2 truncate mt-0.5 font-medium" style={{ color: "var(--text-secondary)" }}>
            {me.email}
          </p>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
