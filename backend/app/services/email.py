import math

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger()

_RESEND_URL = "https://api.resend.com/emails"


async def send_job_completed_email(to_email: str, job_id: str, duration_seconds: int) -> None:
    if not settings.resend_api_key:
        logger.warning("email_skipped", reason="RESEND_API_KEY not set")
        return
    minutes = math.ceil(duration_seconds / 60)
    await _send(
        to=to_email,
        subject="Your transcription is ready",
        html=_completion_html(job_id, minutes),
    )


async def send_job_failed_email(to_email: str, job_id: str, failure_message: str) -> None:
    if not settings.resend_api_key:
        logger.warning("email_skipped", reason="RESEND_API_KEY not set")
        return
    await _send(
        to=to_email,
        subject="Transcription failed",
        html=_failure_html(job_id, failure_message),
    )


async def _send(to: str, subject: str, html: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                _RESEND_URL,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={
                    "from": settings.resend_from_email,
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
            )
            resp.raise_for_status()
            logger.info("email_sent", to=to, subject=subject)
    except Exception as exc:
        # Never let email failure break the caller
        logger.error("email_failed", error=str(exc))


def _completion_html(job_id: str, minutes: int) -> str:
    url = f"https://tools.soexcellence.com/jobs/{job_id}"
    return f"""
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:560px;margin:40px auto;color:#111">
  <h2 style="margin-bottom:8px">Your transcription is ready</h2>
  <p>Your {minutes}-minute audio file has been transcribed successfully.</p>
  <p><a href="{url}" style="color:#2563eb">View and download your transcript →</a></p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0">
  <p style="font-size:12px;color:#6b7280">Titan CC · tools.soexcellence.com</p>
</body>
</html>"""


def _failure_html(job_id: str, failure_message: str) -> str:
    url = f"https://tools.soexcellence.com/jobs/{job_id}"
    return f"""
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:560px;margin:40px auto;color:#111">
  <h2 style="margin-bottom:8px">Transcription failed</h2>
  <p>{failure_message}</p>
  <p><a href="{url}" style="color:#2563eb">View job details →</a></p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0">
  <p style="font-size:12px;color:#6b7280">Titan CC · tools.soexcellence.com</p>
</body>
</html>"""
