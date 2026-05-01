#!/usr/bin/env bash
# Run from titan-cc/ root.  Exits non-zero if anything fails.
set -euo pipefail

PSQL="${PSQL:-/opt/homebrew/opt/postgresql@16/bin/psql}"
DB_URL="${DATABASE_URL:-postgresql://titan:titan@localhost:5432/titan}"
API="${API_BASE_URL:-http://localhost:8000}"

PASS=0
FAIL=0

ok()   { echo "  [OK]  $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

echo ""
echo "=== Titan CC Smoke Test ==="
echo ""

# ── 1. /healthz ───────────────────────────────────────────────────────────────
echo "1. Backend /healthz"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/healthz" 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ]; then
  ok "/healthz → 200"
else
  fail "/healthz → $STATUS (is the server running? cd backend && uv run uvicorn app.main:app)"
fi

# ── 2. All 7 tables ───────────────────────────────────────────────────────────
echo ""
echo "2. Postgres tables"

EXPECTED=(users quotas jobs idempotency_keys notifications job_events alembic_version)

for TABLE in "${EXPECTED[@]}"; do
  RESULT=$("$PSQL" "$DB_URL" -t -c "SELECT to_regclass('public.$TABLE');" 2>/dev/null | tr -d ' \n')
  if [ "$RESULT" = "$TABLE" ]; then
    ok "table: $TABLE"
  else
    fail "table missing: $TABLE"
  fi
done

# ── 3. Enum types ─────────────────────────────────────────────────────────────
echo ""
echo "3. Postgres enum types"

for ENUM in job_status failure_class; do
  EXISTS=$("$PSQL" "$DB_URL" -t -c "SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname='$ENUM');" 2>/dev/null | tr -d ' \n')
  if [ "$EXISTS" = "t" ]; then
    ok "enum: $ENUM"
  else
    fail "enum missing: $ENUM"
  fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "All checks passed — OK"
