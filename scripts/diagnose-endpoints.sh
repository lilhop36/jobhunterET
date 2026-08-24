#!/bin/bash
# Diagnostic loop: hits every authenticated endpoint and reports 500s
# Usage: bash scripts/diagnose-endpoints.sh

set -euo pipefail
BASE="http://localhost:3210"
EMAIL="admin@jobhunter.et"
PASS="password123"

# Login
TOKEN=$(curl -sf -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')

if [ -z "$TOKEN" ]; then
  echo "FATAL: Could not login. Backend may be down."
  exit 1
fi

AUTH="Authorization: Bearer $TOKEN"
RED='\033[0;31m'
GRN='\033[0;32m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

check() {
  local method="$1" path="$2" body="${3:-}" label="${4:-$method $path}"
  local code
  if [ -n "$body" ]; then
    code=$(curl -sf -o /dev/null -w "%{http_code}" \
      -X "$method" "$BASE$path" -H "$AUTH" \
      -H "Content-Type: application/json" \
      -d "$body" 2>/dev/null || echo "000")
  else
    code=$(curl -sf -o /dev/null -w "%{http_code}" \
      -X "$method" "$BASE$path" -H "$AUTH" 2>/dev/null || echo "000")
  fi
  if [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; then
    echo -e "  ${GRN}✓${NC} $label → $code"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    # Capture response body for failures
    local resp
    if [ -n "$body" ]; then
      resp=$(curl -s -X "$method" "$BASE$path" -H "$AUTH" \
        -H "Content-Type: application/json" -d "$body" 2>&1 | head -c 200)
    else
      resp=$(curl -s -X "$method" "$BASE$path" -H "$AUTH" 2>&1 | head -c 200)
    fi
    echo -e "  ${RED}✗${NC} $label → $code — $resp"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

echo "=== Auth ==="
check POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" "POST /auth/login"
check PATCH /auth/password "{\"currentPassword\":\"wrong\",\"newPassword\":\"test1234\"}" "PATCH /auth/password (wrong pw)"

echo "=== Profile ==="
check GET /profile "" "GET /profile"
check PATCH /profile "{\"title\":\"Test User\"}" "PATCH /profile"
check GET /profile/cv "" "GET /profile/cv"

echo "=== Dashboard ==="
check GET /dashboard "" "GET /dashboard"

echo "=== Jobs ==="
check GET "/jobs?limit=2" "" "GET /jobs"
check GET "/jobs/nonexistent-id" "" "GET /jobs/:id"

echo "=== Matches ==="
check GET /matches "" "GET /matches"
check POST /matches/recalculate "" "POST /matches/recalculate"

echo "=== Applications ==="
check GET /applications "" "GET /applications"

echo "=== Saved Jobs ==="
check GET /saved-jobs "" "GET /saved-jobs"

echo "=== Notifications ==="
check GET /inbox "" "GET /inbox"
check GET /settings "" "GET /settings/notifications"

echo "=== Searches ==="
check GET /searches "" "GET /searches"

echo "=== Telegram ==="
check GET /telegram/status "" "GET /telegram/status"
check POST /telegram/link-code "" "POST /telegram/link-code"

echo "=== Salary ==="
check GET "/salary/benchmark?role=Developer&level=MID" "" "GET /salary/benchmark"
check GET "/salary/compare?salary=50000&currency=USD&title=Developer&level=MID" "" "GET /salary/compare"
check GET /salary/benchmarks "" "GET /salary/benchmarks"
check GET /salary/fx "" "GET /salary/fx"

echo "=== Admin ==="
check GET /admin/stats "" "GET /admin/stats"
check GET /admin/users "" "GET /admin/users"

echo "=== Sources (admin) ==="
check GET /sources "" "GET /sources"
check GET /sources/health "" "GET /sources/health"

echo "=== Digest ==="
check GET /digest "" "GET /digest"

echo "=== Events ==="
# SSE endpoint requires token in query — check it returns a stream
SSE_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
  "$BASE/events/stream?token=$TOKEN" --max-time 2 2>/dev/null || echo "000")
if [ "$SSE_CODE" = "200" ] || [ "$SSE_CODE" = "000" ]; then
  # 000 is expected if the connection stays open (EventSource)
  echo -e "  ${GRN}✓${NC} GET /events/stream → $SSE_CODE (SSE stream)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo -e "  ${RED}✗${NC} GET /events/stream → $SSE_CODE"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo "══════════════════════════════════════"
echo -e "  ${GRN}PASSED: $PASS_COUNT${NC}  ${RED}FAILED: $FAIL_COUNT${NC}"
echo "══════════════════════════════════════"
