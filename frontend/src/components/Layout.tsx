import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { UserButton, useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { apiFetch } from "@/api/client";
import type { Notification, NotificationListResponse, UserMeResponse } from "@/api/types";

function BellIcon() {
  return (
    <svg className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
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

function NotificationItem({ n }: { n: Notification }) {
  const isUnread = !n.read_at;
  return (
    <div
      className="px-4 py-3 flex gap-3 items-start"
      style={{ borderBottom: "1px solid var(--border)", opacity: isUnread ? 1 : 0.65 }}
    >
      {isUnread && (
        <span
          className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0"
          style={{ backgroundColor: "var(--brand)" }}
        />
      )}
      {!isUnread && <span className="mt-1.5 h-1.5 w-1.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium leading-snug" style={{ color: "var(--text-primary)" }}>
          {n.title}
        </p>
        {n.body && (
          <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {n.body}
          </p>
        )}
        <p className="text-[10px] mt-1 tabular-nums" style={{ color: "var(--text-tertiary)" }}>
          {timeAgo(n.created_at)}
        </p>
      </div>
    </div>
  );
}

function NotificationBell() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const { data } = useQuery<NotificationListResponse>({
    queryKey: ["notifications", "unread"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/notifications?unread=true&limit=20", { token: token! });
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const { data: allData } = useQuery<NotificationListResponse>({
    queryKey: ["notifications", "all"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/notifications?limit=20", { token: token! });
      return res.json();
    },
    enabled: open,
    staleTime: 10_000,
  });

  const { mutate: markAllRead } = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      await apiFetch("/notifications/read-all", { method: "POST", token: token! });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = data?.notifications.length ?? 0;
  const notifications = allData?.notifications ?? [];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Mark all read when panel closes if there were unreads
  const hadUnreads = useRef(false);
  useEffect(() => { if (unreadCount > 0) hadUnreads.current = true; }, [unreadCount]);
  useEffect(() => {
    if (!open && hadUnreads.current) {
      hadUnreads.current = false;
      markAllRead();
    }
  }, [open, markAllRead]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        title={unreadCount > 0 ? `${unreadCount} unread` : "Notifications"}
        className="relative p-2 rounded-lg transition-ui"
        style={{ color: open ? "#fff" : "var(--nav-idle-text)", backgroundColor: open ? "rgba(255,255,255,0.07)" : "" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#fff"; (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.07)"; }}
        onMouseLeave={(e) => { if (!open) { (e.currentTarget as HTMLElement).style.color = "var(--nav-idle-text)"; (e.currentTarget as HTMLElement).style.backgroundColor = ""; } }}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full text-[8px] font-semibold text-white leading-none tabular-nums"
            style={{ backgroundColor: "var(--brand)" }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-80 rounded-2xl overflow-hidden z-50"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border-strong, var(--border))",
            boxShadow: "0 8px 32px rgba(26,3,21,0.14)",
          }}
        >
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
              Notifications
            </span>
            {unreadCount > 0 && (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: "var(--brand-subtle)", color: "var(--brand-dark)" }}
              >
                {unreadCount} new
              </span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => <NotificationItem key={n.id} n={n} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const BASE_NAV = [
  { to: "/upload",   label: "Upload"   },
  { to: "/jobs",     label: "Jobs"     },
  { to: "/failures", label: "Failures" },
];

function useIsAdmin() {
  const { getToken } = useAuth();
  const { data } = useQuery<UserMeResponse>({
    queryKey: ["me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/users/me", { token: token! });
      return res.json();
    },
    staleTime: 60_000,
  });
  return data?.role === "admin";
}

export default function Layout({ children }: { children: ReactNode }) {
  const isAdmin = useIsAdmin();
  const NAV = isAdmin
    ? [...BASE_NAV, { to: "/admin", label: "Admin" }]
    : BASE_NAV;

  return (
    <div className="min-h-[100dvh]" style={{ backgroundColor: "var(--surface-subtle)" }}>
      <header
        className="sticky top-0 z-40"
        style={{
          backgroundColor: "var(--nav-bg)",
          borderBottom: "1px solid var(--nav-border)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[54px] flex items-center justify-between gap-4 sm:gap-8">
          {/* Brand */}
          <div className="flex items-center gap-4 sm:gap-8 min-w-0">
            <div className="flex items-center gap-1.5 select-none shrink-0">
              <span
                className="h-4 w-[3px] rounded-full"
                style={{ backgroundColor: "var(--brand)" }}
              />
              <span className="text-[13px] text-white" style={{ fontWeight: 800, letterSpacing: "-0.01em" }}>
                Titan<span style={{ color: "var(--brand)" }}>CC</span>
              </span>
            </div>

            {/* Nav links */}
            <nav className="flex items-center gap-0.5">
              {NAV.map(({ to, label }: { to: string; label: string }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-lg text-[13px] font-medium transition-ui whitespace-nowrap ${
                      isActive ? "text-white" : "hover:text-white"
                    }`
                  }
                  style={({ isActive }) =>
                    isActive
                      ? { backgroundColor: "var(--nav-active-bg)", color: "var(--nav-active-text)" }
                      : { color: "var(--nav-idle-text)" }
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Right */}
          <div className="flex items-center gap-1.5 shrink-0">
            <NotificationBell />
            <UserButton
              appearance={{ elements: { userButtonAvatarBox: "h-7 w-7" } }}
            />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">{children}</main>
    </div>
  );
}
