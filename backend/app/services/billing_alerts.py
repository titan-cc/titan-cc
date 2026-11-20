"""
Billing alerts shown to admins as a banner on every Titan page.

- RunPod (prepaid credit): red when, at the current spend rate, the balance is
  expected to fall below RUNPOD_MIN_USD within LOOKAHEAD_HOURS.
- Railway (card, monthly): amber when the next bill is due within DUE_SOON_DAYS;
  red when an invoice is open/failed or the account is past due.
- AWS (invoice with a due date): amber when an invoice is due within
  DUE_SOON_DAYS, red once it is past due, until an admin marks it paid
  (AWS's API has no paid/unpaid field).

The rule functions are pure (data in, alerts out) so they are easy to test;
the fetchers only gather the data and never raise.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, timedelta
from typing import Any

import boto3
import httpx
import structlog
from botocore.exceptions import BotoCoreError, ClientError

from app.config import settings

logger = structlog.get_logger()

RUNPOD_MIN_USD = 0.50
LOOKAHEAD_HOURS = 24
DUE_SOON_DAYS = 5
AWS_LOOKBACK_DAYS = 45  # unpaid invoices older than this are assumed handled


def alert(id_: str, provider: str, level: str, title: str, message: str,
          action_label: str | None = None, action_url: str | None = None,
          banner: bool = True, invoice_id: str | None = None) -> dict[str, Any]:
    return {
        "id": id_, "provider": provider, "level": level, "title": title, "message": message,
        "action_label": action_label, "action_url": action_url, "banner": banner,
        "invoice_id": invoice_id,
    }


def _days(n: float) -> str:
    n = max(0, round(n))
    return "today" if n == 0 else "tomorrow" if n == 1 else f"in {n} days"


# ── Rules ─────────────────────────────────────────────────────────────────────

def runpod_rules(balance: float, spend_per_hr: float) -> list[dict]:
    """balance and spend in USD; spend_per_hr is RunPod's current burn rate."""
    url = "https://www.runpod.io/console/user/billing"
    if balance <= RUNPOD_MIN_USD:
        return [alert(
            "runpod-credit", "runpod", "red", "RunPod credit is almost gone",
            f"${balance:.2f} left. Transcriptions stop when it reaches $0. Top up now.",
            "Top up on RunPod", url,
        )]
    if spend_per_hr > 0:
        hours_to_min = (balance - RUNPOD_MIN_USD) / spend_per_hr
        if hours_to_min <= LOOKAHEAD_HOURS:
            hours_left = balance / spend_per_hr
            when = f"about {hours_left:.0f} hours" if hours_left >= 1.5 else "less than 2 hours"
            return [alert(
                "runpod-credit", "runpod", "red", "RunPod credit is about to run out",
                f"${balance:.2f} left, {when} at the current rate. Transcriptions stop at $0.",
                "Top up on RunPod", url,
            )]
    return []


def railway_rules(customer: dict, today: date) -> list[dict]:
    """customer: Railway's billing customer (state, invoices, subscriptions, defaultPaymentMethod)."""
    out: list[dict] = []
    billing_url = "https://railway.com/account/billing"
    state = (customer.get("state") or "").upper()
    open_invoices = [
        i for i in customer.get("invoices") or []
        if (i.get("status") or "").lower() in ("open", "uncollectible")
        and float(i.get("amountDue") or 0) > float(i.get("amountPaid") or 0)
    ]
    if state in ("PAST_DUE", "UNPAID") or open_invoices:
        inv = open_invoices[0] if open_invoices else {}
        reason = inv.get("lastPaymentError")
        out.append(alert(
            "railway-unpaid", "railway", "red", "Railway bill is unpaid",
            "A Railway invoice has not been paid"
            + (f" ({reason})" if reason else "")
            + ". Titan's servers can be stopped if it stays unpaid.",
            "Pay on Railway", inv.get("hostedURL") or billing_url,
        ))
        return out

    upcoming = []
    for sub in customer.get("subscriptions") or []:
        try:
            d = datetime.fromisoformat(str(sub.get("nextInvoiceDate")).replace("Z", "+00:00")).date()
        except ValueError:
            continue
        if (sub.get("status") or "").lower() in ("active", "trialing", "past_due"):
            upcoming.append(d)
    if upcoming:
        due = min(upcoming)
        days = (due - today).days
        if 0 <= days <= DUE_SOON_DAYS:
            card = ((customer.get("defaultPaymentMethod") or {}).get("card")) or {}
            pay = f"It will be charged to the card ending {card['last4']}" if card.get("last4") else "No card is on file"
            out.append(alert(
                f"railway-due-{due.isoformat()}", "railway", "amber",
                f"Railway bill is due {_days(days)}",
                f"The next Railway bill is due on {due:%d %b}. {pay}.",
                "Open Railway billing", billing_url,
            ))
    return out


