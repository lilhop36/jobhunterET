#!/bin/sh
set -e

BACKEND_PORT="${BACKEND_PORT:-3210}"
FRONTEND_PORT="${FRONTEND_PORT:-3211}"
export BACKEND_PORT FRONTEND_PORT

cd /app/backend
mkdir -p /app/data/uploads/cv
echo "[entrypoint] Applying database migrations (backup + copy verification)..."
# Fails closed: a refused migration stops the container instead of risking data.
DATABASE_URL="${DATABASE_URL:-file:/app/data/prod.db}" node scripts/db-migrate-safe.js

echo "[entrypoint] Starting backend on ${BACKEND_PORT}..."
PORT="${BACKEND_PORT}" npm run start:prod &
BACKEND_PID=$!

# wait for backend health
i=0
while [ "$i" -lt 60 ]; do
  if wget -qO- "http://localhost:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
    echo "[entrypoint] Backend ready."
    break
  fi
  i=$((i + 1))
  sleep 1
done

cd /app/frontend
echo "[entrypoint] Starting frontend on ${FRONTEND_PORT}..."
PORT="${FRONTEND_PORT}" npm run start &
FRONTEND_PID=$!

wait "$BACKEND_PID" "$FRONTEND_PID"