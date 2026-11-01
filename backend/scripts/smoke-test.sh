#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# JobHunter Smoke Test — post-deployment sanity check
#
# Verifies the running system end-to-end: services, auth, guards,
# security headers, core endpoints, data, throttling, frontend render.
#
# Run: bash scripts/smoke-test.sh
#
# The backend serves everything under the global "api" prefix
# (main.ts → app.setGlobalPrefix('api')), so every URL below is
# ${BACKEND_URL}/api/… — probing the bare port only ever returned 404.
#
# Credentials: the demo admin from prisma/seed.ts is tried first, then the
# local dev admin. On a database that was not seeded (for example a restored
# production copy) pass an account that exists:
#   SMOKE_EMAIL="you@example.com" SMOKE_PASSWORD="…" bash scripts/smoke-test.sh
#
# Exit codes:  0 = all checks passed, 1 = one or more checks failed
# ──────────────────────────────────────────────────────────────

set -uo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:3210}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3211}"
API="${BACKEND_URL}/api"

# Candidate accounts, tried in order until one issues a token. SMOKE_EMAIL /
# SMOKE_PASSWORD pin a single account and disable the fallback list.
if [ -n "${SMOKE_EMAIL:-}" ]; then
  CANDIDATES=("${SMOKE_EMAIL}|${SMOKE_PASSWORD:-demo1234}")
else
  CANDIDATES=("amara@jobhunter.et|demo1234" "admin@jobhunter.et|password123")
fi

PASS=0
FAIL=0
TOTAL=0
TOKEN=""
SMOKE_ACCOUNT=""

check() {
  TOTAL=$((TOTAL + 1))
  if [ "$2" = "pass" ]; then
    echo "  ✅ $1"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $1"
    FAIL=$((FAIL + 1))
  fi
}

# code <url> [curl args…] — HTTP status only, "000" when unreachable.
code() {
  local url="$1"; shift
  curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" "$@" 2>/dev/null || echo "000"
}

# body <url> [curl args…] — response body, empty string on failure.
body() {
  local url="$1"; shift
  curl -s --max-time 20 "$url" "$@" 2>/dev/null || true
}

# json_field <json> <key> — first string|number value for "key". Never fails,
# because a missing key must not abort the script under pipefail.
json_field() {
  printf '%s' "$1" | sed -n "s/.*\"$2\":\"\{0,1\}\([^,\"}]*\).*/\1/p" | head -1
}

echo "═══════════════════════════════════════════════════════════"
echo " JobHunter Smoke Test — $(date)"
echo " Backend ${API} · Frontend ${FRONTEND_URL}"
echo "═══════════════════════════════════════════════════════════"

# ── 1. Service Health ──
echo ""
echo "1. Service Health"

HEALTH=$(body "${API}/health")
HEALTH_CODE=$(code "${API}/health")
if [ "$HEALTH_CODE" = "200" ] && printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
  check "GET /api/health → 200 ok" "pass"
else
  check "GET /api/health → 200 ok (got ${HEALTH_CODE:-000})" "fail"
fi

FE_CODE=$(code "${FRONTEND_URL}/login")
if [ "$FE_CODE" = "200" ]; then
  check "Frontend /login → 200" "pass"
else
  check "Frontend /login → 200 (got ${FE_CODE})" "fail"
fi

# ── 2. Authentication ──
echo ""
echo "2. Authentication"

for pair in "${CANDIDATES[@]}"; do
  EMAIL="${pair%%|*}"
  PASSWORD="${pair##*|}"
  RESP=$(body "${API}/auth/login" -X POST -H "Content-Type: application/json" \
    -d "$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")")
  TOKEN=$(json_field "$RESP" "accessToken")
  if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
    SMOKE_ACCOUNT="$EMAIL"
    break
  fi
done

if [ -n "$TOKEN" ]; then
  check "Login returns JWT ($SMOKE_ACCOUNT, ${#TOKEN} chars)" "pass"
else
  check "Login returns JWT (no candidate account authenticated)" "fail"
fi

AUTH=(-H "Authorization: Bearer ${TOKEN:-none}")

if [ -n "$TOKEN" ]; then
  C=$(code "${API}/dashboard" "${AUTH[@]}")
  if [ "$C" = "200" ]; then
    check "Authenticated endpoint returns 200" "pass"
  else
    check "Authenticated endpoint returns 200 (got $C)" "fail"
  fi
fi

