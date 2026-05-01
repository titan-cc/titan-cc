# Titan CC — Transcription Control Center

A web application for the Indian market that transcribes audio/video files using GPU-accelerated Whisper. Users upload a file, a RunPod serverless GPU worker processes it, and the user downloads the transcript in JSON, SRT, or TXT format.

**Live:** [tools.soexcellence.com](https://tools.soexcellence.com) (frontend) · [api.tools.soexcellence.com](https://api.tools.soexcellence.com) (backend)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Repository Layout](#2-repository-layout)
3. [Technology Stack](#3-technology-stack)
4. [Database Schema](#4-database-schema)
5. [Job State Machine](#5-job-state-machine)
6. [Failure Classification](#6-failure-classification)
7. [API Reference](#7-api-reference)
8. [Security Model](#8-security-model)
9. [Backend Deep Dive](#9-backend-deep-dive)
10. [RunPod Worker Deep Dive](#10-runpod-worker-deep-dive)
11. [Frontend Deep Dive](#11-frontend-deep-dive)
12. [Environment Variables](#12-environment-variables)
13. [Local Development](#13-local-development)
14. [Deployment](#14-deployment)
15. [CI/CD](#15-cicd)
16. [Operational Runbooks](#16-operational-runbooks)
17. [Known Gotchas](#17-known-gotchas)
18. [What Is NOT Built (v1 Deferred List)](#18-what-is-not-built-v1-deferred-list)

---

## 1. Architecture Overview

```
Browser
  │
  │  HTTPS (Clerk JWT in Authorization header)
  ▼
┌─────────────────────────────────────────────────────┐
│  Frontend (Vite + React + Tailwind)                 │
│  Railway service · tools.soexcellence.com           │
│  Served as static files by nginx                    │
└──────────────────────┬──────────────────────────────┘
                       │ REST API
                       ▼
┌─────────────────────────────────────────────────────┐
│  Backend (FastAPI + SQLAlchemy 2.0 async)           │
│  Railway service · api.tools.soexcellence.com       │
│                                                     │
│  Background tasks (asyncio, co-located):            │
│  • Dispatcher  — polls Postgres every 10 s,         │
│                  claims queued jobs, sends to RunPod │
│  • Watchdog    — polls every 60 s, times out jobs   │
│                  stuck >20 min in dispatched/        │
│                  processing                         │
└───────┬──────────────────────────┬──────────────────┘
        │                          │
        │ asyncpg                  │ HMAC-signed webhook
        ▼                          ▼
┌───────────────┐    ┌────────────────────────────────┐
│  Postgres     │    │  RunPod Serverless Endpoint     │
│  Railway      │    │  ID: s1qzo6w76dn34l             │
│  (managed)    │    │  GPU: AMPERE_16 (A4000 16 GB)   │
└───────────────┘    │  Image: ghcr.io/titan-cc/       │
                     │         runpod-worker:latest    │
                     └────────────┬───────────────────┘
                                  │
                         S3 read input,
                         S3 write outputs
                                  │
                                  ▼
                     ┌────────────────────────────────┐
                     │  AWS S3 (ap-south-1)            │
                     │  titan-transcribe-prod          │
                     │  inputs/{user_id}/{uuid}/file   │
                     │  outputs/{job_id}/file.{ext}    │
                     │  dead-letters/{job_id}.json     │
                     │  (15-day lifecycle delete)      │
                     └────────────────────────────────┘
```

### Data flow for a successful transcription

1. **Presign** — Browser calls `POST /uploads/presign`. Backend generates an S3 presigned PUT URL valid for 5 minutes, scoped to `inputs/{user_id}/{uuid}/{filename}`.
2. **Upload** — Browser PUTs the file directly to S3 (not via the backend, avoiding bandwidth costs).
3. **Create job** — Browser calls `POST /jobs` with `Idempotency-Key` header. Backend creates a `jobs` row with `status='queued'`.
4. **Dispatch** — The background dispatcher wakes every 10 s, claims one queued job using `FOR UPDATE SKIP LOCKED`, sets it to `dispatched`, and POSTs to RunPod with `{job_id, claim_token, s3_key, config, webhook_url, webhook_secret}`.
5. **GPU pipeline** — The RunPod worker downloads the file from S3, runs ffmpeg → Silero VAD → faster-whisper → optional WhisperX diarization → formats JSON/SRT/TXT → uploads all outputs to S3.
6. **Webhook** — Worker POSTs HMAC-signed webhooks (`started`, `progress`, `completed` or `failed`) back to `POST /webhooks/runpod`. Backend validates signature + claim_token, updates job status, increments quota, inserts notification, sends email.
7. **Download** — User calls `GET /jobs/{id}/transcript`. Backend generates short-lived presigned GET URLs (5 min) for each format plus a 2-hour presigned URL for the original video (for in-browser playback).

---

## 2. Repository Layout

```
titan-cc/
├── README.md                        ← This file
├── CLAUDE.md                        ← Implementation handover + status log
├── PRODUCT.md                       ← Product brief
├── docker-compose.yml               ← Local Postgres (postgres:16-alpine)
├── .env.example                     ← All required env vars with placeholder values
├── .gitignore
│
├── .github/
│   └── workflows/
│       ├── build-runpod-worker.yml  ← Builds + pushes ghcr.io image on push to runpod-handler/**
│       └── check-ghcr-credential.yml ← Weekly check that the GHCR PAT is valid
│
├── backend/
│   ├── Dockerfile                   ← python:3.12-slim + uv; runs alembic then uvicorn
│   ├── pyproject.toml               ← Dependencies + ruff/mypy config
│   ├── alembic.ini
│   ├── alembic/
│   │   └── versions/
│   │       ├── 18e39188719b_initial_schema.py      ← All core tables
│   │       ├── 801f6206ffe7_add_input_filename.py
│   │       ├── 926668407981_make_idempotency_job_id_nullable.py
│   │       ├── c4f8a2b1d9e0_add_admin_fields_to_users.py  ← role, is_enabled, access_level
│   │       └── f3a1b2c4d5e6_add_runpod_job_id_to_jobs.py
│   └── app/
│       ├── main.py                  ← FastAPI app, CORS, lifespan (starts dispatcher + watchdog)
│       ├── config.py                ← pydantic-settings; reads .env
│       ├── db.py                    ← Async SQLAlchemy engine + session factory
│       ├── models.py                ← ORM models (User, Quota, Job, IdempotencyKey, Notification, JobEvent)
│       ├── schemas.py               ← Pydantic request/response models for all endpoints
│       ├── auth.py                  ← Clerk JWT verification via PyJWKClient (24h JWKS cache)
│       ├── deps.py                  ← get_current_user, require_admin, _create_user
│       ├── routers/
│       │   ├── system.py            ← GET /system/worker-status, POST /system/warmup
│       │   ├── uploads.py           ← POST /uploads/presign
│       │   ├── jobs.py              ← Full job CRUD + transcript download
│       │   ├── notifications.py     ← GET /notifications, mark-read
│       │   ├── webhooks.py          ← POST /webhooks/runpod (HMAC auth, claim_token check)
│       │   └── admin.py             ← /admin/users, /admin/jobs, /admin/billing
│       ├── services/
│       │   ├── s3.py                ← boto3 presigned URL generation
│       │   ├── runpod.py            ← dispatch_job, cancel_runpod_job, get_endpoint_health
│       │   ├── email.py             ← Resend integration (completion + failure emails)
│       │   ├── quotas.py            ← check_quota() — raises HTTPException on violation
│       │   ├── dispatcher.py        ← Background asyncio task; one job per 10 s tick
│       │   └── watchdog.py          ← Background asyncio task; times out stuck jobs at 20 min
│       └── tests/
│           ├── conftest.py
│           ├── test_auth.py
│           ├── test_health.py
│           ├── test_jobs.py
│           └── test_webhooks.py
│
├── frontend/
│   ├── Dockerfile                   ← node:20-alpine build → nginx:alpine serve
│   ├── nginx.conf                   ← SPA fallback, 1-year cache for hashed assets, gzip
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json                ← strict mode
│   └── src/
│       ├── main.tsx                 ← ClerkProvider + QueryClientProvider + App
│       ├── App.tsx                  ← Routes (all behind SignedIn gate)
│       ├── api/
│       │   ├── client.ts            ← apiFetch() wrapper (adds Authorization header)
│       │   ├── hooks.ts             ← TanStack Query hooks for all endpoints
│       │   └── types.ts             ← Hand-written TypeScript types matching backend schemas
│       ├── components/
│       │   ├── Layout.tsx           ← Nav with notification bell, admin link
│       │   ├── AdminLayout.tsx      ← Admin sidebar layout (Outlet)
│       │   ├── StatusBadge.tsx      ← Coloured pill for job status
│       │   └── ProgressBar.tsx
│       ├── pages/
│       │   ├── Upload.tsx           ← File picker → presign → PUT to S3 → POST /jobs
│       │   ├── Jobs.tsx             ← My Jobs + All Jobs (admin) tabs; polls every 5 s
│       │   ├── JobDetail.tsx        ← Full job card; Retry + Cancel buttons
│       │   ├── TranscriptViewer.tsx ← Player / Text / Speakers tabs
│       │   ├── Failures.tsx         ← Failed jobs grouped by failure_class
│       │   ├── AdminUsers.tsx       ← User management table
│       │   └── AdminBilling.tsx     ← RunPod / Railway / AWS cost summary
│       └── lib/
│           ├── auth.tsx             ← re-exports Clerk hooks
│           └── poll.ts              ← polling helpers
│
├── runpod-handler/
│   ├── Dockerfile                   ← runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04 base
│   │                                   + ffmpeg + requirements + Whisper medium + Silero VAD baked in
│   ├── requirements.txt             ← faster-whisper, silero-vad, boto3, runpod, httpx, tenacity, ...
│   ├── handler.py                   ← RunPod entry point; phase-separated pipeline + webhook delivery
│   ├── failure_codes.py             ← FailureCode, FailureClass, PipelineError (source of truth)
│   └── pipeline/
│       ├── audio.py                 ← S3 download + ffmpeg conversion to 16 kHz mono WAV
│       ├── vad.py                   ← Silero VAD; raises AUDIO_TOO_QUIET if <2 s speech
│       ├── transcribe.py            ← faster-whisper medium, CUDA float16; thread-safe init + warmup
│       ├── align.py                 ← WhisperX speaker diarization (optional, on enable_diarization)
│       └── format.py                ← JSON / SRT / TXT output writers
│
└── scripts/
    ├── fake_runpod.py               ← Local HTTP server that simulates a RunPod worker
    └── smoke-test.sh                ← End-to-end smoke test script
```

---

## 3. Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 19 + Vite 6 + TypeScript strict | Hosted on Railway (nginx) |
| Styling | Tailwind CSS 3 | No custom CSS |
| Auth (frontend) | `@clerk/clerk-react` v5 | `SignedIn`/`SignedOut` gates |
| Data fetching | TanStack Query v5 | All async state; no raw `useEffect+fetch` |
| Routing | React Router v7 | |
| Backend | FastAPI + Python 3.12 | Async-first throughout |
| ORM | SQLAlchemy 2.0 (async) | `select()` style, never legacy `query()` |
| Migrations | Alembic | Auto-runs `upgrade head` on container start |
| Auth (backend) | PyJWT + Clerk JWKS | RS256, 24h key cache |
| Config | pydantic-settings | Reads `.env` |
| Logging | structlog | Structured JSON; no PII in logs |
| HTTP client | httpx (async) | Used for RunPod, Resend, Clerk APIs |
| Retries | tenacity | External service calls in the worker |
| Database | PostgreSQL 16 | Railway managed |
| Object storage | AWS S3 `ap-south-1` | `titan-transcribe-prod` bucket |
| GPU compute | RunPod serverless | AMPERE_16 (A4000, 16 GB VRAM) |
| ASR model | faster-whisper medium | CUDA float16, English hardcoded |
| VAD | Silero VAD (torch.hub) | Baked into Docker image; `source="local"` at runtime |
| Container registry | GHCR (`ghcr.io/titan-cc/runpod-worker`) | Public package; no pull credentials needed |
| Email | Resend | DKIM/SPF setup deferred to v2 |
| Error tracking | Sentry | Both frontend and backend DSNs configured |
| Package manager | uv (backend) · npm (frontend) | |

---

## 4. Database Schema

All tables live in Postgres on Railway. Alembic manages migrations. The backend runs `alembic upgrade head` automatically on container start.

### `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | auto-generated |
| `clerk_user_id` | TEXT UNIQUE | Clerk's `sub` claim |
| `email` | TEXT | fetched from Clerk API if not in JWT |
| `plan` | TEXT DEFAULT 'free' | reserved for future billing |
| `role` | TEXT DEFAULT 'user' | `'user'` \| `'admin'` |
| `is_enabled` | BOOLEAN DEFAULT true | disabled users get HTTP 403 |
| `access_level` | TEXT DEFAULT 'basic' | drives quota presets |
| `created_at` | TIMESTAMPTZ | |

**User creation:** Happens on first authenticated request in `deps._create_user()`. If the email matches `ADMIN_EMAILS` env var, `role='admin'` is set immediately. A corresponding `quotas` row is created atomically. Race conditions handled via `IntegrityError` + retry select.

### `quotas`

| Column | Type | Default |
|--------|------|---------|
| `user_id` | UUID PK FK → users | |
| `max_concurrent_jobs` | INT | 2 |
| `max_minutes_per_month` | INT | 300 |
| `max_duration_seconds` | INT | 7200 (2 hr) |
| `minutes_used_this_month` | INT | 0 |
| `quota_reset_at` | TIMESTAMPTZ | first day of next month |

Access level presets (applied via `PATCH /admin/users/{id}`):
| Level | Concurrent | Min/month | Max file |
|-------|-----------|-----------|---------|
| basic | 2 | 300 | 2 hr |
| standard | 3 | 600 | 2 hr |
| pro | 5 | 1200 | 4 hr |
| enterprise | 10 | 5000 | 8 hr |

### `jobs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_id` | UUID FK → users | all queries scoped by this |
| `status` | ENUM job_status | see state machine below |
| `claim_token` | UUID nullable | set by dispatcher; must match in webhooks |
| `runpod_job_id` | TEXT nullable | RunPod's own job ID (for cancellation) |
| `input_s3_key` | TEXT | `inputs/{user_id}/{uuid}/{filename}` |
| `input_filename` | TEXT nullable | original filename as provided by browser |
| `input_hash` | TEXT nullable | SHA-256 of the converted WAV (set by worker) |
| `input_duration_seconds` | INT | provided by browser at job creation |
| `config` | JSONB | `{language, enable_diarization, output_formats}` |
| `output_s3_keys` | JSONB nullable | `{json: "outputs/…", srt: "outputs/…", txt: "outputs/…"}` |
| `current_stage` | TEXT nullable | e.g. `"transcribing"` |
| `progress_pct` | SMALLINT nullable | 0–100 |
| `failure_class` | ENUM failure_class nullable | |
| `failure_code` | TEXT nullable | |
| `failure_message` | TEXT nullable | user-facing message |
| `failure_details` | JSONB nullable | debug info (not shown to users) |
| `retry_count` | INT DEFAULT 0 | |
| `max_retries` | INT DEFAULT 3 | |
| `cost_usd` | NUMERIC(10,4) nullable | reported by worker |
| `expires_at` | TIMESTAMPTZ | DEFAULT `NOW() + 15 days` |
| `created_at` | TIMESTAMPTZ | |
| `dispatched_at` | TIMESTAMPTZ nullable | |
| `started_at` | TIMESTAMPTZ nullable | |
| `completed_at` | TIMESTAMPTZ nullable | |
| `updated_at` | TIMESTAMPTZ | auto-updated |

**Indexes:**
- `idx_jobs_user_created` on `(user_id, created_at)` — list queries
- `idx_jobs_queued` on `(created_at) WHERE status = 'queued'` — dispatcher
- `idx_jobs_expires` on `(expires_at) WHERE status != 'expired'` — future expiry sweeper

### `idempotency_keys`

| Column | Type | Notes |
|--------|------|-------|
| `key` | UUID PK | client-generated UUID in `Idempotency-Key` header |
| `user_id` | UUID FK | |
| `job_id` | UUID FK nullable | NULL until job is created (handles concurrent inserts) |
| `request_hash` | TEXT | SHA-256 of canonicalized request body |
| `created_at` | TIMESTAMPTZ | |

### `notifications`

| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGSERIAL PK | |
| `user_id` | UUID FK | |
| `job_id` | UUID FK nullable | |
| `type` | TEXT | `'job_completed'` \| `'job_failed'` |
| `title` | TEXT | |
| `body` | TEXT nullable | |
| `read_at` | TIMESTAMPTZ nullable | |
| `emailed_at` | TIMESTAMPTZ nullable | reserved; not yet set |
| `created_at` | TIMESTAMPTZ | |

### `job_events`

Append-only audit log. Every status transition creates a row.

| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGSERIAL PK | |
| `job_id` | UUID FK (CASCADE DELETE) | |
| `event_type` | TEXT | `created`, `dispatched`, `started`, `progress`, `completed`, `failed`, `auto_retry`, `manual_retry`, `cancelled`, `timeout`, `admin_reset` |
| `from_status` | ENUM nullable | |
| `to_status` | ENUM nullable | |
| `metadata` | JSONB nullable | event-specific data |
| `created_at` | TIMESTAMPTZ | |

---

## 5. Job State Machine

```
                ┌──────────┐
     POST /jobs │  queued  │◄──────────────────────────────────┐
                └────┬─────┘                                   │
                     │ dispatcher claims (FOR UPDATE SKIP LOCKED)│
                     ▼                                         │
              ┌────────────┐                                   │
              │ dispatched │──── watchdog timeout ─────────────┤
              └─────┬──────┘     (retry_count < 1)             │
                    │ "started" webhook                        │
                    ▼                                         │
             ┌────────────┐                                   │
             │ processing │──── watchdog timeout ─────────────┤
             └──────┬─────┘     (retry_count < 1)             │
                    │                                         │
          ┌─────────┴──────────┐                              │
          │ "completed"        │ "failed" webhook              │
          │ webhook            │ (system_transient/timeout)    │
          ▼                    │ should_auto_retry() = true   │
      ┌──────────┐             └──────────────────────────────┘
      │completed │
      └──────────┘
                    "failed" webhook
                    (user_content/system_permanent)
                    should_auto_retry() = false
                              ▼
                         ┌────────┐
                         │ failed │◄── POST /jobs/:id/retry (resets to queued)
                         └────────┘

      POST /jobs/:id/cancel (from queued, dispatched, or processing)
                              ▼
                        ┌──────────┐
                        │cancelled │
                        └──────────┘

      S3 lifecycle delete (15 days) → status = expired (future sweeper)
```

**Claim token safety:** When the dispatcher claims a job it sets a random `claim_token` UUID. All incoming webhooks must include the same token. If the watchdog re-queues a timed-out job (clearing `claim_token = NULL`) and the original worker eventually sends its webhook, the token check fails and the webhook is silently ignored.

---

## 6. Failure Classification

Defined in both `runpod-handler/failure_codes.py` (source of truth) and mirrored in `backend/app/models.py`. **These strings must match exactly.**

| `failure_code` | `failure_class` | Auto-retry? | User message |
|----------------|----------------|------------|--------------|
| `FILE_UNREADABLE` | `user_content` | No | "Your file appears corrupt. Try re-exporting." |
| `FILE_NO_AUDIO_TRACK` | `user_content` | No | "No audio track found." |
| `AUDIO_TOO_QUIET` | `user_content` | No | "No speech detected." |
| `FILE_TOO_LONG` | `user_content` | No | "File exceeds maximum duration." |
| `GPU_OOM` | `system_transient` | Yes (up to `max_retries=3`) | "Temporary system issue. Retrying..." |
| `S3_DOWNLOAD_FAILED` | `system_transient` | Yes | "Network issue. Retrying..." |
| `WORKER_CRASHED` | `system_permanent` | No | "Something went wrong on our end." |
| `JOB_TIMEOUT` | `timeout` | Yes (1× only) | "Taking longer than expected. Retrying..." |
| `USER_CANCELLED` | `cancelled` | No | "Cancelled." |
| `QUOTA_EXCEEDED` | `user_quota` | No | "Monthly limit reached." |

**Auto-retry logic** (`app/routers/webhooks.py:should_auto_retry`):
- `system_transient`: retry if `retry_count < max_retries` (default 3)
- `timeout`: retry if `retry_count < 1` (one retry only)
- All other classes: no retry → mark `status='failed'` + send failure email

---

## 7. API Reference

All endpoints except `GET /healthz` and `POST /webhooks/runpod` require `Authorization: Bearer <clerk_jwt>`.

Every job query is scoped by `user_id` — this is the IDOR defense. **Non-negotiable.**

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/healthz` | None | Returns `{"status":"ok"}` |
| GET | `/users/me` | User | Current user + quota |
| GET | `/system/worker-status` | User | RunPod endpoint health |
| POST | `/system/warmup` | User | Submit warmup ping to RunPod |

### Uploads

#### `POST /uploads/presign`

Request:
```json
{
  "filename": "interview.mp4",
  "content_type": "video/mp4",
  "size_bytes": 524288000,
  "duration_seconds": 900
}
```

- Validates content-type against allowlist (audio: mp3/wav/ogg/flac/m4a/aac/mp4/webm; video: mp4/mov/avi/webm/mkv)
- Checks quota (`minutes_used + ceil(duration/60) <= max_minutes_per_month`)
- Generates `s3_key = inputs/{user_id}/{uuid4()}/{sanitized_filename}`
- Returns 5-minute presigned PUT URL with content-type locked

Response:
```json
{
  "upload_url": "https://s3.amazonaws.com/...",
  "s3_key": "inputs/abc/xyz/interview.mp4",
  "expires_at": "2026-04-30T12:05:00Z"
}
```

### Jobs

#### `POST /jobs` — requires `Idempotency-Key: <uuid>` header

Request:
```json
{
  "s3_key": "inputs/abc/xyz/interview.mp4",
  "filename": "interview.mp4",
  "duration_seconds": 900,
  "config": {
    "language": "auto",
    "enable_diarization": false,
    "output_formats": ["json", "srt", "txt"]
  }
}
```

Idempotency behavior:
- First call: creates job → HTTP 201
- Replay (same key + same body hash): returns existing job → HTTP 200
- Key reuse with different body: HTTP 422 "key reused with different payload"
- Concurrent duplicate: HTTP 409 "concurrent request in progress"

IDOR guard: rejects `s3_key` that doesn't start with `inputs/{user_id}/`.

#### `GET /jobs?cursor=<uuid>&limit=20&status=<filter>`

Cursor-paginated, ordered by `created_at DESC`. Returns `{jobs: [...], next_cursor: uuid|null}`.

#### `GET /jobs/{id}`

Returns full job detail. 404 if job belongs to different user (doesn't leak existence).

#### `GET /jobs/{id}/transcript`

Only valid when `status='completed'`. Returns:
- Presigned GET URLs (5 min) for each output format (`json`, `srt`, `txt`)
- `video_url`: 2-hour presigned GET URL for the original input file (for in-browser video player)

#### `POST /jobs/{id}/retry`

Only valid when `status='failed'`. Resets to `queued`, clears all failure/claim fields, inserts `manual_retry` event. Retry count resets to 0.

#### `POST /jobs/{id}/cancel`

Valid for `queued`, `dispatched`, `processing`. Sets to `cancelled`, clears `claim_token` (so any in-flight webhook is rejected). If `runpod_job_id` is set, best-effort cancels on RunPod after DB commit.

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notifications?unread=true&limit=20` | List notifications |
| POST | `/notifications/{id}/read` | Mark one as read |
| POST | `/notifications/read-all` | Mark all as read |

### Webhooks

#### `POST /webhooks/runpod`

**No user auth.** Authenticated by HMAC-SHA256.

Headers required:
- `X-Runpod-Signature: sha256=<hex>`
- `X-Runpod-Timestamp: <unix_float>`
- `X-Runpod-Nonce: <uuid>`

HMAC is computed over: `"{timestamp}.{nonce}.{raw_body_bytes}"` using `RUNPOD_WEBHOOK_SECRET`.

Replay protection:
- Rejects if `|now - timestamp| > 300 s`
- Rejects if nonce was seen within last 600 s (in-memory dict, cleared on restart)

Body:
```json
{
  "job_id": "uuid",
  "claim_token": "uuid",
  "event": "started|progress|completed|failed",
  "timestamp": "...",
  "payload": { "..." }
}
```

The endpoint always returns `{"ok": true}` (even for unknown jobs or stale tokens) — this prevents RunPod from retrying indefinitely.

### Admin (role='admin' required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/users?cursor&limit&search` | List all users with quota + job count |
| PATCH | `/admin/users/{id}` | Update role, is_enabled, access_level |
| POST | `/admin/users/{id}/quota/refresh` | Reset `minutes_used_this_month` to 0 |
| GET | `/admin/jobs?cursor&limit&status` | All jobs across all users with user_email |
| GET | `/admin/billing?refresh` | RunPod + Railway + AWS cost summary (5-min TTL cache) |
| POST | `/admin/jobs/reset-dispatched?older_than_minutes=5&x_admin_key=...` | Emergency: re-queue stuck dispatched jobs |

Self-protection: admins cannot demote or disable their own account.

---

## 8. Security Model

### Authentication

- Clerk issues JWTs signed with RS256.
- Backend fetches JWKS from `CLERK_JWKS_URL` (cached 24h via `PyJWKClient`).
- JWT verification checks signature + `sub` claim. Audience verification is disabled (`verify_aud: False`) because Clerk's default JWT has no `aud` claim unless you configure a custom template.
- **Email is NOT in the JWT by default.** On first sign-in, email is fetched from `GET https://api.clerk.com/v1/users/{clerk_user_id}` using `CLERK_SECRET_KEY`. Subsequent sign-ins use the email already in the DB.

### IDOR Prevention

- Every `SELECT ... WHERE jobs.id = $1` also adds `AND jobs.user_id = $2`.
- `POST /jobs` validates that `s3_key` starts with `inputs/{user_id}/`.
- Admin endpoints use a separate `require_admin` dependency.

### S3 Presigned URLs

- PUT: 5-minute expiry, content-type locked, path scoped to `inputs/{user_id}/`.
- GET (transcripts): 5-minute expiry.
- GET (video playback): 2-hour expiry so a long video doesn't expire mid-playback.

### Webhook Security

- HMAC-SHA256 over `{timestamp}.{nonce}.{body}`.
- Timestamp must be within 5 minutes.
- Nonce deduplication prevents replays (10-minute in-memory window).
- `claim_token` check prevents stale worker webhooks from updating re-queued jobs.

### CORS

Allowed origins: `http://localhost:5173` (dev) and `https://tools.soexcellence.com` (prod). Configured in `app/config.py:Settings.cors_origins`.

### No PII in Logs

`structlog` is used throughout. Transcript text and filenames containing user names must not be logged.

---

## 9. Backend Deep Dive

### Key Files

**`app/main.py`** — FastAPI app entry point. The `lifespan` context manager starts two background `asyncio.Task`s when `RUNPOD_ENDPOINT_URL` is set: `run_dispatcher()` and `run_watchdog()`. Both are cancelled cleanly on shutdown.

**`app/deps.py`** — `get_current_user` is the primary authentication dependency. It:
1. Extracts Bearer token
2. Verifies JWT → gets `clerk_user_id`
3. Looks up or creates the `User` row
4. Checks `is_enabled` (403 if disabled)
5. Returns the `User` ORM object

**`app/services/dispatcher.py`** — Runs every 10 seconds. Uses a raw SQL `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)` to atomically claim exactly one queued job. This is safe for multiple backend instances. On claim, it calls `dispatch_job()` which POSTs to RunPod. If RunPod returns a `runpod_job_id`, it's stored for later cancellation.

**`app/services/watchdog.py`** — Runs every 60 seconds. Finds `dispatched` or `processing` jobs where `dispatched_at < NOW() - 20 minutes`. Applies `JOB_TIMEOUT` failure + either re-queues (first timeout) or marks permanently failed. Best-effort cancels on RunPod.

**`app/routers/webhooks.py`** — `_verify_hmac()` is called before any DB access. The `_seen_nonces` dict is module-level (in-memory). On process restart it's cleared — acceptable for the 5-minute timestamp window (replays from before the restart would be older than 5 min).

### Database Session Pattern

```python
# Route handler (request-scoped)
async def my_endpoint(db: AsyncSession = Depends(get_db)):
    ...

# Background task (long-lived)
async with async_session_factory() as db:
    ...
```

`get_db` yields a session from `async_session_factory`. Each request gets its own session; background tasks create sessions explicitly.

### Idempotency Key Flow

```
INSERT INTO idempotency_keys (key, user_id, request_hash)
ON CONFLICT (key) DO NOTHING
RETURNING key
```

If `RETURNING` is NULL → key existed → load row → check hash → return existing job or 422.
If `RETURNING` is non-NULL → key is new → proceed to create job → `UPDATE idempotency_keys SET job_id = $new_id`.

The `job_id` column is nullable to handle the window between the INSERT and the job creation.

---

## 10. RunPod Worker Deep Dive

### Container

Base image: `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`

This is RunPod's official image, pre-cached on their worker nodes. Only the delta layers need to be pulled on cold start (~90 seconds total instead of 10+ minutes with a bare CUDA image).

Models baked into the image at build time:
- **Whisper medium** (~800 MB) — downloaded via `faster_whisper.WhisperModel('medium', device='cpu', compute_type='int8')` during Docker build. At runtime, loaded with `device='cuda', compute_type='float16'`.
- **Silero VAD** — downloaded via `torch.hub.load('snakers4/silero-vad', ...)` during Docker build. At runtime, loaded with `source="local"` pointing to the baked torch hub cache path to avoid any GitHub network calls.

### Startup Sequence

On container start, before `runpod.serverless.start()`:
1. `_log_startup_env()` — logs CUDA availability, GPU name, VRAM, CUDA version
2. `_preload_vad()` — loads Silero VAD from local cache
3. `_load_whisper()` — loads Whisper medium with thread-safe double-checked locking
4. `_warmup_whisper()` — runs a 1-second silent WAV through the model to pre-warm CUDA kernels

If step 2 or 3 fails → `sys.exit(1)` → RunPod does not route jobs to this pod.
If step 4 (warmup) fails → warning logged, worker continues (warmup is performance-only).

### Handler Phases

The `handler()` function is split into two explicit phases to prevent webhook delivery failures from corrupting the pipeline state:

**Phase 1 — Pipeline:** Download → VAD → Transcribe → Format → Upload. Records `pipeline_ok` + `completed_payload` or `failed_payload`. No webhook calls happen here.

**Phase 2 — Webhook delivery:** Calls `_send_completed()` or `_send_failed()`. Each has its own `try/except`. If all 3 tenacity retries are exhausted, `_write_dead_letter()` writes the full payload to `s3://titan-transcribe-prod/dead-letters/{job_id}.json`.

### Pipeline Stages

| Stage | File | Input | Output | Failure codes |
|-------|------|-------|--------|--------------|
| Download + convert | `pipeline/audio.py` | S3 key | 16 kHz mono WAV at `tmp_dir/audio.wav` | `S3_DOWNLOAD_FAILED`, `FILE_UNREADABLE`, `FILE_NO_AUDIO_TRACK` |
| VAD | `pipeline/vad.py` | WAV path | `[{start, end}, ...]` | `AUDIO_TOO_QUIET` (<2s speech), `GPU_OOM` |
| Transcribe | `pipeline/transcribe.py` | WAV path | `[{start, end, text, words}, ...]` | `GPU_OOM`, `WORKER_CRASHED` |
| Diarize | `pipeline/align.py` | segments + WAV | segments with `speaker` field | silent on failure (logged warning) |
| Format | `pipeline/format.py` | segments | JSON/SRT/TXT files in `tmp_dir/` | |

All temp files (raw download + converted WAV + outputs) live in a `tempfile.mkdtemp()` directory passed as `tmp_dir`. The `finally` block runs `shutil.rmtree(tmpdir)` regardless of outcome.

### Whisper Configuration

```python
model.transcribe(
    wav_path,
    language="en",           # hardcoded English — do NOT change to "auto"
    word_timestamps=True,
    vad_filter=False,         # VAD already done by Silero upstream
    beam_size=5,
    best_of=5,
    temperature=0,            # greedy, no random sampling
    condition_on_previous_text=True,
    no_speech_threshold=0.6,
    log_prob_threshold=-1.0,
)
```

**Why English hardcoded:** The frontend exposes `language: "auto"` in the config but the worker ignores it and always uses `"en"`. This was a deliberate decision — Whisper medium's multilingual accuracy is significantly worse than its English accuracy, and the target market (India) primarily transcribes English-language content. Changing to `auto` would require upgrading to Whisper large-v2/large-v3 which exceeds AMPERE_16's 16 GB VRAM.

### Dead-letter Recovery

If all 3 webhook retries fail, the payload is written to `s3://titan-transcribe-prod/dead-letters/{job_id}.json`. To recover:

```bash
# List dead letters
aws s3 ls s3://titan-transcribe-prod/dead-letters/ --profile titan-backend

# Download and inspect
aws s3 cp s3://titan-transcribe-prod/dead-letters/{job_id}.json - | jq .

# Replay the webhook manually
curl -X POST https://api.tools.soexcellence.com/webhooks/runpod \
  -H "Content-Type: application/json" \
  -H "X-Runpod-Signature: sha256=<compute-hmac>" \
  -H "X-Runpod-Timestamp: $(date +%s)" \
  -H "X-Runpod-Nonce: $(uuidgen)" \
  -d '<payload from dead-letter file>'
```

See `runpod-handler/handler.py:_sign_headers` for the HMAC computation.

---

## 11. Frontend Deep Dive

### Auth Flow

`src/main.tsx` wraps the app in `<ClerkProvider publishableKey={...}>` and `<QueryClientProvider>`. `src/App.tsx` uses `<SignedOut><RedirectToSignIn /></SignedOut>` — any unauthenticated route redirects to Clerk's hosted login.

`src/api/client.ts:apiFetch()` gets the Clerk JWT via `useAuth().getToken()` and adds it as `Authorization: Bearer <token>`.

### Pages

| Route | Component | Key behavior |
|-------|-----------|-------------|
| `/upload` | `Upload.tsx` | File picker → call presign → XHR PUT to S3 → POST /jobs with idempotency key |
| `/jobs` | `Jobs.tsx` | Two tabs (My Jobs / All Jobs for admins); polls every 5 s via TanStack Query `refetchInterval` |
| `/jobs/:id` | `JobDetail.tsx` | Full job card; Retry button (failed jobs); Cancel button (queued/dispatched/processing) |
| `/jobs/:id/transcript` | `TranscriptViewer.tsx` | Player / Text / Speakers tabs |
| `/failures` | `Failures.tsx` | Failed jobs grouped by `failure_class` |
| `/admin/users` | `AdminUsers.tsx` | User table with inline role/access_level dropdowns |
| `/admin/billing` | `AdminBilling.tsx` | RunPod / Railway / AWS cost cards |

### Transcript Viewer Tabs

- **Player** (default): HTML5 `<video>` on left, scrollable segment list on right. Clicking a segment seeks the video. Active segment highlighted and auto-scrolled via `timeupdate` event.
- **Text**: Full transcript text with live search. Matches highlighted in yellow with count.
- **Speakers**: Only shown when segments have a `speaker` field. Consecutive same-speaker segments merged into conversation blocks with 5-colour palette.

### Polling

Jobs list and job detail poll every 5 seconds while any job is in `queued`, `dispatched`, or `processing` state. Polling stops when all visible jobs are terminal.

---

## 12. Environment Variables

### Backend (`.env` / Railway service vars)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | `postgresql+asyncpg://user:pass@host:5432/db` |
| `CLERK_SECRET_KEY` | Yes | `sk_test_...` or `sk_live_...` |
| `CLERK_PUBLISHABLE_KEY` | Yes | `pk_test_...` or `pk_live_...` |
| `CLERK_JWKS_URL` | Yes | `https://your-app.clerk.accounts.dev/.well-known/jwks.json` |
| `AWS_ACCESS_KEY_ID` | Yes | IAM user `titan-cc-backend` credentials |
| `AWS_SECRET_ACCESS_KEY` | Yes | |
| `AWS_REGION` | Yes | `ap-south-1` |
| `S3_BUCKET` | Yes | `titan-transcribe-prod` |
| `RUNPOD_API_KEY` | Yes | For dispatch + health checks |
| `RUNPOD_ENDPOINT_ID` | Yes | `s1qzo6w76dn34l` |
| `RUNPOD_ENDPOINT_URL` | Yes | `https://api.runpod.ai/v2/s1qzo6w76dn34l/run` |
| `RUNPOD_WEBHOOK_SECRET` | Yes | Shared HMAC secret (also used in RunPod template env vars) |
| `RESEND_API_KEY` | No | If unset, emails are silently skipped |
| `RESEND_FROM_EMAIL` | No | Default: `noreply@tools.soexcellence.com` |
| `SENTRY_DSN` | No | Backend Sentry project DSN |
| `APP_ENV` | No | `development` \| `production` |
| `API_BASE_URL` | Yes | `https://api.tools.soexcellence.com` (prod) or `http://localhost:8000` (dev) |
| `ADMIN_EMAILS` | No | JSON array: `["you@example.com"]`. These users get `role='admin'` on first sign-in. Currently: `harikrishnan@soexcellence.com` |
| `RAILWAY_API_TOKEN` | No | For billing dashboard (Railway GraphQL API) |
| `RAILWAY_PROJECT_ID` | No | |

### Frontend (Vite build args / Railway service vars)

| Variable | Description |
|----------|-------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `VITE_API_BASE_URL` | Backend URL. Baked into bundle at build time. |
| `VITE_SENTRY_DSN` | Frontend Sentry project DSN |

**Important:** Vite bakes `VITE_*` vars into the JavaScript bundle at build time, not at runtime. Changing them requires a rebuild and redeploy.

### RunPod Worker (template env vars, set in RunPod dashboard)

| Variable | Description |
|----------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user `titan-cc-worker` credentials (more restricted than backend) |
| `AWS_SECRET_ACCESS_KEY` | |
| `AWS_REGION` | `ap-south-1` |
| `S3_BUCKET` | `titan-transcribe-prod` |
| `WEBHOOK_URL` | `https://api.tools.soexcellence.com/webhooks/runpod` |
| `WEBHOOK_SECRET` | Must match backend's `RUNPOD_WEBHOOK_SECRET` |

---

## 13. Local Development

### Prerequisites

- Docker (for Postgres)
- Python 3.12 + uv
- Node.js 20+
- AWS credentials (for S3; you can mock S3 with localstack for pure local dev)

### 1. Start Postgres

```bash
docker compose up -d
```

Postgres will be available at `localhost:5432` with user/pass/db all `titan`.

### 2. Backend

```bash
cd backend
cp ../.env.example .env   # Fill in real values
uv sync
source .venv/bin/activate

# Run migrations
alembic upgrade head

# Start dev server (auto-reload)
uvicorn app.main:app --reload
```

Backend available at `http://localhost:8000`. OpenAPI docs at `http://localhost:8000/docs`.

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local  # Set VITE_CLERK_PUBLISHABLE_KEY and VITE_API_BASE_URL=http://localhost:8000
npm install
npm run dev
```

Frontend available at `http://localhost:5173`.

### 4. Fake RunPod (optional, for testing without GPU)

```bash
cd scripts
python fake_runpod.py
```

This starts an HTTP server on port 9000 that accepts RunPod dispatch POSTs, sleeps 10 seconds, and sends back a fake `completed` webhook. Set `RUNPOD_ENDPOINT_URL=http://localhost:9000/run` in the backend `.env`.

### 5. Run Tests

```bash
cd backend
pytest -v
```

### Generating TypeScript Types from OpenAPI

```bash
npx openapi-typescript http://localhost:8000/openapi.json -o frontend/src/api/types.ts
```

Note: `src/api/types.ts` is currently hand-written. Run this command after adding new endpoints to sync the types.

---

## 14. Deployment

### Infrastructure

| Service | Platform | URL |
|---------|----------|-----|
| Frontend | Railway | `tools.soexcellence.com` → CNAME `z2hu6wdx.up.railway.app` |
| Backend | Railway | `api.tools.soexcellence.com` → CNAME `fkcwmde2.up.railway.app` |
| Database | Railway (managed Postgres) | Internal Railway networking |
| RunPod worker | RunPod serverless | Endpoint `s1qzo6w76dn34l` |
| S3 | AWS `ap-south-1` | `titan-transcribe-prod` |

### Deploy Commands

**CRITICAL: Always use `--path-as-root` with the absolute subdirectory path.** Without it, Railway uploads the entire monorepo root and Railpack can't find the Dockerfile.

```bash
# Deploy backend
railway up --service backend --detach \
  --path-as-root /Users/joshua/Documents/Titan/titan-cc/backend

# Deploy frontend
railway up --service frontend --detach \
  --path-as-root /Users/joshua/Documents/Titan/titan-cc/frontend
```

### What Happens on Backend Deploy

The `Dockerfile` CMD runs:
```bash
alembic upgrade head   # idempotent; runs pending migrations
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Migrations run on every restart — this is safe because Alembic is idempotent.

### What Happens on Frontend Deploy

Two-stage Docker build:
1. `node:20-alpine` — `npm ci` + `npm run build` with `VITE_*` build args
2. `nginx:alpine` — copies `dist/` + `nginx.conf`

The built JS bundle contains the baked-in API URL and Clerk publishable key.

### Cloudflare DNS Notes

Both CNAMEs in Cloudflare are set to **DNS-only (grey cloud)**. If you enable the orange cloud (Cloudflare proxy), Railway's HTTP→HTTPS redirect combines with Cloudflare's own redirect to create a 301 redirect loop. **Do not enable Cloudflare proxy on these records.**

### RunPod Worker Deploy

The GitHub Action `.github/workflows/build-runpod-worker.yml` automatically builds and pushes `ghcr.io/titan-cc/runpod-worker:latest` on any push to `main` that changes `runpod-handler/**`.

The GHCR package is **public** — no pull credentials needed. If it's ever accidentally set to private, RunPod workers will get stuck at `image pull: pending`.

To manually trigger:
```bash
gh workflow run build-runpod-worker.yml
```

After the image is pushed, running RunPod workers will pick up the new image on their next cold start. There is no automated restart — kill any idle workers in the RunPod dashboard to force a fresh pull.

---

## 15. CI/CD

### `build-runpod-worker.yml`

Triggers on push to `main` touching `runpod-handler/**`. Builds `linux/amd64` image, pushes to GHCR with `:latest` and `:{sha}` tags. Uses GitHub Actions cache (`type=gha`) to speed up repeated builds. Frees disk space before building (CUDA image is large).

### `check-ghcr-credential.yml`

Runs every Monday 08:00 UTC. Logs in to GHCR and checks the image manifest. If it fails, opens a GitHub issue titled "GHCR pull PAT invalid — RunPod workers will fail to start". Won't create a duplicate issue if one is already open.

**Setup required:** Add the GHCR PAT as `GHCR_PULL_PAT` in GitHub repo secrets (Settings → Secrets → Actions). When rotating the PAT: update GitHub secret + RunPod registry credential `cmomnlem8003ll706pviemib4` (RunPod → Settings → Registry Credentials → Edit `ghcr-titan-pat`).

---

## 16. Operational Runbooks

### Job stuck in `dispatched` for more than 20 minutes

The watchdog automatically handles this (20-minute timeout → re-queue or fail). If you need to force it immediately:

```bash
# Reset stuck dispatched jobs via admin endpoint
curl -X POST \
  "https://api.tools.soexcellence.com/admin/jobs/reset-dispatched?older_than_minutes=5&x_admin_key=<RUNPOD_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json"
```

### RunPod workers stuck at `initializing`/`throttled`

1. Check GHCR package visibility: must be **public**. Go to `https://github.com/orgs/titan-cc/packages/container/runpod-worker/settings` → "Change visibility" → Public.
2. Check the GHCR pull credential in RunPod (Settings → Registry Credentials → `ghcr-titan-pat`). If it's expired (PAT-based), generate a new classic PAT with `read:packages` scope and update it.
3. Kill all workers in the RunPod endpoint dashboard to force a fresh pull.

### Webhook never arrives (job stuck in `dispatched`)

1. Check `s3://titan-transcribe-prod/dead-letters/` for a `.json` file with the job ID. If present, the worker completed but failed to deliver the webhook.
2. Replay the webhook:
   ```python
   import hmac, hashlib, time, uuid, json, requests
   
   secret = "<RUNPOD_WEBHOOK_SECRET>"
   payload = <contents of dead-letter file>["payload"]
   body = json.dumps(payload).encode()
   ts = str(time.time())
   nonce = str(uuid.uuid4())
   sig = hmac.new(secret.encode(), f"{ts}.{nonce}.".encode() + body, hashlib.sha256).hexdigest()
   
   requests.post(
       "https://api.tools.soexcellence.com/webhooks/runpod",
       data=body,
       headers={
           "Content-Type": "application/json",
           "X-Runpod-Signature": f"sha256={sig}",
           "X-Runpod-Timestamp": ts,
           "X-Runpod-Nonce": nonce,
       }
   )
   ```
3. If no dead-letter: the worker itself may have crashed before uploading outputs. Check RunPod pod logs in the dashboard.

### Quota not resetting at month start

Quotas are reset lazily — only when a user submits a job and `quota_reset_at < NOW()`. There is no cron job. To manually reset a user's quota:

```bash
curl -X POST "https://api.tools.soexcellence.com/admin/users/<user_id>/quota/refresh" \
  -H "Authorization: Bearer <admin_jwt>"
```

### Adding an admin user

Set `ADMIN_EMAILS` on the Railway backend service (JSON array). The user gets promoted to `role='admin'` on their next sign-in. Alternatively, use the Admin → Users panel if already signed in as an admin.

### Checking backend logs

```bash
railway logs --service backend --tail 100
```

Logs are structured JSON (structlog). Key fields: `event`, `job_id`, `error`, `webhook_event`.

### Manual smoke test

```bash
cd scripts
./smoke-test.sh https://api.tools.soexcellence.com <clerk_jwt>
```

---

## 17. Known Gotchas

### Clerk JWT does not include email

Clerk JWTs exclude the `email` claim by default. On first sign-in, the backend calls `GET https://api.clerk.com/v1/users/{clerk_user_id}` with `CLERK_SECRET_KEY` to fetch the email. If `CLERK_SECRET_KEY` is not set, the user is created with an empty email string. Fix: always set `CLERK_SECRET_KEY`.

To add email to the JWT directly: Clerk dashboard → Sessions → Edit → add `email: user.primaryEmailAddress?.emailAddress` to the custom session token template.

### Whisper language is always English

`pipeline/transcribe.py` hardcodes `language="en"`. The `config.language` field from the frontend is not used by the worker. Changing to `auto` requires upgrading from Whisper medium to large-v3 (exceeds AMPERE_16 VRAM). See comment in `transcribe.py`.

### Vite bakes API URL at build time

`VITE_API_BASE_URL` becomes a compile-time constant in the bundle. If you need to change the API URL, you must rebuild and redeploy the frontend.

### Cloudflare proxy must stay off

See [Deployment](#14-deployment) section. Orange cloud = 301 redirect loop. Grey cloud only.

### GHCR package must stay public

If `ghcr.io/titan-cc/runpod-worker` is set to private, RunPod will be unable to pull the image without credentials. Credentials need to be configured as a Registry Credential in RunPod settings. The image contains no secrets (all injected at runtime via env vars), so keeping it public is safe.

### Nonce deduplication is in-memory

The webhook nonce cache (`_seen_nonces` in `webhooks.py`) is a module-level dict. It is cleared on every process restart. This means a nonce could technically be reused across a restart within the 5-minute timestamp window. For the current scale (8-9 jobs/month), this is acceptable.

### `minutes_used_this_month` is incremented on completion, not on creation

Quota is checked at presign and job-creation time against the current `minutes_used_this_month`. The actual increment happens when the `completed` webhook arrives. This means a user could submit many jobs simultaneously before any completes and temporarily exceed their quota. The concurrent job limit (`max_concurrent_jobs`) is the guard against this, but it is not currently enforced in the backend (check but no block).

### S3 input files are not deleted when a job fails

The S3 lifecycle policy deletes all files after 15 days regardless of job status. If a user retries a failed job, the original input is still available in S3. There is no mechanism to delete files earlier.

### Railway `--path-as-root` is mandatory

`railway up` without `--path-as-root` uploads the entire repo root. Railpack then looks for a `Dockerfile` at the root level, doesn't find one (they're in subdirectories), and silently falls back to Railpack auto-detection which produces incorrect builds.

---

## 18. What Is NOT Built (v1 Deferred List)

Do not build these without a clear requirement change:

- ❌ **Stripe billing** — No payment processing. Current plan: free tier with quota limits.
- ❌ **Watchdog process separation** — The watchdog runs as an asyncio task inside the FastAPI process. It's not a separate worker.
- ❌ **LISTEN/NOTIFY** — Frontend polls every 5 seconds. No WebSocket or Postgres LISTEN.
- ❌ **RunPod always-warm worker** — Workers spin up from cold start. Idle timeout is 30 seconds.
- ❌ **Synthetic monitoring canary** — No scheduled health-check job.
- ❌ **GDPR delete cascade** — The 15-day S3 lifecycle policy is the v1 delete mechanism. No user-initiated delete.
- ❌ **Admin dashboard screens** — Dashboard overview, Watchdog panel, Workers panel, Storage panel exist as wireframes but are not implemented. Only Users and Billing admin screens are built.
- ❌ **A/B validation framework**
- ❌ **System cost circuit breaker** — No automatic spend limit enforcement beyond RunPod's built-in spend limit.
- ❌ **Auto-expire job rows** — `expires_at` is set but no sweeper marks rows as `expired`. They remain queryable.
- ❌ **Multilingual transcription** — English only. See [Known Gotchas](#17-known-gotchas).
- ❌ **File size validation at upload time** — The presign endpoint validates `size_bytes <= 5GB` but S3 itself does not enforce a size cap on the presigned PUT (S3 content-length constraint requires `x-amz-content-sha256` which isn't set). For v1 this is fine.

---

## Alembic Migration Reference

```bash
# Apply all pending migrations
alembic upgrade head

# Create a new migration after changing models.py
alembic revision --autogenerate -m "describe your change"

# Downgrade one step
alembic downgrade -1

# Show current revision
alembic current

# Show migration history
alembic history
```

Migrations live in `backend/alembic/versions/`. The migration chain is linear:

```
18e39188719b (initial schema)
  → 801f6206ffe7 (add input_filename)
  → 926668407981 (make idempotency job_id nullable)
  → c4f8a2b1d9e0 (add admin fields: role, is_enabled, access_level)
  → f3a1b2c4d5e6 (add runpod_job_id)
```

---

*Last updated: 2026-05-01. For implementation history and per-phase change logs, see [CLAUDE.md](CLAUDE.md).*
