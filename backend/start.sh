#!/bin/sh

# Default DATABASE_URL for SQLite if not set
export DATABASE_URL="${DATABASE_URL:-file:./prod.db}"

# Default JWT_SECRET if not set
if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
  echo "[start.sh] JWT_SECRET auto-generated"
fi

# Push Prisma schema to ensure tables exist
# Use node directly (faster than npx, no download overhead)
echo "[start.sh] Pushing database schema..."
node node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss || {
  echo "[start.sh] prisma db push failed — app will try to start anyway"
}

# Start the app
echo "[start.sh] Starting app..."
exec node dist/main.js
