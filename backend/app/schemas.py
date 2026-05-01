import uuid
from datetime import datetime
from typing import Any

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
    s3_key: str
    expires_at: datetime


# ── Job config ────────────────────────────────────────────────────────────────

class JobConfig(BaseModel):
    language: str = "auto"
    enable_diarization: bool = False
    output_formats: list[str] = ["json", "srt", "txt"]


# ── Job CRUD ──────────────────────────────────────────────────────────────────

class JobCreateRequest(BaseModel):
    s3_key: str
    filename: str | None = None
    duration_seconds: int = Field(gt=0)
    config: JobConfig = Field(default_factory=JobConfig)


class JobResponse(BaseModel):
    id: uuid.UUID
    status: JobStatus
    progress_pct: int | None
    current_stage: str | None
    input_filename: str | None
    input_duration_seconds: int
    config: dict[str, Any]
    failure_class: FailureClass | None
    failure_code: str | None
    failure_message: str | None
    retry_count: int
    created_at: datetime
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


class UpdateUserRequest(BaseModel):
    role: str | None = None          # 'user' | 'admin'
    is_enabled: bool | None = None
    access_level: str | None = None  # 'basic' | 'standard' | 'pro' | 'enterprise'
