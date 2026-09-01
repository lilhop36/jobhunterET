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

# Push Prisma schema — use node directly to invoke prisma CLI
# (avoids npx overhead and symlink issues)
echo "[start.sh] Running prisma db push..."
cd "$BACKEND_DIR"
node node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss 2>&1 || echo "[start.sh] prisma db push failed — continuing anyway"

# Start the app
echo "[start.sh] Starting app..."
exec node dist/main.js
