import { useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { BillingResponse, ProviderBilling } from "@/api/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function usd(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function usd4(amount: number) {
  return `$${amount.toFixed(4)}`;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

// ── Provider logos (simple colored text badges) ───────────────────────────────

const PROVIDER_META: Record<string, { name: string; color: string; bg: string }> = {
  runpod:  { name: "RunPod",   color: "#a78bfa", bg: "rgba(139,92,246,0.10)" },
  railway: { name: "Railway",  color: "#60a5fa", bg: "rgba(59,130,246,0.10)" },
  aws:     { name: "AWS",      color: "#fbbf24", bg: "rgba(251,191,36,0.10)" },
};

// ── Provider card ─────────────────────────────────────────────────────────────

function ProviderCard({ billing }: { billing: ProviderBilling }) {
  const meta = PROVIDER_META[billing.provider] ?? { name: billing.provider, color: "#fff", bg: "rgba(255,255,255,0.05)" };

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between gap-3">
          <span
            className="text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md"
            style={{ backgroundColor: meta.bg, color: meta.color }}
          >
            {meta.name}
          </span>
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{billing.period}</span>
        </div>

        {billing.error ? (
          <div className="mt-3 flex items-start gap-2" style={{ color: "#f87171" }}>
            <AlertIcon />
            <p className="text-[12px] leading-snug">{billing.error}</p>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-[28px] font-bold tabular-nums tracking-tight" style={{ color: "var(--text-primary)" }}>
              {billing.total_usd !== null ? usd(billing.total_usd) : "—"}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {billing.provider === "runpod" ? "credit balance" : "this month"}
            </p>
          </div>
        )}
      </div>

      {/* Line items */}
      {!billing.error && billing.items.length > 0 && (
        <div className="px-5 py-3 flex-1 space-y-2">
          {billing.items.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-2">
              <span className="text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                {item.label}
              </span>
              <span className="text-[12px] tabular-nums shrink-0 font-medium" style={{ color: "var(--text-primary)" }}>
                {usd(item.amount_usd)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Meta (RunPod spend rate, discounts, etc.) */}
      {!billing.error && Object.keys(billing.meta).length > 0 && (
        <div className="px-5 py-3 space-y-1.5" style={{ borderTop: billing.items.length > 0 ? "1px solid var(--border)" : undefined }}>
          {Object.entries(billing.meta).map(([key, val]) => {
            if (key === "spend_rate_per_hr") return null; // shown via spend_rate_label
            return (
              <div key={key} className="flex items-center justify-between gap-2">
                <span className="text-[11px] capitalize" style={{ color: "var(--text-tertiary)" }}>
                  {key.replace(/_/g, " ")}
                </span>
                <span className="text-[12px] tabular-nums font-medium" style={{ color: "var(--text-secondary)" }}>
                  {typeof val === "number" ? usd4(val) : String(val)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!billing.error && billing.items.length === 0 && Object.keys(billing.meta).length === 0 && (
        <div className="px-5 py-4">
          <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>No line items available.</p>
        </div>
      )}
    </div>
  );
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className="rounded-2xl p-5 space-y-4"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="h-4 w-20 rounded-md animate-pulse" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
      <div className="h-8 w-28 rounded-md animate-pulse" style={{ backgroundColor: "rgba(255,255,255,0.07)" }} />
      <div className="space-y-2 pt-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex justify-between">
            <div className="h-3 rounded-md animate-pulse" style={{ backgroundColor: "rgba(255,255,255,0.06)", width: `${40 + i * 10}%` }} />
            <div className="h-3 w-12 rounded-md animate-pulse" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminBilling() {
  const { getToken } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, isLoading, isFetching, error } = useQuery<BillingResponse>({
    queryKey: ["admin", "billing", refreshKey],
    queryFn: async () => {
      const token = await getToken();
      const url = refreshKey > 0 ? "/admin/billing?refresh=true" : "/admin/billing";
      const res = await apiFetch(url, { token: token! });
      if (!res.ok) throw new Error("Failed to fetch billing data");
      return res.json();
    },
    staleTime: 270_000, // 4.5 min — just under the server-side 5-min cache
  });

  const monthlySpend =
    data
      ? [data.railway, data.aws]
          .filter((p) => !p.error && p.total_usd !== null)
          .reduce((sum, p) => sum + (p.total_usd ?? 0), 0)
      : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Billing
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--text-secondary)" }}>
            Live costs across RunPod, Railway, and AWS — {data?.period ?? "…"}
          </p>
        </div>

        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-xl transition-ui disabled:opacity-50"
          style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
        >
          <RefreshIcon spinning={isFetching} />
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Summary bar (Railway + AWS spend only) */}
      {monthlySpend !== null && monthlySpend > 0 && (
        <div
          className="rounded-2xl px-5 py-4 flex items-center justify-between"
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div>
            <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-tertiary)" }}>
              Railway + AWS this month
            </p>
            <p className="text-[26px] font-bold tabular-nums mt-0.5" style={{ color: "var(--text-primary)" }}>
              {usd(monthlySpend)}
            </p>
          </div>
          {data?.runpod && !data.runpod.error && data.runpod.meta.spend_rate_label && (
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-tertiary)" }}>
                RunPod rate
              </p>
              <p className="text-[18px] font-bold tabular-nums mt-0.5" style={{ color: "var(--text-primary)" }}>
                {String(data.runpod.meta.spend_rate_label)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Provider cards */}
      {error ? (
        <div
          className="rounded-2xl p-6 flex items-center gap-3"
          style={{ backgroundColor: "var(--surface)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171" }}
        >
          <AlertIcon />
          <p className="text-[13px]">Failed to load billing data. Check your API tokens and try again.</p>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ProviderCard billing={data.runpod} />
          <ProviderCard billing={data.railway} />
          <ProviderCard billing={data.aws} />
        </div>
      ) : null}

      {/* Config hints — one per provider if needed */}
      {data && (() => {
        const hints: { label: string; steps: React.ReactNode[] }[] = [];

        if (data.railway.error?.includes("not configured")) {
          hints.push({
            label: "Railway API token missing",
            steps: [
              <>Go to <strong>railway.com → Account Settings → Tokens</strong> and create a new token.</>,
              <>Add <code className="px-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.07)" }}>RAILWAY_API_TOKEN=&lt;token&gt;</code> to the backend service variables on Railway.</>,
            ],
          });
        }

        if (data.runpod.error?.includes("not configured")) {
          hints.push({
            label: "RunPod API key missing",
            steps: [
              <>Go to <strong>runpod.io → Settings → API Keys</strong> and create a key.</>,
              <>Add <code className="px-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.07)" }}>RUNPOD_API_KEY=&lt;key&gt;</code> to the backend service variables on Railway.</>,
            ],
          });
        }

        if (data.aws.error?.includes("not authorized") || data.aws.error?.includes("AccessDenied")) {
          hints.push({
            label: "AWS Cost Explorer permission missing",
            steps: [
              <>In the <strong>AWS IAM console</strong>, find the <code className="px-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.07)" }}>titan-cc-backend</code> user.</>,
              <>Attach an inline policy granting <code className="px-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.07)" }}>ce:GetCostAndUsage</code> on <code className="px-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.07)" }}>*</code>.</>,
              <>Cost Explorer is global — the policy resource must be <code className="px-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.07)" }}>arn:aws:ce:*:*:*</code> or <code className="px-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.07)" }}>*</code>.</>,
            ],
          });
        }

        if (hints.length === 0) return null;

        return (
          <div className="space-y-3">
            {hints.map((hint) => (
              <div
                key={hint.label}
                className="rounded-2xl px-5 py-4"
                style={{ backgroundColor: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.2)" }}
              >
                <p className="text-[12px] font-semibold mb-2" style={{ color: "#fbbf24" }}>{hint.label}</p>
                <ol className="space-y-1 list-decimal list-inside">
                  {hint.steps.map((step, i) => (
                    <li key={i} className="text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