# Guards must reject anonymous traffic regardless of the login above.
C=$(code "${API}/dashboard")
if [ "$C" = "401" ]; then
  check "Anonymous /api/dashboard → 401" "pass"
else
  check "Anonymous /api/dashboard → 401 (got $C)" "fail"
fi

C=$(code "${API}/matches")
if [ "$C" = "401" ]; then
  check "Anonymous /api/matches → 401" "pass"
else
  check "Anonymous /api/matches → 401 (got $C)" "fail"
fi

# ── 3. Security Headers ──
echo ""
echo "3. Security Headers"

HEADERS=$(curl -sI --max-time 20 "${API}/health" 2>/dev/null || true)
for h in "x-content-type-options: nosniff" "x-frame-options" "content-security-policy"; do
  if printf '%s' "$HEADERS" | grep -qi "$h"; then
    check "Header present: $h" "pass"
  else
    check "Header present: $h" "fail"
  fi
done

# ── 4. Core API Endpoints ──
echo ""
echo "4. Core API Endpoints"

if [ -n "$TOKEN" ]; then
  for route in dashboard profile matches saved-jobs applications searches inbox digest; do
    C=$(code "${API}/${route}" "${AUTH[@]}")
    if [ "$C" = "200" ]; then
      check "GET /api/${route} → 200" "pass"
    else
      check "GET /api/${route} → 200 (got $C)" "fail"
    fi
  done

  C=$(code "${API}/sources" "${AUTH[@]}")
  if [ "$C" = "200" ] || [ "$C" = "403" ]; then
    check "GET /api/sources → 200/403 (role guard)" "pass"
  else
    check "GET /api/sources → 200/403 (got $C)" "fail"
  fi
else
  check "Core endpoints (skipped — no token)" "fail"
fi

# ── 5. Data Integrity ──
echo ""
echo "5. Data Integrity"

if [ -n "$TOKEN" ]; then
  DASHBOARD=$(body "${API}/dashboard" "${AUTH[@]}")

  NEW=$(json_field "$DASHBOARD" "new24h")
  if [ -n "$NEW" ]; then
    check "Dashboard reports new matches in 24h: $NEW" "pass"
  else
    check "Dashboard reports new24h" "fail"
  fi

  SAVED=$(json_field "$DASHBOARD" "saved")
  if [ -n "$SAVED" ]; then
    check "Dashboard reports saved count: $SAVED" "pass"
  else
    check "Dashboard reports saved count" "fail"
  fi

  MATCHES=$(body "${API}/matches?limit=50" "${AUTH[@]}")
  IDS=$(printf '%s' "$MATCHES" | grep -o '"jobId":"[^"]*"' | sort -u | wc -l | tr -d ' ')
  DUPES=$(printf '%s' "$MATCHES" | grep -o '"jobId":"[^"]*"' | wc -l | tr -d ' ')
  if [ "${IDS:-0}" -gt 0 ] && [ "$IDS" = "$DUPES" ]; then
    check "Matches are unique per job ($IDS rows, no repeats)" "pass"
  else
    check "Matches unique per job (unique $IDS of $DUPES)" "fail"
  fi
else
  check "Data integrity (skipped — no token)" "fail"
fi

# ── 6. Rate Limiting ──
echo ""
echo "6. Rate Limiting"

# A distinct email so the throttle probe cannot lock the smoke account.
C=$(code "${API}/auth/login" -X POST -H "Content-Type: application/json" \
  -d '{"email":"smoke-invalid@invalid.local","password":"definitely-wrong"}')
if [ "$C" = "401" ] || [ "$C" = "429" ]; then
  check "Invalid credentials rejected (HTTP $C)" "pass"
else
  check "Invalid credentials rejected (got $C)" "fail"
fi

# ── 7. Frontend Rendering ──
echo ""
echo "7. Frontend Rendering"

HTML=$(body "${FRONTEND_URL}/login")
if printf '%s' "$HTML" | grep -qi "JobHunter\|__next\|_next"; then
  check "Frontend serves Next.js HTML" "pass"
else
  check "Frontend serves Next.js HTML" "fail"
fi

# ── Summary ──
echo ""
echo "═══════════════════════════════════════════════════════════"
echo " Results: $PASS/$TOTAL passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
  echo " ❌ SMOKE TEST FAILED"
  exit 1
else
  echo " ✅ SMOKE TEST PASSED"
  exit 0
fi
