import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { UserButton, useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { apiFetch } from "@/api/client";
import type { Notification, NotificationListResponse, UserMeResponse } from "@/api/types";

// ── Icons ─────────────────────────────────────────────────────────────────────

function UploadIcon() {
  return (
    <svg className="h-[17px] w-[17px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function JobsIcon() {
  return (
    <svg className="h-[17px] w-[17px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function FailuresIcon() {
  return (
    <svg className="h-[17px] w-[17px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg className="h-[17px] w-[17px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m4-4a4 4 0 100-8 4 4 0 000 8zm6 0a3 3 0 100-6 3 3 0 000 6z" />
    </svg>
  );
}

function BillingIcon() {
  return (
    <svg className="h-[17px] w-[17px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// ── Brand ─────────────────────────────────────────────────────────────────────

function Brand() {
  return (
    <div className="flex items-center gap-1.5 select-none">
      <span className="h-4 w-[3px] rounded-full" style={{ backgroundColor: "var(--brand)" }} />
      <span className="text-[13px] text-white" style={{ fontWeight: 800, letterSpacing: "-0.01em" }}>
        Titan<span style={{ color: "var(--brand)" }}>CC</span>
      </span>
    </div>
  );
}

// ── NavItem ───────────────────────────────────────────────────────────────────

function NavItem({
  to,
  label,
  icon,
  onClick,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      end={to === "/"}
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-medium transition-ui"
      style={({ isActive }) =>
        isActive
          ? { backgroundColor: "var(--nav-active-bg)", color: "var(--nav-active-text)" }
          : { color: "var(--nav-idle-text)" }
      }
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        if (!el.getAttribute("aria-current")) {
          el.style.backgroundColor = "rgba(255,255,255,0.06)";
          el.style.color = "#fff";
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        if (!el.getAttribute("aria-current")) {
          el.style.backgroundColor = "";
          el.style.color = "var(--nav-idle-text)";
        }
      }}
    >
      {icon}
      {label}
    </NavLink>
  );
}

const MAIN_NAV = [
  { to: "/upload",   label: "Upload",   icon: <UploadIcon />   },
  { to: "/jobs",     label: "Jobs",     icon: <JobsIcon />     },
  { to: "/failures", label: "Failures", icon: <FailuresIcon /> },
];

function ActivityIcon() {
  return (
    <svg className="h-[17px] w-[17px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
    </svg>
  );
}

const ADMIN_NAV = [
  { to: "/admin/users",    label: "Users",    icon: <UsersIcon />    },
  { to: "/admin/activity", label: "Activity", icon: <ActivityIcon /> },
  { to: "/admin/billing",  label: "Billing",  icon: <BillingIcon />  },
];

// ── Notification bell ─────────────────────────────────────────────────────────

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
      {isUnread
        ? <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: "var(--brand)" }} />
        : <span className="mt-1.5 h-1.5 w-1.5 shrink-0" />
      }
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium leading-snug" style={{ color: "var(--text-primary)" }}>{n.title}</p>
        {n.body && (
          <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{n.body}</p>
        )}
        <p className="text-[10px] mt-1 tabular-nums" style={{ color: "var(--text-tertiary)" }}>{timeAgo(n.created_at)}</p>
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

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const hadUnreads = useRef(false);
  useEffect(() => { if (unreadCount > 0) hadUnreads.current = true; }, [unreadCount]);
  useEffect(() => {
    if (!open && hadUnreads.current) { hadUnreads.current = false; markAllRead(); }
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
          className="absolute bottom-full mb-2 left-0 w-80 rounded-2xl overflow-hidden z-50"
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
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--brand-subtle)", color: "var(--brand-dark)" }}>
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

// ── Sidebar content (shared desktop + mobile overlay) ─────────────────────────

function SidebarContent({ me, onClose }: { me?: UserMeResponse; onClose?: () => void }) {
  const isAdmin = me?.role === "admin";

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--nav-bg)" }}>

      {/* Brand */}
      <div className="px-5 h-14 flex items-center shrink-0" style={{ borderBottom: "1px solid var(--nav-border)" }}>
        <Brand />
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-3 pt-5 pb-3 flex flex-col gap-0.5">
        <p className="text-[10px] uppercase tracking-widest font-semibold px-2.5 mb-2" style={{ color: "rgba(255,255,255,0.25)" }}>
          Workspace
        </p>
        {MAIN_NAV.map((item) => (
          <NavItem key={item.to} {...item} onClick={onClose} />
        ))}
      </nav>

      {/* Admin section — visually separated to prevent accidental access */}
      {isAdmin && (
        <div className="px-3 pt-3 pb-3" style={{ borderTop: "1px solid var(--nav-border)" }}>
          <div className="flex items-center gap-1.5 px-2.5 mb-2">
            <span style={{ color: "rgba(236,0,140,0.7)" }}><ShieldIcon /></span>
            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "rgba(236,0,140,0.7)" }}>
              Admin
            </p>
          </div>
          <div className="flex flex-col gap-0.5">
            {ADMIN_NAV.map((item) => (
              <NavItem key={item.to} {...item} onClick={onClose} />
            ))}
          </div>
        </div>
      )}

      {/* Bottom: notifications + user avatar */}
      <div
        className="px-3 py-3 flex items-center gap-1"
        style={{ borderTop: "1px solid var(--nav-border)" }}
      >
        <NotificationBell />
        <UserButton appearance={{ elements: { userButtonAvatarBox: "h-7 w-7" } }} />
        {me?.email && (
          <span className="text-[11px] truncate flex-1 ml-1" style={{ color: "rgba(255,255,255,0.35)" }}>
            {me.email}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export default function Layout({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: me } = useQuery<UserMeResponse>({
    queryKey: ["me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/users/me", { token: token! });
      return res.json();
    },
    staleTime: 60_000,
  });

  // Close mobile sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, []);

  return (
    <div className="flex min-h-[100dvh]">

      {/* ── Desktop sidebar (fixed) ── */}
      <aside
        className="hidden md:flex flex-col fixed inset-y-0 left-0 z-30 w-56"
        style={{ borderRight: "1px solid var(--nav-border)" }}
      >
        <SidebarContent me={me} />
      </aside>

      {/* ── Mobile overlay ── */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
            onClick={() => setSidebarOpen(false)}
          />
          {/* Drawer */}
          <aside className="relative w-56 flex flex-col" style={{ borderRight: "1px solid var(--nav-border)" }}>
            <SidebarContent me={me} onClose={() => setSidebarOpen(false)} />
          </aside>
          {/* Close button */}
          <button
            className="absolute top-3 left-[232px] p-1.5 rounded-lg text-white"
            style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
            onClick={() => setSidebarOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {/* ── Mobile top bar ── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-30 h-12 flex items-center justify-between px-4"
        style={{ backgroundColor: "var(--nav-bg)", borderBottom: "1px solid var(--nav-border)" }}
      >
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-1.5 rounded-lg transition-ui"
          style={{ color: "var(--nav-idle-text)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#fff"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--nav-idle-text)"; }}
        >
          <MenuIcon />
        </button>
        <Brand />
        <div className="flex items-center gap-1">
          <NotificationBell />
          <UserButton appearance={{ elements: { userButtonAvatarBox: "h-7 w-7" } }} />
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="flex-1 md:ml-56 pt-12 md:pt-0 min-w-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
