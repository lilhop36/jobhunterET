# System Architecture — Overview

> SRS v2.3 | Updated August 2026

## What Is JobHunter?

JobHunter is an automated job-matching agent for the Ethiopian tech market. It collects jobs from 15+ sources, matches them against user profiles using a knowledge-graph-powered scoring engine, and delivers personalized alerts via Telegram or a web inbox.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                       │
│                        Port 3211                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ Auth     │ │Dashboard │ │  Jobs    │ │  Matches/Inbox   │   │
│  │ Pages    │ │ SSE Live │ │  Search  │ │  Applications    │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST API + SSE
┌──────────────────────────▼──────────────────────────────────────┐
│                        Backend (NestJS)                         │
│                        Port 3210                                │
│                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  Auth   │  │ Profile │  │ Matching │  │    Sources       │ │
│  │  JWT    │  │  CV     │  │  Engine  │  │  15 Adapters     │ │
│  └─────────┘  └─────────┘  └──────────┘  └──────────────────┘ │
│                                                                 │
│  ┌─────────────┐ ┌────────────┐ ┌───────────┐ ┌────────────┐  │
│  │ Notifications│ │Lifecycle   │ │Applications│ │  Admin     │  │
│  │ Telegram    │ │ Crons      │ │ Tracking  │ │  Dashboard │  │
│  │ Web Inbox   │ │ Sweeps     │ │ Stages    │ │  User Mgmt │  │
│  └─────────────┘ └────────────┘ └───────────┘ └────────────┘  │
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  Digest  │ │  Events  │ │  Salary  │ │  Saved/Searches  │  │
│  │  Daily   │ │  SSE     │ │  Bench   │ │  User Lists      │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                     SQLite / PostgreSQL                         │
│                     16 Prisma Models                            │
│  User · Job · JobMatch · Skill · CandidateProfile · TargetRole │
│  LocationPreference · Application · SavedJob · Notification    │
│  SourceRun · SearchProfile · SystemLog · TelegramLink · etc.   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Pipeline

The system operates as a continuous pipeline:

```
 Collection → Normalization → Validation → Dedup → Matching → Notification
     │              │              │          │         │            │
  15 sources    Fidelity      Schema     Fingerprint  Score     Telegram /
  (adapters)    Pipeline      Check      + Ghost     0-100     Web Inbox
               + Skills                    Detection  + Alert
```

### Stage 1: Collection

15 source adapters fetch job listings on a configurable interval (default: 30 minutes). Each adapter implements `JobSourceAdapter` and returns normalized `RawJob` objects.

**Adapters:** EthioJobs, RemoteOK, RelieWeb, HaHuJobs, EthioNgoJobs, GeezJob, HagerJobs, Jobicy, Remotive, Himalayas, WorkingNomads, JobsFitty, LinkedIn, FindWork, WeWorkRemotely.

Collection runs through a **concurrency-limited queue** with health scoring per source. Sources that fail 3+ consecutive cycles are auto-disabled.

### Stage 2: Fidelity Pipeline

Raw jobs pass through the fidelity pipeline (`job-fidelity.spec.ts` tested):

1. **HTML cleaning** — entity decoding, mojibake fix, boilerplate stripping
2. **Quality scoring** — description completeness (0-100)
3. **URL normalization** — trailing slash removal, UTM stripping, fragment removal
4. **Apply-method extraction** — EMAIL, IN_PERSON, ONLINE_URL detection
5. **Normalization** — salary parsing, company name extraction, deadline extraction, fingerprinting

### Stage 3: Deduplication

Two layers:
1. **Source-level**: `sourceJobId` uniqueness per adapter
2. **Cross-source**: Fingerprint-based (URL + title hash) — prevents duplicate jobs from different sources

### Stage 4: Matching

The matching engine (`docs/matching-engine-reference.md`) scores each job against every user's profile using a v2 knowledge base with 130+ skills, transferability graphs, and role profiles.

**Trigger points:**
- Incremental: new unmatched jobs are scored against all users (cron, every 30m)
- Full recalculation: on profile update or manual trigger
- Batch-optimized: profiles loaded in 4 parallel queries, yields to event loop every 50 users

### Stage 5: Notification

Above-threshold matches trigger notifications:
1. **Telegram** (primary): formatted message with [Save] [Reject] [Apply] [Open] inline buttons
2. **Web Inbox** (fallback): when Telegram is unavailable or rate-limited

Notifications are deduplicated per (user, match) pair and rate-limited per chat.

---

## Module Map

