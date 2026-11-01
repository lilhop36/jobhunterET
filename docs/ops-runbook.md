# JobHunter Operations Runbook

> SQLite-first production topology | Updated October 2026

## Table of Contents
1. [System Architecture](#1-system-architecture)
2. [Environment Variables](#2-environment-variables)
3. [Deployment](#3-deployment)
4. [Backup & Restore](#4-backup--restore)
5. [Smoke Test](#5-smoke-test)
6. [Monitoring & Alerts](#6-monitoring--alerts)
7. [Troubleshooting](#7-troubleshooting)
8. [Scaling](#8-scaling)

---

## 1. System Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│   Frontend   │────▶│   Backend    │────▶│   SQLite file        │
│  Next.js     │     │  NestJS      │     │  /app/data/prod.db   │
│  :3211       │     │  :3210       │     │  (persistent volume) │
└──────────────┘     └──────┬───────┘     └──────────────────────┘
                            │
                     ┌──────┴──────┐
                     │  Telegram   │
                     │  Bot API    │
                     └─────────────┘
```

**Services:**
- **Frontend** (Next.js): React SSR/CSR, port 3211
- **Backend** (NestJS): REST API + background crons, port 3210
- **SQLite**: single database file on a persistent volume; no database server or port
- **Telegram Bot** (optional): alert delivery via Bot API

**Key ports:**
| Service | Port | Protocol |
|---------|------|----------|
| Backend API | 3210 | HTTP |
| Frontend | 3211 | HTTP |

PostgreSQL is not part of the current production topology. The repo keeps a parallel `schema.postgresql.prisma` for a future multi-instance deployment; see [Scaling](#8-scaling).

---

## 2. Environment Variables

See `backend/.env.example` for the full list. Critical ones:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | SQLite file. Dev: `file:./dev.db`; Docker: `file:/app/data/prod.db` |
| `JWT_SECRET` | Recommended | 32+ character signing secret. If unset or too short, the backend generates a random secret at boot; sessions then do not survive restarts. Set it in production. |
| `CORS_ORIGIN` | ✅ in production | Comma-separated allowed origins; the backend refuses permissive CORS in production |
| `TELEGRAM_BOT_TOKEN` | ⚠️ | From @BotFather (needed for alerts) |
| `MATCH_THRESHOLD` | ❌ | Default 65 (FR-019) |
| `ADMIN_EMAILS` | ❌ | Comma-separated admin emails |
| `MATCH_CYCLE_INTERVAL` | ❌ | Match cycle; code default 10m (sample `.env` uses 35m) |
| `JOB_COLLECTION_INTERVAL` | ❌ | FAST collection tick; default 30m |
| `DEEP_COLLECTION_INTERVAL` | ❌ | DEEP collection tick; default 60m |
| `PRE_MIGRATION_BACKUP_DIR` | ❌ | Override the pre-migration backup directory. Default: `backups/pre-migration` beside the app, or `<db dir>/backups/pre-migration` when the database is outside the backend tree (Docker: `/app/data/backups/pre-migration`) |
| `SKIP_DB_MIGRATIONS` | ❌ | `1` skips the entrypoint migration. Emergency use only, after handling the database manually |

---

## 3. Deployment

### Recommended: Docker Compose

```bash
# 1. Configure
cp .env.example .env
# Set JWT_SECRET, CORS_ORIGIN, and optionally TELEGRAM_BOT_TOKEN.
# DATABASE_URL is set by docker-compose.yml to file:/app/data/prod.db.

# 2. Build and start
docker compose up -d --build

# 3. Check health
curl -fsS http://localhost:3210/api/health
```

The container entrypoint runs `node scripts/db-migrate-safe.js` before starting the app. That script:

1. Takes a consistent snapshot (`VACUUM INTO`) and verifies the gzipped backup. In Docker the backup is written to `/app/data/backups/pre-migration/`, on the persistent volume.
2. Does nothing when the schema matches `schema.prisma` and every migration is already recorded.
3. Auto-baselines only when the database matches `schema.prisma` but has no migration history at all. If history exists but is incomplete, it refuses unless you pass `--baseline`.
4. For pending migrations, applies them to the verified copy first and requires the copy to match the target schema with unchanged row counts before touching the live database.
5. Refuses on drift, failed migrations, removed tables, or row-count changes. It never passes `--accept-data-loss` and never runs `migrate reset`.

Set `SKIP_DB_MIGRATIONS=1` only for an emergency start where you have already handled the database manually.

**Native dependency:** passwords are hashed with `bcrypt` (SEC-005, cost `PASSWORD_COST = 11` in
`backend/src/common/security/password-policy.ts`), which is a compiled binding rather than pure
JavaScript — that is what keeps a login near 0.2–0.3 s and off the request thread. `npm ci` downloads
a prebuilt binary for the platform; when none matches it compiles from
source, which needs `gcc`, `make` and `python3`. The `node:22` base image the Dockerfile uses has
them; a `-slim` variant would not. Hashes are portable across the two implementations, so the
`$2a$` values written by the previous pure-JS library still verify and new accounts are stored as
`$2b$`. The cost lives inside each hash, so accounts created under an earlier cost keep verifying at
that cost until they sign in again: `AuthService.login()` re-hashes at the current policy cost as part
of the `lastActiveAt` write login already performs. That makes changing the cost a rolling migration
with no script to run, and it means the first login after a cost change is slower than the ones after
it. The Windows x64 install (Node 24) was exercised locally; CI's `npm ci` on `ubuntu-latest` is
what will prove the Linux path, and the Docker image build has not been re-run here — confirm both on
the first deploy.

### Manual deploy (no Docker)

```bash
cd backend
cp .env.example .env          # set DATABASE_URL, JWT_SECRET, CORS_ORIGIN
npm ci
npx prisma generate
node scripts/db-migrate-safe.js
npm run build
node dist/main.js
```

Frontend:

```bash
cd frontend
npm ci
npm run build
npm start
```

### One-time migration baseline (database created with `db push`)

Run this **once** for the existing production database before deploying the guarded entrypoint. A database created by `prisma db push` has no `_prisma_migrations` history, or has only the original `init` entry.

1. **Stop the backend** so no writes occur.
2. **Back up the database** (see [Backup & Restore](#4-backup--restore)). The script also takes its own verified backup before writing.
3. **Verify the live schema matches the target**:

   ```bash
   cd backend
   npx prisma migrate diff \
     --from-url "$DATABASE_URL" \
     --to-schema-datamodel prisma/schema.prisma \
     --exit-code
   ```

   Exit code `0` means no difference. Any other result means the live schema has drifted; inspect the SQL diff and reconcile it before proceeding. Do not force a baseline.

4. **Clear an interrupted migration row, if the script reports one.** A database left over from `prisma migrate dev` can hold a `_prisma_migrations` row that never finished. The script distinguishes the two kinds:

   ```text
   Unfinished migration(s) recorded: 20261027_sync_current_schema. They started but were
   neither finished nor rolled back, so the schema may be partway changed.
   ```

   That refusal is intentional: the script will not guess about a possibly half-applied
   migration. Confirm step 3 showed **no** schema difference (so nothing was left partway),
   then mark the row as rolled back — history only, no data or schema change:

   ```bash
   npx prisma migrate resolve --rolled-back <migration_name>
   ```

   A row already recorded as rolled back is handled automatically: the script reports it,
   counts it as not applied, and `--baseline` re-records it.

5. **Rehearse on a copy** (no writes to the copy in dry-run mode):

   ```bash
   cp "$DB_PATH" /tmp/jobhunter-baseline-copy.db
   DATABASE_URL="file:/tmp/jobhunter-baseline-copy.db" \
     node scripts/db-migrate-safe.js --baseline --dry-run
   ```

   Compare row counts on the copy before and after (`SELECT COUNT(*)` per table); they must
   be identical.

6. **Baseline the real database**:

   ```bash
   DATABASE_URL="file:/app/data/prod.db" node scripts/db-migrate-safe.js --baseline
   ```

   It verifies the schema first, writes a backup, records the pending migration(s) as applied, and confirms the schema is unchanged. Existing rows are not touched.

7. Confirm the app starts and the smoke test passes:

   ```bash
   npx prisma migrate status   # → "Database schema is up to date!"
   ```

The script never runs `migrate reset`, `db push --force-reset`, or `--accept-data-loss`.

### Subsequent deploys

```bash
cd backend
git pull
npm ci
node scripts/db-migrate-safe.js   # backs up, then applies pending migrations
npm run build
# restart the backend process or container
```

---

## 4. Backup & Restore

### Automated backup

The nightly lifecycle cron calls `backend/scripts/backup.sh` (`BACKUP_INTERVAL=24h`). The script detects SQLite from `DATABASE_URL`.

Manual run:

```bash
cd backend
bash scripts/backup.sh
```

SQLite output:

- `backups/sqlite/jobhunter_<ISO timestamp>.db.gz` — consistent `VACUUM INTO` snapshot, gzip- and header-verified
- `backups/uploads/cv_<timestamp>.tar.gz` — CV files
- 7-day rotation for nightly backups

Pre-migration backups are separate and are not rotated automatically:

- Dev: `backend/backups/pre-migration/jobhunter_<ISO timestamp>.db.gz`
- Docker: `/app/data/backups/pre-migration/jobhunter_<ISO timestamp>.db.gz`

The backup helper uses Prisma's SQLite engine to run `VACUUM INTO`, so it does not require the `sqlite3` CLI and can run while the app is live. The entrypoint backup runs before the app starts.

### Restore drill (quarterly)

**Estimated time: 10 minutes**

```bash
# 1. List available backups
ls -la backups/sqlite/

# 2. Pick the latest backup
LATEST=$(ls -t backups/sqlite/jobhunter_*.db.gz | head -1)
echo "Restoring from: $LATEST"

# 3. Stop the backend / container
docker compose stop app

# 4. Restore the database file
gunzip -c "$LATEST" > /app/data/prod.db.restore
mv /app/data/prod.db.restore /app/data/prod.db
chown node:node /app/data/prod.db   # Docker runs as the node user

# 5. Restore CV uploads
LATEST_CV=$(ls -t backups/uploads/cv_*.tar.gz 2>/dev/null | head -1)
if [ -n "$LATEST_CV" ]; then
  tar -xzf "$LATEST_CV" -C /app/data/uploads/
fi

# 6. Start and verify
docker compose start app
curl -fsS http://localhost:3210/api/health
```

Verify row counts after restore:

```bash
cd backend
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  for (const m of ['user','job','jobMatch','application','notification','sourceRun']) {
    console.log(m, await p[m].count());
  }
  await p.\$disconnect();
})();
"
```

### Verify backup integrity

```bash
# gzip integrity
gzip -t backups/sqlite/jobhunter_*.db.gz

# SQLite header (should print: SQLite format 3)
gunzip -c backups/sqlite/jobhunter_*.db.gz | head -c 16
```

### Optional PostgreSQL

If you move to PostgreSQL later, use `pg_dump`/`pg_restore` and a PostgreSQL service. That topology requires its own migrations generated from `schema.postgresql.prisma`; do not mix SQLite and PostgreSQL migration histories.

### Historical duplicate cleanup

Ingestion suppresses new same-source duplicates (a `(sourceId, fingerprint)` match refreshes the existing row), but rows created before that guard may still exist. Inventory them first — the report is read-only:

```bash
cd backend
npm run duplicates:report              # top 10 groups
npm run duplicates:report -- --all     # every group
npm run duplicates:report -- --json    # machine-readable
```

`--apply` merges every safe group. It takes a verified gzip backup through
`db-migrate-safe.js`, moves `JobMatch`, `Application`, `Notification`, and
`JobSkill` references to one survivor per group, deletes the extra `Job` rows in
a single transaction, and then runs `PRAGMA integrity_check` and
`PRAGMA foreign_key_check`. A group is skipped when the same user has an
application on more than one copy; resolve those manually.

```bash
npm run duplicates:report -- --apply
```

Rehearse on a copy first and keep the printed backup path:

```bash
cp prisma/dev.db /tmp/jobhunter-copy.db
DATABASE_URL="file:/tmp/jobhunter-copy.db" npm run duplicates:report -- --apply
```

The script writes nothing unless `--apply` is present.

---

## 5. Smoke Test

Run after every deployment or restart:

```bash
cd backend
bash scripts/smoke-test.sh
```

Credentials are tried in order — `amara@jobhunter.et` / `demo1234` (the demo admin from
`prisma/seed.ts`), then `admin@jobhunter.et` / `password123` (the local dev account) — and the
output names the account that authenticated. On a database with neither (for example a restored
production copy) pin one explicitly:

```bash
SMOKE_EMAIL="you@example.com" SMOKE_PASSWORD="…" bash scripts/smoke-test.sh
```

**What it checks (23 assertions):**
1. `GET /api/health` returns 200 with `{"status":"ok"}` and the frontend `/login` renders
2. Login issues a JWT; an authenticated request returns 200
3. Anonymous `/api/dashboard` and `/api/matches` return 401
4. Helmet headers present (`x-content-type-options`, `x-frame-options`, CSP)
5. Core endpoints respond: dashboard, profile, matches, saved-jobs, applications, searches,
   inbox, digest, plus the `/api/sources` role guard (200 or 403)
6. Data sanity: dashboard reports `new24h` and a saved count; the match list contains no
   repeated `jobId`
7. Invalid credentials are rejected (401/429) using a throwaway email, so the throttle in
   FR-002g cannot lock the smoke account
8. Frontend serves Next.js HTML

Every backend URL carries the `/api` prefix from `main.ts` → `app.setGlobalPrefix('api')`.
Before this was fixed the script probed the bare port paths, so each request answered 404, the
token came back empty, and `set -euo pipefail` aborted the run at step 2 after reporting the
backend "reachable" on the strength of that 404 — a green-looking script that tested nothing.

### Browser check

The smoke test proves the API answers. To prove the UI actually renders and that a
user's match list contains no repeated postings, run the Playwright suite against the
live stack (it does not start servers):

```bash
bash dev.sh &            # wait until :3210/api/health answers 200
cd frontend
npx playwright install chromium   # once, on a new machine
npx playwright test e2e/runtime-verification.spec.ts e2e/onboarding.spec.ts --project=desktop
```

It signs in through the login form, then asserts: health 200, anonymous `/api/matches`
401, unique `jobId`s in the API response, and unique rows in the rendered matches list;
the onboarding spec then registers a throwaway account, drives the three wizard steps,
verifies the profile it wrote, and deletes that account through the API in a `finally`
block. Screenshots land in `frontend/e2e-artifacts/`. Credentials default to the account
the demo seed creates (`amara@jobhunter.et` / `demo1234`); override with `QA_EMAIL` and
`QA_PASSWORD` for another database, and `BACKEND_URL` if the API is not on `:3210`.

`dev.sh` starts the backend with production throttle defaults (`AUTH_RATE_MAX=10` per IP,
`AUTH_EMAIL_RATE_MAX=5` per email, both per 15 minutes), while every test signs in from a
fresh browser context. A single run fits under the limit; two runs back to back do not, and
the second one ends with the sign-in tests stuck on `/login`. The spec detects the banner and
says so instead of reporting a bare timeout. To run the suite repeatedly without waiting out
the window, restart the backend with the limits CI uses:

```bash
AUTH_RATE_MAX=500 AUTH_EMAIL_RATE_MAX=500   # whatever starts the backend for you, exports these
```

CI runs the same specs as **Gate 6** against a production build and a disposable database,
which is the recipe to use before a release if you want to rehearse exactly what CI will do:

```bash
cd backend
DATABASE_URL="file:./ci-rehearse.db" node scripts/provision-test-db.js   # reset + demo seed
JWT_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')" \
  AUTH_RATE_MAX=500 AUTH_EMAIL_RATE_MAX=500 \
  DATABASE_URL="file:./ci-rehearse.db" node dist/main.js &
cd ../frontend && npm run build && PORT=3211 npm run start &
```

`provision-test-db.js` refuses any `DATABASE_URL` that is not a SQLite `file:` URL, so it
cannot be pointed at production by accident, and the raised `AUTH_RATE_MAX` keeps the
fixed-window login throttle from failing a parallel suite. `npm run live:verify` runs the
documented smoke test and `nfr:check` against whatever stack is currently listening.

`nfr:check` is the harness that proves `NFR-001`, and it makes roughly twenty-five auth calls — the
security panel alone fires fifteen in a row to prove the throttle works — far more than the
production per-email budget (5 per 15 minutes) allows, so point it at a backend started with
`AUTH_RATE_MAX=500 AUTH_EMAIL_RATE_MAX=500`, or the final `Rate limiting on login` check passes and
every earlier login sample reports a 429 instead of a latency number. Its default credentials are the
ones the demo seed creates, and a long-used `dev.db` has no such account, so against the development
database pass `QA_ADMIN_EMAIL` / `QA_ADMIN_PASSWORD` for an account that exists there. It also
recalculates matches, so aim it at a copy of the database rather than
the live file: `VACUUM INTO 'probe.db'` gives one in a single statement. Expected output on the
current stack, on the second run so the measurements are warm, is `23 passed, 0 failed, 4 warnings`
with `Login (slowest of 3)` around 0.3 s — inside NFR-001's 500 ms. The four warnings are the known
ones: no applications to exercise stage transitions, 421 matches pointing at non-ACTIVE jobs, 26
case-duplicate skill groups, and the throttle not tripping at the raised limits the suite itself needs.
A first run after boot can also warn on `Dashboard while 5 logins run`; that sample is the worst of 20
reads taken while auth work runs, so it is the one that shows cold-start noise.

`dev.sh` gives each service a 120-second boot grace before the watchdog acts, because
`nest start --watch` and the first compile of a Next route routinely take longer than a
health-probe timeout. If a service is genuinely down it is restarted up to five times
with a 30-second cooldown; the launcher log says which attempt failed.

**Expected output:** all checks pass, exit code 0.

---

## 6. Monitoring & Alerts

### Health checks

| Check | Method | Frequency |
|-------|--------|-----------|
| Backend alive | `GET :3210/api/health` → 200 | Every 30s |
| Frontend alive | `GET :3211/` → 200 | Every 30s |
| Database writable | SQLite file exists and is writable; `SELECT 1` via Prisma | Every 60s |
| Collection running | `SourceRun` timestamps | Every 30m |
| Link health | `Job.urlStatus` checks | Daily |
| Disk space | Volume holding `prod.db` | Every 5m |

### Key metrics to watch

| Metric | Healthy | Alert threshold |
|--------|---------|-----------------|
| Jobs collected | > 100 | < 50 (source failure) |
| Match score accuracy | 50-80% | > 90% (possible duplicate data) |
| API response time | < 500ms p95 | > 1s |
| Failed logins | < 10/min | > 50/min (brute force) |
| Telegram delivery | > 95% | < 80% (bot issues) |
| Collection cycle time | < 5m | > 15m (source timeout) |
| Database file size | stable growth | sudden drop (corruption/restore) |

### Log files

| Log | Location | Contents |
|-----|----------|----------|
| Backend stdout | `.dev-logs-backend.log` / container logs | Startup, requests, errors |
| Frontend stdout | `.dev-logs/frontend.log` / container logs | Next.js build, requests |
| Backup log | `backups/` | Backup and rotation output |
| System logs | Prisma `SystemLog` table | Application-level events |

---

## 7. Troubleshooting

### Backend won't start

```
Error: listen EADDRINUSE: address already in use :::3210
```
**Fix:** kill the existing process: `kill $(lsof -t -i:3210)` or restart the container.

### Database is locked

```
Error: database is locked
```
**Fix:**
- Ensure only one backend process uses the SQLite file.
- Stop the app and check for a leftover `prod.db-wal` / `prod.db-shm` file.
- Confirm the volume has free space and the file is writable by the runtime user (`node` in Docker).

### Migration baseline refused

```
The schema already matches schema.prisma, but N migration(s) are not recorded: ...
```

**Fix:** this is the expected first-run state for a database created with `db push`. Review the migration list, then re-run with `--baseline` (see [One-time migration baseline](#one-time-migration-baseline-database-created-with-db-push)). No schema changes are made.

```
Unfinished migration(s) recorded: <name>. They started but were neither finished nor rolled back, so the schema may be partway changed.
```

**Fix:** verify the schema is complete (`prisma migrate diff … --exit-code` returns `0`), then clear the interrupted bookkeeping row with `npx prisma migrate resolve --rolled-back <name>` and re-run the baseline. If the diff is **not** clean, treat it as drift: restore from the verified backup instead of resolving, because the migration really may be half-applied.

```
Error: P3018
Alter table: Failed to run the query: 'ALTER TABLE "JobSource" ADD COLUMN "categories" text'
duplicate column name: categories
```

**Fix:** `migrate deploy` is replaying SQL the database already has — the usual result of a `db push` database with a partial history. Stop, run the baseline procedure above; do not edit the migration file.

```
--baseline refused: the database schema does not match schema.prisma.
```

**Fix:** do not force it. Back up the database, inspect the SQL diff with `prisma migrate diff`, and reconcile the schema manually or generate a new migration. The script will not accept data loss.

```
After migrating the copy, its schema still differs from schema.prisma. This is drift, not a pending migration.
```

**Fix:** the copy failed verification, so the live database was not touched. Compare the drift SQL, fix the migration or the database, and rerun. Restore from the verified backup only if the live database was already modified outside this script.

### Database file missing

**Fix:** if the data is not needed, `node scripts/db-migrate-safe.js` creates and migrates a fresh file. If it is needed, restore from `backups/sqlite/` before starting the app.

### Telegram bot not sending alerts

1. Check `TELEGRAM_BOT_TOKEN` is set in `.env`
2. Check the bot is not blocked by users
3. Check rate limits: `TELEGRAM_GLOBAL_RATE_PER_SEC=25`
4. Check for `UNREACHABLE` status in the `TelegramLink` table

### Collection not running

1. Check `JOB_COLLECTION_INTERVAL` in `.env` (default: `30m`)
2. Check the last `SourceRun` timestamp: `SELECT * FROM "SourceRun" ORDER BY "startedAt" DESC LIMIT 5`
3. Check adapter errors in backend logs
4. Run manually: `POST /api/sources/:id/collect` with an admin token

### High memory usage

1. Check for memory leaks in rate-limiter buckets (>10k entries auto-prune)
2. Restart the backend
3. Check for stuck collection cycles

### 500 errors on dashboard

1. Check backend logs for Prisma errors
2. Confirm the SQLite file is readable and not locked
3. The system degrades gracefully — returns empty data instead of crashing

---

## 8. Scaling

### Single instance (current)

SQLite allows one writer at a time. Run exactly one backend process against `/app/data/prod.db`. This is sufficient for the current single-node deployment.

### From one instance to many

1. Migrate to PostgreSQL using `schema.postgresql.prisma` and PostgreSQL-specific migrations.
2. Move the rate limiter to Redis.
3. Use sticky sessions if WebSocket support is added.
4. Point all instances at the same PostgreSQL database.

### Database scaling (PostgreSQL only)

1. **Read replicas:** add `DATABASE_URL_REPLICA` for read-heavy queries.
2. **Connection pooling:** use PgBouncer for >50 concurrent connections.
3. **Partitioning:** partition `Job` by `postedDate` for >100k jobs.

### Vertical scaling

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Backend | 1 vCPU, 512MB | 2 vCPU, 1GB |
| Frontend | 1 vCPU, 256MB | 1 vCPU, 512MB |
| Disk (SQLite + uploads) | 2GB | 10GB+ |

---

## Emergency Procedures

### Immediate backend restart
```bash
docker compose restart app
# or: kill $(lsof -t -i:3210); sleep 2; cd backend && node dist/main.js &
```

### Force collection run
Log in as an admin account on that environment (the seeded demo admin exists
only where `prisma/seed.ts` has run):

```bash
ADMIN_EMAIL="admin@your-domain"          # your admin account
read -rsp "Password: " ADMIN_PASSWORD; echo
TOKEN=$(curl -s -X POST http://localhost:3210/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

curl -s -X POST http://localhost:3210/api/sources/SOURCE_ID/collect \
  -H "Authorization: Bearer $TOKEN"
```

### Emergency database restore
Follow the restore drill in Section 4. Stop the app, replace the SQLite file, fix ownership, start, and run the smoke test.

---

*Last updated: October 2026*
