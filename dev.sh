#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# JobHunter – dev launcher with health monitoring & auto-restart
#
# Usage:  bash dev.sh          (or  ./dev.sh  if chmod +x)
#
# Features:
#   1. Starts PostgreSQL via Docker (idempotent)
#   2. Health-gates until Postgres accepts connections
#   3. Runs Prisma generate + migrate
#   4. Starts NestJS backend (SWC) and Next.js frontend (Turbopack)
#   5. Watchdog monitors every 5s — restarts crashed services
#   6. Port health checks confirm services are actually serving
#   7. Restart cooldown prevents infinite crash loops
#   8. All processes killed cleanly on Ctrl+C
# ──────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOG_DIR="$ROOT_DIR/.dev-logs"

# ── Load ports from root .env (single source of truth) ──────
if [ -f "$ROOT_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a; source "$ROOT_DIR/.env"; set +a
fi
BACKEND_PORT="${BACKEND_PORT:-3210}"
FRONTEND_PORT="${FRONTEND_PORT:-3211}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

# ── Watchdog config ──────────────────────────────────────────
HEALTH_INTERVAL=5        # seconds between watchdog checks
HEALTH_TIMEOUT=10        # seconds to wait for a probe (first hit on a Next route compiles)
STRIKE_LIMIT=3           # consecutive failed probes before a service is restarted
MAX_RESTARTS=5           # max restarts per service before giving up
RESTART_COOLDOWN=30      # seconds to wait after last restart before allowing another
BOOT_GRACE=120           # seconds a service may take to compile and bind its port
# Probe a path that actually answers: the Nest API returns 404 at "/" and Next
# is still bundling on first request, so probing "/" restarts healthy services.
BACKEND_HEALTH_URL="http://localhost:${BACKEND_PORT}/api/health"
FRONTEND_HEALTH_URL="http://localhost:${FRONTEND_PORT}/login"

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[dev]${NC} $*"; }
ok()    { echo -e "${GREEN}[dev] ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}[dev] ⚠${NC} $*"; }
fail()  { echo -e "${RED}[dev] ✗${NC} $*"; exit 1; }
log()   { echo -e "${DIM}$(date '+%H:%M:%S')${NC} $*"; }

# ── State tracking ───────────────────────────────────────────
declare -A SVC_PID           # current PID per service
declare -A SVC_RESTARTS      # restart count per service
declare -A SVC_LAST_RESTART  # epoch of last restart per service
declare -A SVC_RUNNING       # 1 if process should be alive
declare -A SVC_LOG           # log file path per service
declare -A SVC_LAST_START    # epoch of the most recent (re)start, for boot grace
declare -A SVC_STRIKES       # consecutive failed health probes per service
RUNNING=1                    # global flag — set to 0 on shutdown

mkdir -p "$LOG_DIR"
SVC_LOG[backend]="$LOG_DIR/backend.log"
SVC_LOG[frontend]="$LOG_DIR/frontend.log"

# ── Process helpers ───────────────────────────────────────────
# Services start as `bash -c "cd dir && npm run …"`, so the tracked PID is a
# wrapper: a plain `kill` leaves the real node process (and its port) behind.
# On Windows, taskkill /T takes the whole tree; elsewhere fall back to the
# process group, then the bare PID.
kill_tree() {
  local pid="$1"
  [ -z "$pid" ] && return 0
  if command -v taskkill &>/dev/null; then
    taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
  fi
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
}

# PIDs bound to a TCP listen port — the ground truth when the wrapper is gone.
pids_on_port() {
  local port="$1"
  command -v netstat &>/dev/null || return 0
  netstat -ano 2>/dev/null | grep -i LISTENING | grep -E "[:.]${port}([^0-9]|$)" | awk '{print $NF}' | sort -u
}

# ── Cleanup on exit ───────────────────────────────────────────
cleanup() {
  RUNNING=0
  info "Shutting down…"
  for svc in backend frontend; do
    local pid="${SVC_PID[$svc]:-}"
    local port
    case "$svc" in
      backend) port="$BACKEND_PORT" ;;
      *) port="$FRONTEND_PORT" ;;
    esac
    kill_tree "$pid"
    # Sweep anything still holding the port (children of a dead wrapper).
    for orphan in $(pids_on_port "$port"); do
      kill_tree "$orphan"
    done
  done
  wait 2>/dev/null
  ok "All services stopped."
}
trap cleanup EXIT INT TERM

