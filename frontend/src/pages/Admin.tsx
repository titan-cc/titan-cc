import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { AccessLevel, AdminUser, AdminUserListResponse, UserMeResponse, UserRole } from "@/api/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCESS_LEVELS: AccessLevel[] = ["basic", "standard", "pro", "enterprise"];
const ROLES: UserRole[] = ["user", "admin"];

const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  basic: "Basic",
  standard: "Standard",
  pro: "Pro",
  enterprise: "Enterprise",
};

const ACCESS_LEVEL_COLORS: Record<AccessLevel, { bg: string; text: string }> = {
  basic:      { bg: "rgba(255,255,255,0.07)", text: "var(--text-secondary)" },
  standard:   { bg: "rgba(59,130,246,0.15)",  text: "#60a5fa" },
  pro:        { bg: "rgba(139,92,246,0.15)",   text: "#a78bfa" },
  enterprise: { bg: "rgba(251,191,36,0.15)",   text: "#fbbf24" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatMinutes(mins: number) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function Badge({ label, colors }: { label: string; colors: { bg: string; text: string } }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {label}
    </span>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ backgroundColor: enabled ? "var(--brand)" : "rgba(255,255,255,0.12)" }}
    >
      <span
        className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 mt-0.5"
        style={{ transform: enabled ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

// ── Inline Select ─────────────────────────────────────────────────────────────

function InlineSelect<T extends string>({
  value,
  options,
  labels,
  onChange,
  disabled,
}: {
  value: T;
  options: T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      disabled={disabled}
      className="text-[12px] rounded-lg px-2 py-1 border-0 outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        backgroundColor: "rgba(255,255,255,0.06)",
        color: "var(--text-primary)",
        appearance: "auto",
      }}
    >
      {options.map((opt) => (
        <option key={opt} value={opt} style={{ backgroundColor: "var(--surface)" }}>
          {labels[opt]}
        </option>
      ))}
    </select>
  );
}

// ── User Row ──────────────────────────────────────────────────────────────────

function UserRow({
  user,
  isSelf,
  onUpdate,
  onRefreshQuota,
}: {
  user: AdminUser;
  isSelf: boolean;
  onUpdate: (id: string, patch: { role?: UserRole; is_enabled?: boolean; access_level?: AccessLevel }) => void;
  onRefreshQuota: (id: string) => void;
}) {
  const quota = user.quota;
  const usedPct = quota
    ? Math.min(100, Math.round((quota.minutes_used_this_month / quota.max_minutes_per_month) * 100))
    : 0;

  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      {/* Email + joined */}
      <td className="py-3 pr-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
            {user.email}
            {isSelf && (
              <span className="ml-2 text-[10px] font-normal" style={{ color: "var(--text-tertiary)" }}>
                (you)
              </span>
            )}
          </span>
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Joined {formatDate(user.created_at)}
          </span>
        </div>
      </td>

      {/* Role */}
      <td className="py-3 pr-4">
        <InlineSelect<UserRole>
          value={user.role}
          options={ROLES}
          labels={{ user: "User", admin: "Admin" }}
          onChange={(v) => onUpdate(user.id, { role: v })}
          disabled={isSelf}
        />
      </td>

      {/* Access level */}
      <td className="py-3 pr-4">
        <InlineSelect<AccessLevel>
          value={user.access_level}
          options={ACCESS_LEVELS}
          labels={ACCESS_LEVEL_LABELS}
          onChange={(v) => onUpdate(user.id, { access_level: v })}
        />
      </td>

      {/* Enabled */}
      <td className="py-3 pr-4">
        <Toggle
          enabled={user.is_enabled}
          onChange={(v) => onUpdate(user.id, { is_enabled: v })}
          disabled={isSelf}
        />
      </td>

      {/* Jobs */}
      <td className="py-3 pr-4 tabular-nums text-[13px]" style={{ color: "var(--text-secondary)" }}>
        {user.job_count}
      </td>

      {/* Quota usage */}
      <td className="py-3 pr-4 min-w-[140px]">
        {quota ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {formatMinutes(quota.minutes_used_this_month)} / {formatMinutes(quota.max_minutes_per_month)}
              </span>
              <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                {usedPct}%
              </span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${usedPct}%`,
                  backgroundColor: usedPct > 85 ? "#f87171" : usedPct > 60 ? "#fbbf24" : "var(--brand)",
                }}
              />
            </div>
          </div>
        ) : (
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>—</span>
        )}
      </td>

      {/* Refresh quota */}
      <td className="py-3">
        <button
          onClick={() => onRefreshQuota(user.id)}
          title="Reset this month's quota usage to zero"
          className="text-[11px] px-2.5 py-1 rounded-lg font-medium transition-ui"
          style={{
            backgroundColor: "rgba(255,255,255,0.06)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.10)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.06)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
          }}
        >
          Reset quota
        </button>
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Admin() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Gate: only admins see this page
  const { data: me, isLoading: meLoading } = useQuery<UserMeResponse>({
    queryKey: ["me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/users/me", { token: token! });
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data, isLoading } = useQuery<AdminUserListResponse>({
    queryKey: ["admin", "users", debouncedSearch],
    queryFn: async () => {
      const token = await getToken();
      const url = debouncedSearch
        ? `/admin/users?limit=100&search=${encodeURIComponent(debouncedSearch)}`
        : "/admin/users?limit=100";
      const res = await apiFetch(url, { token: token! });
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
    enabled: me?.role === "admin",
    staleTime: 30_000,
  });

  const { mutate: updateUser } = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: object }) => {
      const token = await getToken();
      const res = await apiFetch(`/admin/users/${id}`, {
        method: "PATCH",
        token: token!,
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? "Update failed");
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
    onError: (err) => alert((err as Error).message),
  });

  const { mutate: refreshQuota } = useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      const res = await apiFetch(`/admin/users/${id}/quota/refresh`, {
        method: "POST",
        token: token!,
      });
      if (!res.ok) throw new Error("Failed to refresh quota");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
    onError: (err) => alert((err as Error).message),
  });

  function handleSearchChange(val: string) {
    setSearch(val);
    if (searchTimer) clearTimeout(searchTimer);
    const t = setTimeout(() => setDebouncedSearch(val), 300);
    setSearchTimer(t);
  }

  if (meLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-6 w-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--brand)" }} />
      </div>
    );
  }

  if (!me || me.role !== "admin") {
    return <Navigate to="/upload" replace />;
  }

  const users = data?.users ?? [];

  // Summarise counts
  const totalEnabled = users.filter((u) => u.is_enabled).length;
  const totalAdmins = users.filter((u) => u.role === "admin").length;
  const levelCounts = ACCESS_LEVELS.reduce<Record<string, number>>((acc, l) => {
    acc[l] = users.filter((u) => u.access_level === l).length;
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            User Management
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--text-secondary)" }}>
            Manage access levels, roles, and quotas for all users.
          </p>
        </div>

        {/* Search */}
        <input
          type="search"
          placeholder="Search by email…"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="text-[13px] rounded-xl px-3 py-2 outline-none w-full sm:w-64"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
      </div>

      {/* Stats row */}
      {!isLoading && users.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(
            [
              { label: "Total users",   value: users.length },
              { label: "Active",        value: totalEnabled },
              { label: "Admins",        value: totalAdmins },
              { label: "Pro + Enterprise", value: (levelCounts.pro ?? 0) + (levelCounts.enterprise ?? 0) },
            ] as { label: string; value: number }[]
          ).map(({ label, value }) => (
            <div
              key={label}
              className="rounded-2xl px-4 py-3"
              style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <p className="text-[11px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text-tertiary)" }}>
                {label}
              </p>
              <p className="text-[22px] font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Table card */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div
              className="h-6 w-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--brand)" }}
            />
          </div>
        ) : users.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
              {debouncedSearch ? "No users match your search." : "No users yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["User", "Role", "Access Level", "Enabled", "Jobs", "Quota (this month)", ""].map((h) => (
                    <th
                      key={h}
                      className="px-0 pr-4 py-3 text-left text-[10px] uppercase tracking-widest font-semibold first:pl-4"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    isSelf={user.id === me.id}
                    onUpdate={(id, patch) => updateUser({ id, patch })}
                    onRefreshQuota={(id) => refreshQuota(id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Access level legend */}
      <div
        className="rounded-2xl p-5"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <p className="text-[11px] uppercase tracking-widest font-semibold mb-4" style={{ color: "var(--text-tertiary)" }}>
          Access Level Presets
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(
            [
              { level: "basic" as AccessLevel,      concurrent: 2,  monthlyMin: 300,  maxFile: "2 hr" },
              { level: "standard" as AccessLevel,   concurrent: 3,  monthlyMin: 600,  maxFile: "2 hr" },
              { level: "pro" as AccessLevel,        concurrent: 5,  monthlyMin: 1200, maxFile: "4 hr" },
              { level: "enterprise" as AccessLevel, concurrent: 10, monthlyMin: 5000, maxFile: "8 hr" },
            ]
          ).map(({ level, concurrent, monthlyMin, maxFile }) => (
            <div
              key={level}
              className="rounded-xl p-3 space-y-2"
              style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
            >
              <Badge label={ACCESS_LEVEL_LABELS[level]} colors={ACCESS_LEVEL_COLORS[level]} />
              <ul className="text-[11px] space-y-0.5" style={{ color: "var(--text-secondary)" }}>
                <li>{concurrent} concurrent jobs</li>
                <li>{formatMinutes(monthlyMin)}/month</li>
                <li>Up to {maxFile} per file</li>
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
