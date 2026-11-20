import { useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";

// Billing alerts for admins: RunPod credit about to run out, Railway/AWS bills
// due soon or unpaid. Shown as a banner at the top of every page, and in full on
// the Billing page.

export interface BillingAlert {
  id: string;
  provider: "runpod" | "railway" | "aws" | string;
  level: "red" | "amber" | string;
  title: string;
  message: string;
  action_label: string | null;
  action_url: string | null;
  banner: boolean;
  invoice_id: string | null;
}

const KEY = ["billing-alerts"];

export function useBillingAlerts(enabled: boolean) {
  const { getToken } = useAuth();
  return useQuery<BillingAlert[]>({
    queryKey: KEY,
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetch("/admin/billing/alerts", { token: token! });
      return res.json();
    },
    enabled,
    staleTime: 4 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

function useMarkPaid() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const token = await getToken();
      await apiFetch("/admin/billing/mark-paid", {
        token: token!,
        method: "POST",
        body: JSON.stringify({ provider: "aws", invoice_id: invoiceId }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

const STYLE = {
  red: { bg: "#FDE7E7", border: "#F3B3B0", text: "#7A1712", accent: "#B42318" },
  amber: { bg: "#FFFBEB", border: "#F5D49A", text: "#78350F", accent: "#B45309" },
};

const PROVIDER = { runpod: "RunPod", railway: "Railway", aws: "AWS" } as Record<string, string>;

function readDismissed(): string[] {
  try { return JSON.parse(sessionStorage.getItem("titan.dismissedAlerts") ?? "[]"); } catch { return []; }
}

export function AlertCards({ alerts, dismissible }: { alerts: BillingAlert[]; dismissible: boolean }) {
  const markPaid = useMarkPaid();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  const shown = alerts.filter((a) => !dismissible || !dismissed.includes(a.id));
  if (!shown.length) return null;

  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    try { sessionStorage.setItem("titan.dismissedAlerts", JSON.stringify(next)); } catch { /* private window */ }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {shown.map((a) => {
        const s = a.level === "red" ? STYLE.red : STYLE.amber;
        return (
          <div key={a.id} role={a.level === "red" ? "alert" : "status"}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3"
            style={{ backgroundColor: s.bg, border: `1px solid ${s.border}`, color: s.text }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={s.accent} strokeWidth={2} aria-hidden="true" className="shrink-0">
              <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="flex-1 min-w-[220px]">
              <p className="m-0 text-[14px] font-semibold">
                <span className="text-[11px] font-bold uppercase tracking-wide mr-2" style={{ color: s.accent }}>{PROVIDER[a.provider] ?? a.provider}</span>
                {a.title}
              </p>
              <p className="m-0 mt-0.5 text-[13px] leading-snug">{a.message}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {a.invoice_id && (
                <button
                  onClick={() => markPaid.mutate(a.invoice_id!)}
                  disabled={markPaid.isPending}
                  className="h-9 px-3.5 rounded-[10px] text-[13px] font-semibold disabled:opacity-50"
                  style={{ backgroundColor: "#fff", color: s.text, border: `1px solid ${s.border}` }}>
                  {markPaid.isPending ? "Saving…" : "Mark as paid"}
                </button>
              )}
              {a.action_url && (
                <a href={a.action_url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center h-9 px-3.5 rounded-[10px] text-[13px] font-semibold text-white"
                  style={{ backgroundColor: s.accent }}>
                  {a.action_label ?? "Open"}
                </a>
              )}
              {dismissible && (
                <button onClick={() => dismiss(a.id)} aria-label={`Hide "${a.title}" until you next open Titan`}
                  title="Hide until you next open Titan"
                  className="w-9 h-9 rounded-[10px] text-lg leading-none" style={{ color: s.text }}>
                  ×
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The banner at the top of every page, for admins. */
export default function BillingAlertBanner({ isAdmin }: { isAdmin: boolean }) {
  const { data } = useBillingAlerts(isAdmin);
  const banners = (data ?? []).filter((a) => a.banner);
  if (!isAdmin || !banners.length) return null;
  return <div className="mb-6"><AlertCards alerts={banners} dismissible /></div>;
}
