#!/bin/sh
set -e

# Default DATABASE_URL for SQLite if not set
export DATABASE_URL="${DATABASE_URL:-file:./prod.db}"

# Default JWT_SECRET if not set
if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
  echo "[start.sh] JWT_SECRET auto-generated"
fi

# Push Prisma schema to ensure tables exist (fast, idempotent)
echo "[start.sh] Running prisma db push..."
npx prisma db push --skip-generate --accept-data-loss

# Start the app
echo "[start.sh] Starting app..."
exec node dist/main.js
