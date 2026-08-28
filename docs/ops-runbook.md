# JobHunter Operations Runbook

## Table of Contents
1. [System Architecture](#1-system-architecture)
2. [Environment Variables](#2-environment-variables)
3. [Deployment](#3-deployment)
4. [Backup & Restore](#4-backup--restore)
5. [15-Minute Smoke Test](#5-15-minute-smoke-test)
6. [Monitoring & Alerts](#6-monitoring--alerts)
7. [Troubleshooting](#7-troubleshooting)
8. [Scaling](#8-scaling)

---

## 1. System Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Backend    │────▶│  PostgreSQL  │
│  Next.js     │     │  NestJS      │     │  Database    │
│  :3211       │     │  :3210       │     │  :5432       │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                     ┌──────┴──────┐
                     │  Telegram   │
                     │  Bot API    │
                     └─────────────┘
```

**Services:**
- **Frontend** (Next.js): React SSR/CSR, port 3211
- **Backend** (NestJS): REST API + background crons, port 3210
- **PostgreSQL**: Data store, port 5432
- **Telegram Bot** (optional): Alert delivery via Bot API

**Key Ports:**
| Service | Port | Protocol |
|---------|------|----------|
| Backend API | 3210 | HTTP |
| Frontend | 3211 | HTTP |
| PostgreSQL | 5432 | TCP |

---

## 2. Environment Variables

See `backend/.env.example` for the full list. Critical ones:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | JWT signing secret (48+ bytes) |
| `TELEGRAM_BOT_TOKEN` | ⚠️ | From @BotFather (needed for alerts) |
| `MATCH_THRESHOLD` | ❌ | Default 65 (FR-019) |
| `ADMIN_EMAILS` | ❌ | Comma-separated admin emails |

---

## 3. Deployment

### First Deploy

```bash
# 1. Clone and install
git clone <repo-url>
cd jobhunterethiopia
cd backend && npm install
cd ../frontend && npm install

# 2. Set up database
cd ../backend
cp .env.example .env  # Edit with real values
npx prisma migrate deploy
npx prisma db seed     # Only if SEED_DEMO_DATA=true

# 3. Build and start
npx nest build
node dist/main.js &

# 4. Frontend
cd ../frontend
npm run build
npm start &
```

### Subsequent Deploys

```bash
cd backend
git pull
npm install
npx prisma migrate deploy   # Apply any new migrations
npx nest build
# Restart backend process
kill $(lsof -t -i:3210)
node dist/main.js &
```

### Zero-Downtime Deploy (Production)

Use PM2 or systemd for process management:

```bash
# PM2
pm2 start dist/main.js --name jobhunter-api
pm2 restart jobhunter-api

# systemd (see backend/jobhunter.service)
sudo systemctl restart jobhunter
```

---

## 4. Backup & Restore

### Automated Backup

The nightly backup runs via lifecycle cron (`BACKUP_INTERVAL=24h`).

Manual run:
```bash
cd backend
bash scripts/backup.sh
```

Backups are stored in `./backups/` with 7-day rotation:
- `backups/pg/jobhunter_YYYYMMDD_HHMMSS.sql.gz` — PostgreSQL dump
- `backups/uploads/cv_YYYYMMDD_HHMMSS.tar.gz` — CV files

### Restore Drill (Quarterly)

**Estimated time: 15 minutes**

```bash
# 1. List available backups
ls -la backups/pg/

# 2. Pick the latest backup
LATEST=$(ls -t backups/pg/jobhunter_*.sql.gz | head -1)
echo "Restoring from: $LATEST"

# 3. Stop the backend
kill $(lsof -t -i:3210) 2>/dev/null

# 4. Drop and recreate the database
PGPASSWORD=postgres psql -h localhost -U postgres -c "DROP DATABASE jobhunter;"
PGPASSWORD=postgres psql -h localhost -U postgres -c "CREATE DATABASE jobhunter OWNER jobhunter;"

# 5. Restore from backup
gunzip -c "$LATEST" | PGPASSWORD=jobhunter psql -h localhost -U jobhunter -d jobhunter

# 6. Verify row counts
PGPASSWORD=jobhunter psql -h localhost -U jobhunter -d jobhunter -c "
  SELECT 'users' as t, count(*) FROM \"User\"
  UNION ALL SELECT 'jobs', count(*) FROM \"Job\"
  UNION ALL SELECT 'matches', count(*) FROM \"JobMatch\"
  UNION ALL SELECT 'applications', count(*) FROM \"Application\"
  UNION ALL SELECT 'notifications', count(*) FROM \"Notification\"
  UNION ALL SELECT 'source_runs', count(*) FROM \"SourceRun\"
  ORDER BY t;
"

# 7. Restore CV uploads
LATEST_CV=$(ls -t backups/uploads/cv_*.tar.gz 2>/dev/null | head -1)
if [ -n "$LATEST_CV" ]; then
  tar -xzf "$LATEST_CV" -C ./uploads/
  echo "CV uploads restored"
fi

# 8. Restart backend
node dist/main.js &

# 9. Run smoke test
bash scripts/smoke-test.sh
```

### Verify Backup Integrity

```bash
# Check backup file is valid gzip
file backups/pg/jobhunter_*.sql.gz

# Check it contains expected tables
gunzip -c backups/pg/jobhunter_*.sql.gz | grep "CREATE TABLE" | wc -l
# Should show ~21 tables
```

---

## 5. 15-Minute Smoke Test

Run after every deployment or restart:

```bash
cd backend
bash scripts/smoke-test.sh
```

**What it checks:**
1. ✅ Backend and frontend are reachable
2. ✅ Login returns a valid JWT
3. ✅ Authenticated endpoints return 200
4. ✅ Unauthorized requests return 401
5. ✅ Security headers present (Helmet)
6. ✅ All core API endpoints respond (dashboard, profile, matches, saved, applications, searches)
7. ✅ Database has data (jobs, matches)
8. ✅ Rate limiting active
9. ✅ Frontend renders HTML

**Expected output:** All checks pass, exit code 0.

---

## 6. Monitoring & Alerts

### Health Checks

| Check | Method | Frequency |
|-------|--------|-----------|
| Backend alive | `GET :3210/` → 404 | Every 30s |
| Frontend alive | `GET :3211/` → 200 | Every 30s |
| Database connected | Prisma `SELECT 1` | Every 60s |
| Collection running | `SourceRun` timestamps | Every 30m |
| Link health | `Job.urlStatus` checks | Daily |

### Key Metrics to Watch

| Metric | Healthy | Alert Threshold |
|--------|---------|-----------------|
| Jobs collected | > 100 | < 50 (source failure) |
| Match score accuracy | 50-80% | > 90% (possible duplicate data) |
| API response time | < 500ms p95 | > 1s |
| Failed logins | < 10/min | > 50/min (brute force) |
| Telegram delivery | > 95% | < 80% (bot issues) |
| Collection cycle time | < 5m | > 15m (source timeout) |

### Log Files

| Log | Location | Contents |
|-----|----------|----------|
| Backend stdout | `.dev-logs-backend.log` | Startup, requests, errors |
| Frontend stdout | `.dev-logs/frontend.log` | Next.js build, requests |
| PostgreSQL | `pg.log` | DB connections, queries |
| System logs | Prisma `SystemLog` table | Application-level events |

---

## 7. Troubleshooting

### Backend won't start

```
Error: listen EADDRINUSE: address already in use :::3210
```
**Fix:** Kill the existing process: `kill $(lsof -t -i:3210)`

### Database connection refused

```
Error: Can't reach database server at localhost:5432
```
**Fix:**
```bash
# Check if PostgreSQL is running
pg_isready -p 5432

# Start PostgreSQL (Windows)
"C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe" -D "C:/Program Files/PostgreSQL/18/data" start

# Start PostgreSQL (Linux)
sudo systemctl start postgresql
```

### Telegram bot not sending alerts

1. Check `TELEGRAM_BOT_TOKEN` is set in `.env`
2. Check bot is not blocked by users
3. Check rate limits: `TELEGRAM_GLOBAL_RATE_PER_SEC=25`
4. Check for `UNREACHABLE` status in TelegramLink table

### Collection not running

1. Check `JOB_COLLECTION_INTERVAL` in `.env` (default: `30m`)
2. Check last SourceRun timestamp: `SELECT * FROM "SourceRun" ORDER BY "startedAt" DESC LIMIT 5`
3. Check adapter errors in backend logs
4. Run manually: `POST /sources/:id/collect` with auth token

### High memory usage

1. Check for memory leaks in rate limiter buckets (>10k entries auto-prunes)
2. Restart backend: `pm2 restart jobhunter-api`
3. Check for stuck collection cycles

### 500 errors on dashboard

1. Check PostgreSQL is running
2. Check backend logs for Prisma connection errors
3. The system degrades gracefully — returns empty data instead of crashing

---

## 8. Scaling

### Single Instance → Multi Instance

The current rate limiter is in-memory (SEC-005). For multi-instance:
1. Switch to Redis-backed rate limiter (Phase 2: BullMQ)
2. Share `REDIS_URL` across instances
3. Use sticky sessions for WebSocket (if added)

### Database Scaling

1. **Read replicas:** Add `DATABASE_URL_REPLICA` for read-heavy queries
2. **Connection pooling:** Use PgBouncer for >50 concurrent connections
3. **Partitioning:** Partition `Job` table by `postedDate` for >100k jobs

### Vertical Scaling

| Component | Minimum | Recommended | Production |
|-----------|---------|-------------|------------|
| Backend | 1 vCPU, 512MB | 2 vCPU, 1GB | 4 vCPU, 2GB |
| Frontend | 1 vCPU, 256MB | 1 vCPU, 512MB | 2 vCPU, 1GB |
| PostgreSQL | 1 vCPU, 1GB | 2 vCPU, 2GB | 4 vCPU, 4GB |

---

## Emergency Procedures

### Immediate Backend Restart
```bash
kill $(lsof -t -i:3210); sleep 2; cd backend && node dist/main.js &
```

### Force Collection Run
```bash
TOKEN=$(curl -s -X POST http://localhost:3210/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"amara@jobhunter.et","password":"demo1234"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

curl -s -X POST http://localhost:3210/sources/SOURCE_ID/collect \
  -H "Authorization: Bearer $TOKEN"
```

### Emergency Database Restore
```bash
# Follow the restore drill in Section 4
# Focus on steps 4-8 (drop, restore, verify, restart)
```

---

*Last updated: August 2026*
*SRS v2.3 compliant*
