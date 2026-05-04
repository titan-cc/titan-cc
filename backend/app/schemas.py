import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field

from app.models import FailureClass, JobStatus


# ── Upload ────────────────────────────────────────────────────────────────────

class PresignRequest(BaseModel):
    filename: str
    content_type: str
    size_bytes: int = Field(gt=0, le=5_000_000_000)
    duration_seconds: int = Field(gt=0)


class PresignResponse(BaseModel):
    upload_url: str
    form_fields: dict[str, str]  # S3 policy fields — must be sent before the file in FormData
    s3_key: str
    expires_at: datetime


# ── Job config ────────────────────────────────────────────────────────────────

class JobConfig(BaseModel):
    language: str = "auto"
    enable_diarization: bool = False
    output_formats: list[str] = ["json", "srt", "txt"]


# ── Job CRUD ──────────────────────────────────────────────────────────────────

# ── System / worker health ─────────────────────────────────────────────────────

class WorkerStatusResponse(BaseModel):
    warm: bool
    idle_workers: int
    running_workers: int


class WarmupResponse(BaseModel):
    already_warm: bool
    message: str


# ── Job CRUD ──────────────────────────────────────────────────────────────────

class JobCreateRequest(BaseModel):
    s3_key: str
    filename: str | None = None
    duration_seconds: int = Field(gt=0)
    config: JobConfig = Field(default_factory=JobConfig)
    folder_id: uuid.UUID | None = None


class JobResponse(BaseModel):
    id: uuid.UUID
    status: JobStatus
    progress_pct: int | None
    current_stage: str | None
    input_filename: str | None
    input_duration_seconds: int
    config: dict[str, Any]
    folder_id: uuid.UUID | None = None
    failure_class: FailureClass | None
    failure_code: str | None
    failure_message: str | None
    retry_count: int
    created_at: datetime
    dispatched_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    expires_at: datetime

    model_config = {"from_attributes": True}


class JobListResponse(BaseModel):
    jobs: list[JobResponse]
    next_cursor: uuid.UUID | None


# ── Transcript ─────────────────────────────────────────────────────────────────

class DownloadLink(BaseModel):
    url: str
    expires_at: datetime


class TranscriptResponse(BaseModel):
    downloads: dict[str, DownloadLink]
    video_url: str | None = None


class TranscriptSegmentUpdate(BaseModel):
    start: float
    end: float
    # 5 000 chars per segment is ~3× a typical 30-second spoken paragraph.
    text: Annotated[str, Field(max_length=5_000)]
    # 50 chars covers "Speaker 1" / "SPEAKER_00" style labels.
    speaker: Annotated[str | None, Field(max_length=50)] = None
    words: list[dict] | None = None


# 2-hour audio at ~3 words/sec ≈ 21 600 word-level segments; 30 000 is a safe ceiling.
_MAX_SEGMENTS = 30_000


class TranscriptUpdateRequest(BaseModel):
    segments: Annotated[list[TranscriptSegmentUpdate], Field(max_length=_MAX_SEGMENTS)]


# ── Notifications ──────────────────────────────────────────────────────────────

class NotificationResponse(BaseModel):
    id: int
    job_id: uuid.UUID | None
    type: str
    title: str
    body: str | None
    read_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationListResponse(BaseModel):
    notifications: list[NotificationResponse]


# ── Webhooks ───────────────────────────────────────────────────────────────────

class WebhookProgressPayload(BaseModel):
    current_stage: str
    progress_pct: int


class WebhookCompletedPayload(BaseModel):
    output_s3_keys: dict[str, str]
    cost_usd: float
    input_hash: str | None = None


class WebhookFailedPayload(BaseModel):
    failure_class: FailureClass
    failure_code: str
    failure_message: str
    failure_details: dict[str, Any] | None = None


class RunpodWebhookBody(BaseModel):
    job_id: uuid.UUID
    claim_token: uuid.UUID
    event: str
    timestamp: str
    payload: dict[str, Any]


# ── User / Me ──────────────────────────────────────────────────────────────────

class QuotaResponse(BaseModel):
    max_concurrent_jobs: int
    max_minutes_per_month: int
    max_duration_seconds: int
    minutes_used_this_month: int
    quota_reset_at: datetime

    model_config = {"from_attributes": True}


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    plan: str
    created_at: datetime

    model_config = {"from_attributes": True}


class UserMeResponse(BaseModel):
    id: uuid.UUID
    email: str
    plan: str
    role: str
    is_enabled: bool
    access_level: str
    created_at: datetime
    quota: QuotaResponse | None

    model_config = {"from_attributes": True}


# ── Admin ──────────────────────────────────────────────────────────────────────

class AdminUserResponse(BaseModel):
    id: uuid.UUID
    email: str
    plan: str
    role: str
    is_enabled: bool
    access_level: str
    created_at: datetime
    quota: QuotaResponse | None
    job_count: int


class AdminUserListResponse(BaseModel):
    users: list[AdminUserResponse]
    next_cursor: uuid.UUID | None


class AdminJobResponse(JobResponse):
    user_email: str


class AdminJobListResponse(BaseModel):
    jobs: list[AdminJobResponse]
    next_cursor: uuid.UUID | None


class UpdateUserRequest(BaseModel):
    role: str | None = None          # 'user' | 'admin'
    is_enabled: bool | None = None
    access_level: str | None = None  # 'basic' | 'standard' | 'pro' | 'enterprise'


# ── Billing ────────────────────────────────────────────────────────────────────

class BillingLineItem(BaseModel):
    label: str
    amount_usd: float


class ProviderBilling(BaseModel):
    provider: str
    period: str
    total_usd: float | None = None
    items: list[BillingLineItem] = []
    meta: dict[str, Any] = {}
    error: str | None = None


class BillingResponse(BaseModel):
    period: str
    runpod: ProviderBilling
    railway: ProviderBilling
    aws: ProviderBilling


# ── Folders ────────────────────────────────────────────────────────────────────

class FolderResponse(BaseModel):
    id: uuid.UUID
    name: str
    scope: str          # 'personal' | 'org'
    owned_by_me: bool
    created_at: datetime
    job_count: int = 0

    model_config = {"from_attributes": True}


class FolderListResponse(BaseModel):
    folders: list[FolderResponse]


class FolderCreateRequest(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=100)]
    scope: str = "personal"   # 'personal' | 'org'


class FolderUpdateRequest(BaseModel):
    name: Annotated[str | None, Field(min_length=1, max_length=100)] = None
    scope: str | None = None  # 'personal' | 'org'


# ── Search ─────────────────────────────────────────────────────────────────────

class SearchHit(BaseModel):
    job_id: uuid.UUID
    input_filename: str | None
    folder_id: uuid.UUID | None
    folder_name: str | None
    snippet: str
    created_at: datetime
    status: JobStatus


class SearchResponse(BaseModel):
    hits: list[SearchHit]
    query: str


# ── Activity log ───────────────────────────────────────────────────────────────

class ActivityLogEntry(BaseModel):
    id: int
    user_id: uuid.UUID | None
    user_email: str | None
    actor_id: uuid.UUID | None
    actor_email: str | None
    event_type: str
    metadata: dict[str, Any] | None
    created_at: datetime


class ActivityLogResponse(BaseModel):
    events: list[ActivityLogEntry]
    next_cursor: int | None


class ActivityStatsResponse(BaseModel):
    hours_transcribed: float
    jobs_completed: int
    jobs_submitted: int
    jobs_failed: int
