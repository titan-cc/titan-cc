import type { JobStatus } from "@/api/types";

export const TERMINAL_STATUSES: JobStatus[] = ["completed", "failed", "cancelled", "expired"];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