def aws_rules(invoices: list[dict], paid_ids: set[str], today: date) -> list[dict]:
    """invoices: AWS invoice summaries (InvoiceId, DueDate, InvoiceType, PaymentCurrencyAmount)."""
    out: list[dict] = []
    for inv in invoices:
        if inv.get("InvoiceType", "INVOICE") != "INVOICE":
            continue
        inv_id = inv.get("InvoiceId")
        due = inv.get("DueDate")
        if not inv_id or not due or inv_id in paid_ids:
            continue
        due_d = due.date() if isinstance(due, datetime) else due
        days = (due_d - today).days
        if days > DUE_SOON_DAYS or days < -AWS_LOOKBACK_DAYS:
            continue
        amt = inv.get("PaymentCurrencyAmount") or {}
        amount = f"{amt.get('CurrencyCode', '')} {amt.get('TotalAmount', '')}".strip()
        overdue = days < 0
        out.append(alert(
            f"aws-{inv_id}", "aws", "red" if overdue else "amber",
            "AWS invoice is overdue" if overdue else f"AWS invoice is due {_days(days)}",
            f"Invoice {inv_id}" + (f" for {amount}" if amount else "") + f" is due on {due_d:%d %b}."
            + (" Pay it to keep storage and uploads running." if overdue else "")
            + " Mark it paid here once it is settled.",
            "Open AWS billing", "https://console.aws.amazon.com/billing/home#/bills",
            invoice_id=inv_id,
        ))
    return out


# ── Fetchers (never raise) ────────────────────────────────────────────────────

async def runpod_alerts() -> list[dict]:
    if not settings.runpod_api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                "https://api.runpod.io/graphql",
                headers={"Authorization": f"Bearer {settings.runpod_api_key}"},
                json={"query": "{ myself { clientBalance currentSpendPerHr } }"},
            )
            data = r.json() if r.status_code < 500 else {}
        me = (data.get("data") or {}).get("myself")
        if r.status_code in (401, 403) or not me:
            return [alert(
                "runpod-unreadable", "runpod", "amber", "Can't check RunPod credit",
                "RunPod rejected the API key, so Titan can't warn you before credit runs out. "
                "Give the key All permission in RunPod.",
                "RunPod API keys", "https://www.runpod.io/console/user/settings", banner=False,
            )]
        return runpod_rules(float(me.get("clientBalance") or 0), float(me.get("currentSpendPerHr") or 0))
    except Exception as exc:
        logger.warning("billing_alert_runpod_failed", error=type(exc).__name__)
        return []


_RAILWAY_QUERY = """
{ me { workspaces { name customer {
    state
    defaultPaymentMethod { card { brand last4 } }
    invoices { invoiceId status amountDue amountPaid periodEnd hostedURL lastPaymentError }
    subscriptions { status nextInvoiceDate }
} } } }
"""


async def railway_alerts(today: date) -> list[dict]:
    if not settings.railway_api_token:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                "https://backboard.railway.app/graphql/v2",
                headers={"Authorization": f"Bearer {settings.railway_api_token}"},
                json={"query": _RAILWAY_QUERY},
            )
            data = r.json()
        if data.get("errors"):
            logger.warning("billing_alert_railway_errors", error=data["errors"][0].get("message"))
            return []
        out: list[dict] = []
        for ws in (data.get("data") or {}).get("me", {}).get("workspaces") or []:
            out += railway_rules(ws.get("customer") or {}, today)
        return out
    except Exception as exc:
        logger.warning("billing_alert_railway_failed", error=type(exc).__name__)
        return []


def _aws_invoices_sync(today: date) -> list[dict] | str:
    """Invoices for this month and the last two. Returns an error code string on failure."""
    try:
        creds = dict(
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        account = boto3.client("sts", region_name="us-east-1", **creds).get_caller_identity()["Account"]
        inv_client = boto3.client("invoicing", region_name="us-east-1", **creds)
        out: list[dict] = []
        d = today.replace(day=1)
        for _ in range(3):
            resp = inv_client.list_invoice_summaries(
                Selector={"ResourceType": "ACCOUNT_ID", "Value": account},
                Filter={"BillingPeriod": {"Month": d.month, "Year": d.year}},
            )
            out += resp.get("InvoiceSummaries", [])
            d = (d - timedelta(days=1)).replace(day=1)
        return out
    except ClientError as exc:
        return exc.response.get("Error", {}).get("Code", "ClientError")
    except BotoCoreError as exc:
        return type(exc).__name__


async def aws_alerts(today: date, paid_ids: set[str]) -> list[dict]:
    if not settings.aws_access_key_id or not settings.aws_secret_access_key:
        return []
    result = await asyncio.get_running_loop().run_in_executor(None, _aws_invoices_sync, today)
    if isinstance(result, str):
        logger.warning("billing_alert_aws_failed", error=result)
        if result in ("AccessDeniedException", "AccessDenied", "UnauthorizedOperation"):
            return [alert(
                "aws-unreadable", "aws", "amber", "Can't check AWS invoices",
                "Titan's AWS key needs the invoicing:ListInvoiceSummaries permission "
                "(and sts:GetCallerIdentity) to warn you about due invoices.",
                banner=False,
            )]
        return []
    return aws_rules(result, paid_ids, today)


async def all_alerts(paid_ids: set[str]) -> list[dict]:
    today = datetime.now(UTC).date()
    groups = await asyncio.gather(runpod_alerts(), railway_alerts(today), aws_alerts(today, paid_ids))
    order = {"red": 0, "amber": 1}
    return sorted((a for g in groups for a in g), key=lambda a: order.get(a["level"], 2))