# ── Port check ────────────────────────────────────────────────
# A service counts as serving when it answers at all: the Nest API replies 404
# to "/" and 200 to "/api/health", and both prove the port is bound. Only a
# connection that times out or is refused means the service is not up.
port_responding() {
  local port="$1"
  local url="$2"
  if command -v curl &>/dev/null; then
    local code
    code="$(curl -s -o /dev/null --max-time "$HEALTH_TIMEOUT" -w '%{http_code}' "$url" 2>/dev/null)"
    [ -n "$code" ] && [ "$code" != "000" ]
  elif command -v nc &>/dev/null; then
    nc -z -w "$HEALTH_TIMEOUT" localhost "$port" 2>/dev/null
  elif command -v powershell &>/dev/null; then
    powershell -NoProfile -Command "(New-Object System.Net.Sockets.TcpClient).Connect('localhost', ${port})" 2>/dev/null
  else
    # Fallback: just check if process is alive (less reliable)
    return 0
  fi
}

# ── Start a service ───────────────────────────────────────────
start_service() {
  local name="$1"
  local dir="$2"
  local cmd="$3"

  log "Starting ${BOLD}${name}${NC}…"
  (cd "$dir" && eval "$cmd") > "${SVC_LOG[$name]}" 2>&1 &
  SVC_PID[$name]=$!
  SVC_RUNNING[$name]=1
  SVC_LAST_START[$name]=$(date +%s)
  SVC_STRIKES[$name]=0

  # Brief wait to catch immediate crashes (exit within 2s = bad)
  sleep 2
  if ! kill -0 "${SVC_PID[$name]}" 2>/dev/null; then
    warn "${name} crashed immediately on startup — check ${SVC_LOG[$name]}"
    SVC_RUNNING[$name]=0
    return 1
  fi
  return 0
}

# ── Restart a service ─────────────────────────────────────────
restart_service() {
  local name="$1"
  local dir="$2"
  local cmd="$3"
  local now
  now=$(date +%s)

  local restarts="${SVC_RESTARTS[$name]:-0}"
  local last="${SVC_LAST_RESTART[$name]:-0}"
  local elapsed=$(( now - last ))

  # Enforce max restarts
  if [ "$restarts" -ge "$MAX_RESTARTS" ]; then
    warn "${BOLD}${name}${NC} has restarted ${MAX_RESTARTS} times — giving up. Check logs:"
    warn "  ${SVC_LOG[$name]}"
    SVC_RUNNING[$name]=0
    return 1
  fi

  # Enforce cooldown
  if [ "$elapsed" -lt "$RESTART_COOLDOWN" ] && [ "$restarts" -gt 0 ]; then
    log "${DIM}  … ${name} cooldown (${elapsed}s / ${RESTART_COOLDOWN}s) — skipping${NC}"
    return 0
  fi

  # Kill old process if still lingering
  local old_pid="${SVC_PID[$name]:-}"
  if [ -n "$old_pid" ]; then
    kill_tree "$old_pid"
    sleep 1
  fi

  restarts=$(( restarts + 1 ))
  SVC_RESTARTS[$name]=$restarts
  SVC_LAST_RESTART[$name]=$now

  warn "Restarting ${BOLD}${name}${NC} (attempt ${restarts}/${MAX_RESTARTS})…"
  start_service "$name" "$dir" "$cmd"
}

# ── Ensure the configured database is reachable ───────────────
# SQLite is the authoritative database (see docs/ops-runbook.md).
# Only fall back to PostgreSQL when the schema actually asks for it,
# so a fresh checkout does not require Docker.
DB_PROVIDER="$(sed -n 's/^[[:space:]]*provider[[:space:]]*=[[:space:]]*"\([a-z0-9]*\)".*/\1/p' "$BACKEND_DIR/prisma/schema.prisma" | head -1)"
DB_PROVIDER="${DB_PROVIDER:-sqlite}"
DB_LABEL="SQLite (${DATABASE_URL:-file:./dev.db})"

if [ "$DB_PROVIDER" = "sqlite" ]; then
  ok "Database: SQLite — no server to start."
elif command -v pg_isready &>/dev/null && pg_isready -p "$POSTGRES_PORT" &>/dev/null; then
  ok "Database: PostgreSQL is running (native)."
  DB_LABEL="PostgreSQL localhost:${POSTGRES_PORT}"
elif command -v docker &>/dev/null; then
  info "Database: PostgreSQL — starting container…"
  POSTGRES_PORT="$POSTGRES_PORT" docker compose -f "$BACKEND_DIR/docker-compose.yml" up -d --wait 2>/dev/null || \
    POSTGRES_PORT="$POSTGRES_PORT" docker compose -f "$BACKEND_DIR/docker-compose.yml" up -d
  RETRIES=0
  until docker exec jobhunter-pg pg_isready -U jobhunter -d jobhunter &>/dev/null; do
    RETRIES=$((RETRIES + 1))
    [ "$RETRIES" -ge 30 ] && fail "Postgres did not become ready after 30s."
    sleep 1
  done
  ok "Database: PostgreSQL is running (Docker)."
  DB_LABEL="PostgreSQL localhost:${POSTGRES_PORT}"
