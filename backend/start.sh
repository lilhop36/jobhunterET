#!/bin/sh

# Absolute path to backend directory
BACKEND_DIR="$(cd "$(dirname "$0")" && pwd)"

# Default DATABASE_URL using absolute path for SQLite
export DATABASE_URL="${DATABASE_URL:-file:${BACKEND_DIR}/prod.db}"

# Default JWT_SECRET if not set
if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
  echo "[start.sh] JWT_SECRET auto-generated"
fi

echo "[start.sh] DATABASE_URL=$DATABASE_URL"

# Push Prisma schema — use local binary directly (npx may change CWD)
PRISMA="${BACKEND_DIR}/node_modules/.bin/prisma"
if [ -x "$PRISMA" ]; then
  echo "[start.sh] Running prisma db push..."
  "$PRISMA" db push --skip-generate --accept-data-loss 2>&1 || echo "[start.sh] prisma db push failed"
else
  echo "[start.sh] prisma binary not found at $PRISMA, skipping db push"
fi

# Start the app
echo "[start.sh] Starting app..."
exec node dist/main.js
