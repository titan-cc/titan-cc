// Generated from backend OpenAPI — run: npx openapi-typescript http://localhost:8000/openapi.json -o src/api/types.ts
// For now, hand-written to match backend schemas.py

export type JobStatus =
  | "queued"
  | "dispatched"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type FailureClass =
  | "user_content"
  | "user_quota"
  | "system_transient"
  | "system_permanent"
  | "timeout"
  | "cancelled";

export interface Job {
  id: string;
  status: JobStatus;
  progress_pct: number | null;
  current_stage: string | null;
  input_filename: string | null;
  input_duration_seconds: number;
  config: Record<string, unknown>;
  failure_class: FailureClass | null;
  failure_code: string | null;
  failure_message: string | null;
  retry_count: number;
  created_at: string;
  dispatched_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string;
}

export interface JobListResponse {
  jobs: Job[];
  next_cursor: string | null;
}

export interface PresignResponse {
  upload_url: string;
  s3_key: string;
  expires_at: string;
}

export interface DownloadLink {
  url: string;
  expires_at: string;
}

export interface TranscriptResponse {
  downloads: Record<string, DownloadLink>;
  video_url: string | null;
}

export interface Notification {
  id: number;
  job_id: string | null;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationListResponse {
  notifications: Notification[];
}

export type UserRole = "user" | "admin";
export type AccessLevel = "basic" | "standard" | "pro" | "enterprise";

export interface User {
  id: string;
  email: string;
  plan: string;
  created_at: string;
}

export interface QuotaResponse {
  max_concurrent_jobs: number;
  max_minutes_per_month: number;
  max_duration_seconds: number;
  minutes_used_this_month: number;
  quota_reset_at: string;
}

export interface UserMeResponse extends User {
  role: UserRole;
  is_enabled: boolean;
  access_level: AccessLevel;
  quota: QuotaResponse | null;
}

export interface AdminJob extends Job {
  user_email: string;
}

export interface AdminJobListResponse {
  jobs: AdminJob[];
  next_cursor: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  plan: string;
  role: UserRole;
  is_enabled: boolean;
  access_level: AccessLevel;
  created_at: string;
  quota: QuotaResponse | null;
  job_count: number;
}

export interface AdminUserListResponse {
  users: AdminUser[];
  next_cursor: string | null;
}

// ── Billing ───────────────────────────────────────────────────────────────────

export interface BillingLineItem {
  label: string;
  amount_usd: number;
}

export interface ProviderBilling {
  provider: string;
  period: string;
  total_usd: number | null;
  items: BillingLineItem[];
  meta: Record<string, string | number>;
  error: string | null;
}

export interface BillingResponse {
  period: string;
  runpod: ProviderBilling;
  railway: ProviderBilling;
  aws: ProviderBilling;
}
