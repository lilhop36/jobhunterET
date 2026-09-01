#!/bin/sh

# Railway sets PORT and optionally DATABASE_URL / JWT_SECRET.
# These defaults ensure the app boots with zero config.

export DATABASE_URL="${DATABASE_URL:-file:./prod.db}"

if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
  echo "[start.sh] JWT_SECRET auto-generated"
fi

echo "[start.sh] Starting app (DB: $([ "${DATABASE_URL#file:}" = "$DATABASE_URL" ] && echo 'PostgreSQL' || echo 'SQLite'))..."
exec node dist/main.js
