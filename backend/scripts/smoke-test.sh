#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# JobHunter 15-Minute Smoke Test — Phase 9
#
# Verifies the system is healthy end-to-end after deployment.
# Run: bash scripts/smoke-test.sh
#
# Exit codes:
#   0 = all checks passed
#   1 = one or more checks failed
# ──────────────────────────────────────────────────────────────

set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:3210}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3211}"
PASS=0
FAIL=0
TOTAL=0

check() {
  TOTAL=$((TOTAL + 1))
  local desc="$1"
  local result="$2"
  if [ "$result" = "pass" ]; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "═══════════════════════════════════════════════════════════"
echo " JobHunter Smoke Test — $(date)"
echo "═══════════════════════════════════════════════════════════"

# ── 1. Service Health ──
echo ""
echo "1. Service Health"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "000" ]; then
  check "Backend reachable (HTTP $HTTP_CODE)" "pass"
else
  check "Backend reachable" "fail"
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "000" ]; then
  check "Frontend reachable (HTTP $HTTP_CODE)" "pass"
else
  check "Frontend reachable" "fail"
fi

# ── 2. Authentication ──
echo ""
echo "2. Authentication"

TOKEN=$(curl -s -X POST "$BACKEND_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"amara@jobhunter.et","password":"demo1234"}' 2>/dev/null \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ] && [ "$TOKEN" != "undefined" ]; then
  check "Login returns JWT token" "pass"
else
  check "Login returns JWT token" "fail"
  TOKEN=""
fi

if [ -n "$TOKEN" ]; then
  # Test auth guard
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/dashboard" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ]; then
    check "Authenticated endpoint returns 200" "pass"
  else
    check "Authenticated endpoint returns 200 (got $HTTP_CODE)" "fail"
  fi

  # Test unauthorized
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/dashboard" 2>/dev/null)
  if [ "$HTTP_CODE" = "401" ]; then
    check "Unauthorized request returns 401" "pass"
  else
    check "Unauthorized request returns 401 (got $HTTP_CODE)" "fail"
  fi
fi

# ── 3. Security Headers ──
echo ""
echo "3. Security Headers"

HEADERS=$(curl -sI "$BACKEND_URL/" 2>/dev/null)

if echo "$HEADERS" | grep -qi "x-content-type-options: nosniff"; then
  check "X-Content-Type-Options: nosniff" "pass"
else
  check "X-Content-Type-Options: nosniff" "fail"
fi

if echo "$HEADERS" | grep -qi "x-frame-options"; then
  check "X-Frame-Options present" "pass"
else
  check "X-Frame-Options present" "fail"
fi

if echo "$HEADERS" | grep -qi "content-security-policy"; then
  check "Content-Security-Policy present" "pass"
else
  check "Content-Security-Policy present" "fail"
fi

# ── 4. Core API Endpoints ──
echo ""
echo "4. Core API Endpoints"

if [ -n "$TOKEN" ]; then
  # Dashboard
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/dashboard" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ]; then
    check "GET /dashboard → 200" "pass"
  else
    check "GET /dashboard → 200 (got $HTTP_CODE)" "fail"
  fi

  # Profile
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/profile" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ]; then
    check "GET /profile → 200" "pass"
  else
    check "GET /profile → 200 (got $HTTP_CODE)" "fail"
  fi

  # Matches
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/matches" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ]; then
    check "GET /matches → 200" "pass"
  else
    check "GET /matches → 200 (got $HTTP_CODE)" "fail"
  fi

  # Saved jobs
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/saved-jobs" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ]; then
    check "GET /saved-jobs → 200" "pass"
  else
    check "GET /saved-jobs → 200 (got $HTTP_CODE)" "fail"
  fi

  # Applications
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/applications" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ]; then
    check "GET /applications → 200" "pass"
  else
    check "GET /applications → 200 (got $HTTP_CODE)" "fail"
  fi

  # Searches
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/searches" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ]; then
    check "GET /searches → 200" "pass"
  else
    check "GET /searches → 200 (got $HTTP_CODE)" "fail"
  fi

  # Sources
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/sources" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "403" ]; then
    check "GET /sources → 200/403" "pass"
  else
    check "GET /sources → 200/403 (got $HTTP_CODE)" "fail"
  fi
fi

# ── 5. Data Integrity ──
echo ""
echo "5. Data Integrity"

if [ -n "$TOKEN" ]; then
  DASHBOARD=$(curl -s "$BACKEND_URL/dashboard" -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{}')

  NEW_MATCHES=$(echo "$DASHBOARD" | grep -o '"new24h":[0-9]*' | cut -d':' -f2 || true)
  if [ -n "$NEW_MATCHES" ]; then
    check "Database has matches (new 24h: $NEW_MATCHES)" "pass"
  else
    check "Database has matches" "fail"
  fi

  SAVED=$(echo "$DASHBOARD" | grep -o '"saved":[0-9]*' | cut -d':' -f2 || true)
  if [ -n "$SAVED" ]; then
    check "Saved jobs tracked (count: $SAVED)" "pass"
  else
    check "Saved jobs tracked" "fail"
  fi
else
  check "Data integrity (skipped — no token)" "skip"
fi

# ── 6. Rate Limiting ──
echo ""
echo "6. Rate Limiting"

if [ -n "$TOKEN" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}' 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "429" ]; then
    check "Auth rejects invalid credentials (HTTP $HTTP_CODE)" "pass"
  else
    check "Auth rejects invalid credentials (got $HTTP_CODE)" "fail"
  fi
fi

# ── 7. Frontend Rendering ──
echo ""
echo "7. Frontend Rendering"

HTML=$(curl -s "$FRONTEND_URL/" 2>/dev/null)
if echo "$HTML" | grep -qi "JobHunter\|__next"; then
  check "Frontend serves HTML with Next.js" "pass"
else
  check "Frontend serves HTML with Next.js" "fail"
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