else
  fail "Schema wants PostgreSQL but neither PostgreSQL nor Docker is available."
fi

# ── Prisma generate + apply committed migrations ──────────────
# `migrate deploy` applies only committed migrations and never rewrites
# schema history; `migrate dev --name _ensure` used to leave a trailing
# "_ensure" migration behind on every start.
info "Running Prisma generate…"
(cd "$BACKEND_DIR" && npx prisma generate --quiet 2>/dev/null) || true
info "Applying committed migrations…"
if ! (cd "$BACKEND_DIR" && npx prisma migrate deploy 2>&1 | tail -3); then
  warn "prisma migrate deploy failed — see docs/ops-runbook.md (one-time baseline may be required)."
fi

# ── Start services ────────────────────────────────────────────
start_service "backend"  "$BACKEND_DIR"  "npm run start:dev"
start_service "frontend" "$FRONTEND_DIR" "npm run dev"

# ── Banner ────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       JobHunter Dev Servers + Watchdog       ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  Frontend  : ${CYAN}http://localhost:${FRONTEND_PORT}${NC}              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Backend   : ${CYAN}http://localhost:${BACKEND_PORT}${NC}              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Database  : ${CYAN}${DB_LABEL}${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  Watchdog  : ${DIM}every ${HEALTH_INTERVAL}s · max ${MAX_RESTARTS} restarts · ${RESTART_COOLDOWN}s cooldown · ${BOOT_GRACE}s boot grace${NC}  ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Logs      : ${DIM}${LOG_DIR}/${NC}  ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Press ${RED}Ctrl+C${NC} to stop all services."
echo ""

# ── Watchdog loop ─────────────────────────────────────────────
svc_cmd()  { case "$1" in backend) echo "npm run start:dev";; frontend) echo "npm run dev";; esac; }
svc_dir()  { case "$1" in backend) echo "$BACKEND_DIR";; frontend) echo "$FRONTEND_DIR";; esac; }
svc_port() { case "$1" in backend) echo "$BACKEND_PORT";; frontend) echo "$FRONTEND_PORT";; esac; }
svc_url()  { case "$1" in backend) echo "$BACKEND_HEALTH_URL";; frontend) echo "$FRONTEND_HEALTH_URL";; esac; }

while [ "$RUNNING" -eq 1 ]; do
  sleep "$HEALTH_INTERVAL"
  [ "$RUNNING" -eq 0 ] && break

  for svc in backend frontend; do
    # Skip if we already gave up on this service
    [ "${SVC_RUNNING[$svc]:-0}" -eq 0 ] && continue
    pid="${SVC_PID[$svc]:-}"
    url="$(svc_url "$svc")"
    port="$(svc_port "$svc")"

    # Answering on its health path — healthy, whatever the status code.
    if port_responding "$port" "$url"; then
      SVC_STRIKES[$svc]=0
      continue
    fi

    now=$(date +%s)
    since_boot=$(( now - ${SVC_LAST_START[$svc]:-0} ))

    # Wrapper gone and the port not answering, past the first 15s of boot: the
    # service is really down. (The port probe above protects against the common
    # case where only the wrapper exited and the server is still bound.)
    if [ -z "$pid" ] || { ! kill -0 "$pid" 2>/dev/null && [ "$since_boot" -gt 15 ]; }; then
      warn "${BOLD}${svc}${NC} process died (pid ${pid:-unknown})"
      restart_service "$svc" "$(svc_dir "$svc")" "$(svc_cmd "$svc")"
      continue
    fi

    # Still inside the boot grace — `nest start --watch` and `next dev` compile
    # for tens of seconds before binding. Restarting during that window used to
    # kill healthy services in a loop.
    if [ "$since_boot" -lt "$BOOT_GRACE" ]; then
      continue
    fi

    # Grace is over and the probe failed; require a few consecutive misses
    # before acting, because one slow request can time out on its own.
    strikes=$(( ${SVC_STRIKES[$svc]:-0} + 1 ))
    SVC_STRIKES[$svc]=$strikes
    if [ "$strikes" -lt "$STRIKE_LIMIT" ]; then
      log "${DIM}  ${svc} probe ${strikes}/${STRIKE_LIMIT} failed; waiting${NC}"
      continue
    fi

    log "${DIM}  ${svc} has not answered ${url} — restarting${NC}"
    restart_service "$svc" "$(svc_dir "$svc")" "$(svc_cmd "$svc")"
  done
done
