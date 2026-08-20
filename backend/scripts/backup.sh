#!/usr/bin/env bash
# JobHunter nightly backup script — NFR-008
#
# Usage: bash scripts/backup.sh
# Reads DATABASE_URL from backend/.env for connection details.
# Outputs to ./backups/ with 7-day rotation.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
CV_DIR="${CV_UPLOAD_DIR:-./uploads/cv}"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_PREFIX="[BACKUP]"

echo "$LOG_PREFIX Starting backup at $(date)"

# ── Parse DATABASE_URL ──
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\).*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')
DB_USER=$(echo "$DATABASE_URL" | sed -n 's|://\([^:]*\):.*|\1|p')

echo "$LOG_PREFIX Database: $DB_NAME @ $DB_HOST:$DB_PORT (user: $DB_USER)"

# ── Create backup directory ──
mkdir -p "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR/pg"
mkdir -p "$BACKUP_DIR/uploads"

# ── PostgreSQL dump ──
DUMP_FILE="$BACKUP_DIR/pg/jobhunter_${TIMESTAMP}.sql.gz"
echo "$LOG_PREFIX Dumping PostgreSQL to $DUMP_FILE"

PGPASSWORD="${POSTGRES_PASSWORD:-jobhunter}" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-privileges \
  | gzip > "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "$LOG_PREFIX Dump complete: $DUMP_SIZE"

# ── Uploads backup ──
if [ -d "$CV_DIR" ]; then
  UPLOAD_FILE="$BACKUP_DIR/uploads/cv_${TIMESTAMP}.tar.gz"
  echo "$LOG_PREFIX Backing up CV uploads to $UPLOAD_FILE"
  tar -czf "$UPLOAD_FILE" -C "$(dirname "$CV_DIR")" "$(basename "$CV_DIR")" 2>/dev/null || echo "$LOG_PREFIX Warning: no CV files to back up"
  UPLOAD_SIZE=$(du -h "$UPLOAD_FILE" | cut -f1)
  echo "$LOG_PREFIX Uploads backup complete: $UPLOAD_SIZE"
else
  echo "$LOG_PREFIX Warning: CV upload directory not found at $CV_DIR"
fi

# ── Rotate old backups (keep last 7 days) ──
echo "$LOG_PREFIX Rotating backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR/pg" -name "jobhunter_*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | \
  while read f; do echo "$LOG_PREFIX Rotated: $f"; done
find "$BACKUP_DIR/uploads" -name "cv_*.tar.gz" -mtime +$RETENTION_DAYS -delete -print | \
  while read f; do echo "$LOG_PREFIX Rotated: $f"; done

# ── Summary ──
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
BACKUP_COUNT=$(find "$BACKUP_DIR/pg" -name "jobhunter_*.sql.gz" | wc -l)
echo "$LOG_PREFIX Backup complete. Total: $TOTAL_SIZE ($BACKUP_COUNT database dumps retained)"
echo "$LOG_PREFIX Finished at $(date)"
