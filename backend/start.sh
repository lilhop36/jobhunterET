#!/bin/sh

export DATABASE_URL="${DATABASE_URL:-file:./prod.db}"

if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
  echo "[start.sh] JWT_SECRET auto-generated"
fi

echo "[start.sh] DATABASE_URL=$DATABASE_URL"
echo "[start.sh] Running prisma db push..."
npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "[start.sh] prisma db push failed — continuing anyway"

echo "[start.sh] Starting app..."
exec node dist/main.js
