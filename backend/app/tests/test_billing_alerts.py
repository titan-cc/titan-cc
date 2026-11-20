"""Billing alerts: the rules for RunPod, Railway and AWS, and Mark as paid."""

import uuid
from datetime import date, datetime

import pytest
from sqlalchemy import delete, text

from app.db import async_session_factory, engine
from app.deps import get_current_user, require_admin
from app.main import app
from app.models import BillingAcknowledgement, User
from app.services import billing_alerts as ba

TODAY = date(2026, 11, 20)


# ── RunPod ────────────────────────────────────────────────────────────────────

def test_runpod_quiet_when_plenty_left():
    assert ba.runpod_rules(balance=40.0, spend_per_hr=0.5) == []
    assert ba.runpod_rules(balance=5.0, spend_per_hr=0.0) == []


def test_runpod_warns_when_it_will_drop_below_50_cents_within_a_day():
    [a] = ba.runpod_rules(balance=6.0, spend_per_hr=0.5)  # $0.50 in 11 hours
    assert a["level"] == "red" and a["banner"] is True
    assert "$6.00 left" in a["message"] and "12 hours" in a["message"]
    assert ba.runpod_rules(balance=20.0, spend_per_hr=0.5) == []  # 39 hours away


def test_runpod_warns_at_the_threshold_even_when_idle():
    [a] = ba.runpod_rules(balance=0.40, spend_per_hr=0.0)
    assert a["title"] == "RunPod credit is almost gone"


# ── Railway ───────────────────────────────────────────────────────────────────

def _customer(**kw):
    base = {
        "state": "ACTIVE",
        "defaultPaymentMethod": {"card": {"brand": "visa", "last4": "4242"}},
        "invoices": [{"invoiceId": "in_1", "status": "paid", "amountDue": 5, "amountPaid": 5}],
        "subscriptions": [{"status": "active", "nextInvoiceDate": "2026-12-20T00:00:00Z"}],
    }
    base.update(kw)
    return base


def test_railway_quiet_when_paid_and_not_due_soon():
    assert ba.railway_rules(_customer(), TODAY) == []


def test_railway_reminds_when_due_soon():
    [a] = ba.railway_rules(_customer(subscriptions=[{"status": "active", "nextInvoiceDate": "2026-11-23T00:00:00Z"}]), TODAY)
    assert a["level"] == "amber" and "in 3 days" in a["title"] and "4242" in a["message"]


def test_railway_red_when_unpaid_or_past_due():
    unpaid = _customer(invoices=[{"invoiceId": "in_2", "status": "open", "amountDue": 7, "amountPaid": 0,
                                  "hostedURL": "https://pay.example/in_2", "lastPaymentError": "card declined"}])
    [a] = ba.railway_rules(unpaid, TODAY)
    assert a["level"] == "red" and "card declined" in a["message"] and a["action_url"] == "https://pay.example/in_2"
    [b] = ba.railway_rules(_customer(state="PAST_DUE"), TODAY)
    assert b["level"] == "red"


# ── AWS ───────────────────────────────────────────────────────────────────────

def _inv(inv_id, due, kind="INVOICE"):
    return {"InvoiceId": inv_id, "DueDate": datetime.combine(due, datetime.min.time()), "InvoiceType": kind,
            "PaymentCurrencyAmount": {"TotalAmount": "812.40", "CurrencyCode": "INR"}}


def test_aws_due_soon_overdue_and_marked_paid():
    invs = [_inv("A1", date(2026, 11, 23)), _inv("A2", date(2026, 11, 10)), _inv("A3", date(2026, 12, 20)),
            _inv("R1", date(2026, 11, 21), kind="PAYMENT_RECEIPT")]
    alerts = {a["invoice_id"]: a for a in ba.aws_rules(invs, set(), TODAY)}
    assert set(alerts) == {"A1", "A2"}
    assert alerts["A1"]["level"] == "amber" and "INR 812.40" in alerts["A1"]["message"]
    assert alerts["A2"]["level"] == "red"
    assert [a["invoice_id"] for a in ba.aws_rules(invs, {"A2"}, TODAY)] == ["A1"]


# ── Mark as paid (local Postgres; skipped when it is not running) ─────────────

async def _db_ready() -> bool:
    await engine.dispose()
    try:
        async with async_session_factory() as db:
            await db.execute(text("SELECT 1 FROM billing_acknowledgements LIMIT 1"))
        return True
    except Exception:
        return False


@pytest.fixture
async def admin_client(client):
    if not await _db_ready():
        pytest.skip("local Postgres with billing_acknowledgements is not available")
    uid = uuid.uuid4()
    async with async_session_factory() as db:
        db.add(User(id=uid, clerk_user_id=f"test_{uid}", email="t@example.com", role="admin"))
        await db.commit()
        user = await db.get(User, uid)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_admin] = lambda: user
    yield client
    app.dependency_overrides.clear()
    async with async_session_factory() as db:
        await db.execute(delete(BillingAcknowledgement).where(BillingAcknowledgement.invoice_id.like("TEST-%")))
        await db.execute(delete(User).where(User.id == uid))
        await db.commit()


async def test_mark_paid_hides_the_aws_alert(admin_client, monkeypatch):
    async def no_alerts(*_a, **_k):
        return []

    async def fake_aws(today, paid_ids):
        return ba.aws_rules([_inv("TEST-1", date.today())], paid_ids, date.today())

    monkeypatch.setattr(ba, "runpod_alerts", no_alerts)
    monkeypatch.setattr(ba, "railway_alerts", no_alerts)
    monkeypatch.setattr(ba, "aws_alerts", fake_aws)

    r = await admin_client.get("/admin/billing/alerts", params={"refresh": True})
    assert [a["invoice_id"] for a in r.json()] == ["TEST-1"]

    r = await admin_client.post("/admin/billing/mark-paid", json={"provider": "aws", "invoice_id": "TEST-1"})
    assert r.status_code == 204
    r = await admin_client.post("/admin/billing/mark-paid", json={"provider": "aws", "invoice_id": "TEST-1"})
    assert r.status_code == 204  # marking twice is fine

    r = await admin_client.get("/admin/billing/alerts")
    assert r.json() == []
