#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
# switch-db.sh — Copy the right Prisma schema for the database
#
# Detects provider from DATABASE_URL:
#   file:./…  → SQLite   (schema.sqlite.prisma)
#   postgres  → PostgreSQL (schema.prisma)
#
# Usage:
#   ./scripts/switch-db.sh          # auto-detect from DATABASE_URL
#   ./scripts/switch-db.sh sqlite   # force SQLite
#   ./scripts/switch-db.sh pg       # force PostgreSQL
# ══════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PRISMA_DIR="$SCRIPT_DIR/../prisma"

# Load .env if present
if [ -f "$PRISMA_DIR/../.env" ]; then
  set -a
  . "$PRISMA_DIR/../.env"
  set +a
fi

FORCE="${1:-}"

detect_provider() {
  if [ "$FORCE" = "sqlite" ]; then
    echo "sqlite"
  elif [ "$FORCE" = "pg" ] || [ "$FORCE" = "postgresql" ]; then
    echo "postgresql"
  elif [ -z "${DATABASE_URL:-}" ]; then
    # No DATABASE_URL set — default to SQLite for $0 budget
    echo "sqlite"
  elif echo "$DATABASE_URL" | grep -qiE '^file:'; then
    echo "sqlite"
  else
    echo "postgresql"
  fi
}

PROVIDER=$(detect_provider)

if [ "$PROVIDER" = "sqlite" ]; then
  echo "🗄️  Switching to SQLite (schema.sqlite.prisma → schema.prisma)"
  cp "$PRISMA_DIR/schema.sqlite.prisma" "$PRISMA_DIR/schema.prisma"
else
  echo "🐘 Switching to PostgreSQL (schema.prisma already in place)"
  # Restore from the committed PostgreSQL schema if the backup exists
  if [ -f "$PRISMA_DIR/schema.postgresql.prisma" ]; then
    cp "$PRISMA_DIR/schema.postgresql.prisma" "$PRISMA_DIR/schema.prisma"
  fi
fi

echo "✅ Provider: $PROVIDER"
echo "   Run: npx prisma generate && npx prisma migrate dev"
