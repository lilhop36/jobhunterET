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
HEALTH_TIMEOUT=3         # seconds to wait for a port probe
MAX_RESTARTS=5           # max restarts per service before giving up
RESTART_COOLDOWN=30      # seconds to wait after last restart before allowing another
BACKEND_HEALTH_URL="http://localhost:${BACKEND_PORT}"
FRONTEND_HEALTH_URL="http://localhost:${FRONTEND_PORT}"

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
RUNNING=1                    # global flag — set to 0 on shutdown

mkdir -p "$LOG_DIR"
SVC_LOG[backend]="$LOG_DIR/backend.log"
SVC_LOG[frontend]="$LOG_DIR/frontend.log"

# ── Cleanup on exit ───────────────────────────────────────────
cleanup() {
  RUNNING=0
  info "Shutting down…"
  # kill all tracked children
  for svc in "${!SVC_PID[@]}"; do
    local pid="${SVC_PID[$svc]}"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      # give it a moment to exit gracefully
      for i in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
      # force-kill if still alive
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null
  ok "All services stopped."
}
trap cleanup EXIT INT TERM

# ── Port check ────────────────────────────────────────────────
port_responding() {
  local port="$1"
  # Try a TCP connect with timeout (works without curl)
  if command -v curl &>/dev/null; then
    curl -sf -o /dev/null --max-time "$HEALTH_TIMEOUT" "http://localhost:${port}/" 2>/dev/null
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
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid" 2>/dev/null || true
    sleep 1
    kill -0 "$old_pid" 2>/dev/null && kill -9 "$old_pid" 2>/dev/null || true
  fi

  restarts=$(( restarts + 1 ))
  SVC_RESTARTS[$name]=$restarts
  SVC_LAST_RESTART[$name]=$now

  warn "Restarting ${BOLD}${name}${NC} (attempt ${restarts}/${MAX_RESTARTS})…"
  start_service "$name" "$dir" "$cmd"
}

# ── Ensure Postgres is reachable ─────────────────────────────
info "Checking PostgreSQL…"
if command -v pg_isready &>/dev/null && pg_isready -p "$POSTGRES_PORT" &>/dev/null; then
  ok "PostgreSQL is running (native)."
elif command -v docker &>/dev/null; then
  info "Starting PostgreSQL container…"
  POSTGRES_PORT="$POSTGRES_PORT" docker compose -f "$BACKEND_DIR/docker-compose.yml" up -d --wait 2>/dev/null || \
    POSTGRES_PORT="$POSTGRES_PORT" docker compose -f "$BACKEND_DIR/docker-compose.yml" up -d
  RETRIES=0
  until docker exec jobhunter-pg pg_isready -U jobhunter -d jobhunter &>/dev/null; do
    RETRIES=$((RETRIES + 1))
    [ "$RETRIES" -ge 30 ] && fail "Postgres did not become ready after 30s."
    sleep 1
  done
  ok "PostgreSQL is running (Docker)."
else
  fail "PostgreSQL not found. Install PostgreSQL or Docker."
fi

# ── Prisma generate + migrate ─────────────────────────────────
info "Running Prisma generate…"
(cd "$BACKEND_DIR" && npx prisma generate --quiet 2>/dev/null) || true
info "Running Prisma migrate (dev)…"
(cd "$BACKEND_DIR" && npx prisma migrate dev --name _ensure 2>/dev/null) || true

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
echo -e "${GREEN}║${NC}  Postgres  : ${CYAN}localhost:5432${NC}                  ${GREEN}║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  Watchdog  : ${DIM}every ${HEALTH_INTERVAL}s · max ${MAX_RESTARTS} restarts · ${RESTART_COOLDOWN}s cooldown${NC}  ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Logs      : ${DIM}${LOG_DIR}/${NC}  ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Press ${RED}Ctrl+C${NC} to stop all services."
echo ""

# ── Watchdog loop ─────────────────────────────────────────────
while [ "$RUNNING" -eq 1 ]; do
  sleep "$HEALTH_INTERVAL"
  [ "$RUNNING" -eq 0 ] && break

  for svc in backend frontend; do
    pid="${SVC_PID[$svc]:-}"
    should_be_running="${SVC_RUNNING[$svc]:-0}"

    # Skip if we already gave up on this service
    [ "$should_be_running" -eq 0 ] && continue

    # Check 1: is the process alive?
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      # Process alive — also verify the port is responding
      if [ "$svc" = "backend" ]; then
        if ! port_responding "$BACKEND_PORT"; then
          log "${DIM}  ${svc} process alive but port ${BACKEND_PORT} not responding — restarting${NC}"
          if [ "$svc" = "backend" ]; then
            restart_service "backend" "$BACKEND_DIR" "npm run start:dev"
          fi
        fi
      elif [ "$svc" = "frontend" ]; then
        if ! port_responding "$FRONTEND_PORT"; then
          log "${DIM}  ${svc} process alive but port ${FRONTEND_PORT} not responding — restarting${NC}"
          restart_service "frontend" "$FRONTEND_DIR" "npm run dev"
        fi
      fi
    else
      # Process is dead — restart it
      warn "${BOLD}${svc}${NC} process died (pid ${pid:-unknown})"
      if [ "$svc" = "backend" ]; then
        restart_service "backend" "$BACKEND_DIR" "npm run start:dev"
      elif [ "$svc" = "frontend" ]; then
        restart_service "frontend" "$FRONTEND_DIR" "npm run dev"
      fi
    fi
  done
done