| Module | Purpose | Key Files |
|--------|---------|-----------|
| `auth` | Registration, login, JWT, roles, rate limiting | `auth.service.ts`, `auth.controller.ts` |
| `profile` | User profiles, CV upload (magic-byte validation, versioning) | `profile.service.ts` |
| `matching` | Scoring engine + knowledge base | `matching-engine.ts`, `matching.service.ts` |
| `sources` | 15 adapters, collection queue, health scoring | `adapters/`, `source-classifier.ts` |
| `telegram` | Bot polling, linking, commands, inline buttons, rate limiting | `telegram.service.ts` |
| `notifications` | Channel routing, dedup, Web Inbox, keyset pagination, SSE | `notifications.service.ts` |
| `lifecycle` | Expiration sweep, ghost detection, dormancy, backup, retention | `lifecycle.tasks.ts` |
| `applications` | Transition graph enforcement, stage history, follow-up dates | `applications.service.ts` |
| `saved-jobs` | Toggle save/unsave per user | `saved-jobs.service.ts` |
| `searches` | Saved search profiles (manual run) | `searches.service.ts` |
| `digest` | Daily digest generation, per-user top matches | `digest.service.ts` |
| `admin` | Stats dashboard, user CRUD, role change, password reset | `admin.service.ts` |
| `account` | Deactivation/deletion with pseudonymization | `account.service.ts` |
| `dashboard` | Aggregated stats for the frontend | `dashboard.service.ts` |
| `events` | SSE real-time push per user | `events.service.ts` |
| `salary` | Benchmarking data | `salary.service.ts` |
| `jobs` | Fidelity pipeline, URL liveness, description quality | `jobs.service.ts` |

---

## Data Model (16 Prisma Models)

```
User ──┬── CandidateProfile
       ├── TargetRole
       ├── LocationPreference
       ├── CandidateSkill ── Skill
       ├── JobMatch ── Job ── JobSkill ── Skill
       ├── Application
       ├── SavedJob ── Job
       ├── Notification
       ├── SearchProfile
       └── TelegramLink

Job ─── SourceRun ── Source

SystemLog (audit trail)
```

---

## Frontend Pages (17+)

| Route | Purpose |
|-------|---------|
| `/login`, `/register` | Auth forms with invite code support |
| `/onboarding` | 3-step wizard (roles → skills → locations), resumable |
| `/dashboard` | Stats, match carousel, daily digest, SSE live updates |
| `/profile` | Full CRUD, CV upload with progress bar, completion meter |
| `/settings` | Threshold slider, Telegram linking, password change, pause |
| `/jobs` | Search, tag-based filtering, infinite scroll |
| `/jobs/[id]` | Job detail with match score, save/apply actions |
| `/matches` | Scored matches with recalculate trigger |
| `/inbox` | Web inbox fallback for missed Telegram alerts |
| `/applications` | Kanban-style tracking (SAVED → APPLIED → INTERVIEW → etc.) |
| `/saved` | Bookmarked jobs |
| `/searches` | Saved search profiles |
| `/sources` | Source health monitoring (admin) |
| `/admin/dashboard` | System stats, collection metrics |
| `/admin/users` | User management, role changes |

---

## Key Design Decisions

1. **Knowledge graph over keyword matching**: The v2 knowledge base models skill relationships, transferability, and prerequisites — enabling nuanced matching (e.g., "React developer" matches a "Next.js" job at 0.70 transferability).

2. **Graceful degradation**: When Telegram is unavailable, notifications route to the Web Inbox. When a source fails, other sources continue. When skills are missing from a job, the engine defaults to neutral (0.65) instead of penalizing.

3. **Batch-optimized matching**: Profile loading uses 4 parallel Prisma queries instead of N+1. The scoring loop yields to the event loop every 50 users to prevent blocking SSE streams.

4. **Transition graph for applications**: Stage transitions are validated against a directed graph — illegal moves (e.g., INTERVIEW → SAVED) return HTTP 409.

5. **Pseudonymization on deletion**: Account deletion preserves data integrity by pseudonymizing rather than hard-deleting, so match history and application records remain queryable.

---

## Infrastructure

| Component | Current | Production Target |
|-----------|---------|-------------------|
| Database | SQLite | PostgreSQL |
| Process manager | Direct `node` | PM2 / systemd |
| Rate limiter | In-memory | Redis-backed (Phase 2) |
| Job queue | Cron-based | BullMQ (Phase 2) |
| Deployment | Manual | CI/CD pipeline |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | Database connection string |
| `JWT_SECRET` | ✅ | — | JWT signing secret (48+ bytes) |
| `TELEGRAM_BOT_TOKEN` | ⚠️ | — | From @BotFather |
| `MATCH_THRESHOLD` | ❌ | **65** | Default notification threshold |
| `ADMIN_EMAILS` | ❌ | — | Comma-separated admin emails |
| `JOB_COLLECTION_INTERVAL` | ❌ | 30m | Collection cycle interval |
| `INCREMENTAL_MATCH_LIMIT` | ❌ | 250 | Max jobs per incremental match pass |
| `RECALC_JOB_LIMIT` | ❌ | 1000 | Max jobs for full recalculation |

---

## Further Reading

- [Matching Engine Reference](./matching-engine-reference.md) — Scoring algorithm details
- [Operations Runbook](./ops-runbook.md) — Deployment, monitoring, troubleshooting
- [Traceability Matrix](./traceability.md) — Requirement → test coverage
- [SRS v2.3](../JobHunter_SRS_v2.3.md) — Full requirements specification

---

*Last updated: August 2026*
