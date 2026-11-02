# System Architecture — Overview

> Current state | Updated October 2026

This document describes the system **as implemented**. Counts and inventories in the generated block below come from the source tree; run `npm run facts:check` to verify them. Detailed inventories are in [Architecture Facts](./architecture-facts.md).

## What Is JobHunter?

JobHunter is an automated job-matching agent for the Ethiopian tech market. It collects jobs from 11 configured web sources plus 3 Telegram channels, matches them against user profiles using a knowledge-graph-powered scoring engine, and delivers personalized alerts via Telegram or a web inbox.

---

<!-- BEGIN GENERATED OVERVIEW FACTS -->
<!-- Generated from source by scripts/generate-architecture-facts.js. Do not edit by hand. -->

| Fact | Current value |
|---|---|
| Stack | Next.js 15.5, React 19.2, NestJS 10.4, Prisma 5.20, TypeScript 5.5 |
| Production database | SQLite (Prisma provider: sqlite; Docker URL: `file:/app/data/prod.db`) |
| Prisma models | 29 — User, CandidateProfile, CandidateEducation, CandidateExperience, CandidateProject, CandidateCertification, CandidateLanguage, CvFile, TelegramLink, Skill, CandidateSkill, TargetRole, LocationPreference, JobSource, JobSourceListing, SourceRun, SourceRunCategory, Job, JobSkill, JobMatch, ApplicationPackage, Application, ApplicationTransition, Notification, SearchProfile, Digest, MatchCycle, SystemLog, BotState |
| NestJS feature modules | 19 — account, admin, application-docs, applications, auth, dashboard, digest, events, jobs, lifecycle, matches, matching, notifications, profile, salary, saved-jobs, searches, sources, telegram |
| Frontend page routes | 18 |
| Web job sources | 12 — ReliefWeb (Ethiopia), Remotive, Arbeitnow, EthioJobs, Ethio NGO Jobs, GeezJobs, ET Careers, Jobicy, RemoteOK, Landing.jobs, Hagere Jobs, ElelanaJobs |
| Telegram channels | 3 — ElelanaJobs (Telegram), ShegerJobs (Telegram), EthioJobVacancy (Telegram) |
| Adapter classes | 13 (12 web + 1 parameterized Telegram) |
| Collection endpoints | 15 (12 web + 3 Telegram) |
| Test spec files | 35 (401 `it`/`test` declarations; parameterized cases expand at runtime) |
| CI jobs | 6 — lint-and-typecheck, test-backend, build-frontend, security, architecture, runtime-verification |

<!-- END GENERATED OVERVIEW FACTS -->

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
│  │  JWT    │  │  CV     │  │  Engine  │  │  11 web + 3 TG   │ │
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
                           │ Prisma
┌──────────────────────────▼──────────────────────────────────────┐
│                          SQLite                                 │
│                 29 Prisma models (single node)                  │
│  User · CandidateProfile · CvFile · TelegramLink · Skill        │
│  CandidateSkill · TargetRole · LocationPreference · JobSource   │
│  SourceRun · SourceRunCategory · Job · JobSkill · JobMatch      │
│  ApplicationPackage · Application · ApplicationTransition       │
│  Notification · SearchProfile · Digest · MatchCycle             │
│  SystemLog · BotState                                           │
└─────────────────────────────────────────────────────────────────┘
```

PostgreSQL remains supported by a parallel Prisma schema and is the path to multiple application instances, but it is **not** the current production database. See [Operations Runbook](./ops-runbook.md).

---

## Core Pipeline

The system operates as a continuous pipeline:

```
 Collection → Normalization → Validation → Dedup → Matching → Notification
     │              │              │          │         │            │
 11 web + 3 TG   Fidelity      Schema     (sourceId,  Score     Telegram /
   adapters      Pipeline      Check      sourceJobId) 0-100    Web Inbox
               + Skills                   + Ghost                + Alert
```

### Stage 1: Collection

Eleven web adapters and three Telegram channel adapters fetch job listings. Collection uses a queue with per-source frequency and health scoring.

**Web adapters:** EthioJobs, Ethio NGO Jobs, GeezJobs, ET Careers, ReliefWeb, Remotive, Arbeitnow, Jobicy, RemoteOK, Landing.jobs, Hagere Jobs.
**Telegram channels:** ElelanaJobs, ShegerJobs, EthioJobVacancy.

FAST collection runs on a 30-minute tick (`JOB_COLLECTION_INTERVAL`) and only collects sources whose own frequency has elapsed. DEEP category sweeps run on a 60-minute tick (`DEEP_COLLECTION_INTERVAL`); each source declares its own deep cadence (typically 12 hours). See [Category-Aware Collection](./plans/category-aware-collection.md).

Health scoring uses the last 10 runs (`HEALTH_WINDOW = 10`). A source is auto-disabled only when the window is full and **zero** runs succeeded; a single success keeps it eligible. Failed collection attempts use the configured fallback chains.

### Stage 2: Fidelity Pipeline

Raw jobs pass through the fidelity pipeline (`job-fidelity.spec.ts` tested):

1. **HTML cleaning** — entity decoding, mojibake fix, boilerplate stripping
2. **Quality scoring** — description completeness (0-100)
3. **URL normalization** — trailing slash removal, UTM stripping, fragment removal
4. **Apply-method extraction** — EMAIL, IN_PERSON, ONLINE_URL detection
5. **Normalization** — salary parsing, company name extraction, deadline extraction, fingerprinting

### Stage 3: Deduplication

1. **Database level**: a unique constraint on `(sourceId, sourceJobId)` prevents the same posting from being stored twice with the same source ID.
2. **Fingerprint level (same source)**: after the fidelity pipeline computes `fingerprint`, `persist()` looks for an existing job with the same `(sourceId, fingerprint)`. A match refreshes `lastSeenAt`, resets `missedCycles`, reactivates a REMOVED row, and keeps that row out of ghost reconciliation instead of creating a second copy. This covers the same posting served under different `sourceJobId` values, such as Arbeitnow's regional domains. The lookup is skipped when the description is empty, because an empty description is not distinctive enough to serve as a dedup key.
3. **Cross-source fingerprint level**: `persist()` also derives `crossSourceKey` — normalized company + title + location, with the description left out because boards rewrite it. When another board already produced a job with the same key, the incoming posting is attached as a `JobSourceListing` on that canonical job (one row per board, so every original link survives) instead of creating a second opportunity. `REJECTED` postings never merge, and the canonical row keeps the more permissive Ethiopia decision. Matching is exact, never fuzzy, so a near-miss stays a separate job rather than collapsing two real openings.
4. **Ghost reconciliation**: a canonical job is not expired while another board's listing has seen it inside the same freshness window.
5. **Within a run**: `dedupeWithinRun()` groups by `sourceJobId` and merges `sourceCategories` and `discoveredVia` when a job is found through several category pages.

Historical same-source groups can be inventoried read-only with `npm run duplicates:report`; `--apply` merges safe groups after a verified backup. Rows stored before cross-source grouping existed get their key and listing from `npm run listings:backfill`.

A related case the fingerprint key cannot reach is **content twins**: some sources publish one page per
city for the same opening, so each variant has its own `sourceJobId`, its own URL, and a description that
differs only in the location sentence — which means a different fingerprint by construction. 98 such
groups exist in the local dataset (worst case: 7 rows for one posting), and none of them are detectable
by `(sourceId, fingerprint)`. They are inventoried with `npm run duplicates:report -- --content` and are
deliberately **not merged**, because the same fields cannot tell "republished per city" apart from two
genuine openings in two cities; collapsing them in the match list is an open product decision.

### Stage 4: Matching

The matching engine (`docs/matching-engine-reference.md`) scores each job against each user profile using a knowledge base with 153 skills, transferability graphs, and 17 role profiles.

**Trigger points:**
- Incremental: new unmatched jobs are scored against all users. The default cycle is **10 minutes** (`MATCH_CYCLE_INTERVAL`); the sample `.env.example` sets 35 minutes for development.
- Full recalculation: on profile update or manual trigger.
- Batch-optimized: profiles are loaded in 9 parallel queries, and the loop yields to the event loop every 50 users.

Matching applies **hard eligibility filters** before scoring: remote-only users do not receive on-site jobs, `excludeOnsite` removes international on-site roles, `excludeEntryLevel` removes ENTRY/INTERN postings, expired/inactive vacancies are rejected, and a relevance gate rejects jobs with neither role alignment nor at least two skill signals. Ineligible jobs are returned with `score = 0`, `eligible = false`, and an `ineligibleReasons` list.

**Explainable scoring (Phase 6).** The score stays deterministic — no model decides relevance. Each match returns per-factor evidence, a required/preferred requirement list with `MET` / `PARTIAL` / `MISSING` / `UNKNOWN` verdicts, and a vacancy risk (`OK`, `EXPIRED`, `STALE`, `UNVERIFIED`). Verified profile sections (education, experience, projects, certifications, languages) supply skill evidence alongside the skills list; a skill proven by a certification or project is matched and the source is named. Missing employer data is `UNKNOWN`, never satisfied. Stale postings lose 6 points and unverifiable links lose 4; expired postings are rejected outright. The explanation is persisted on `JobMatch` (`matcherVersion = v3.0-requirements`) and surfaced in the UI.

### Stage 5: Notification

Above-threshold matches trigger notifications:

1. **Telegram** (primary): formatted message with [Save] [Reject] [Apply] [Open] inline buttons
2. **Web Inbox** (fallback): when Telegram is unavailable or rate-limited

Notifications are deduplicated per `(user, job)` pair and rate-limited per chat.

---

## Module Map

| Module | Purpose | Key Files |
|--------|---------|-----------|
| `auth` | Registration, login, JWT, roles, rate limiting | `auth.service.ts`, `auth.controller.ts` |
| `profile` | Structured candidate profile, supporting documents, CV import with review-before-save | `profile.service.ts`, `cv/cv-parser.ts`, `cv/cv-text.ts` |
| `matching` | Scoring engine + knowledge base | `matching-engine.ts`, `matching.service.ts` |
| `sources` | 12 adapter classes, collection queue, health scoring | `adapters/`, `source-classifier.ts` |
| `telegram` | Bot polling, linking, commands, inline buttons, rate limiting | `telegram.service.ts` |
| `notifications` | Channel routing, dedup, Web Inbox, keyset pagination, SSE | `notifications.service.ts` |
| `lifecycle` | Expiration sweep, ghost detection, dormancy, backup, retention | `lifecycle.tasks.ts` |
| `applications` | Transition graph enforcement, stage history, follow-up dates | `applications.service.ts` |
| `application-docs` | Deterministic, versioned application packages (CV, cover letter, screening answers) from verified profile data | `generator.ts`, `application-docs.service.ts` |
| `saved-jobs` | Toggle save/unsave per user | `saved-jobs.service.ts` |
| `searches` | Saved search profiles (manual run) | `searches.service.ts` |
| `digest` | Daily digest generation, per-user top matches | `digest.service.ts` |
| `admin` | Stats dashboard, user CRUD, role change, password reset | `admin.service.ts` |
| `account` | Deactivation/deletion with pseudonymization | `account.service.ts` |
| `dashboard` | Aggregated stats for the frontend | `dashboard.service.ts` |
| `events` | SSE real-time push per user | `events.service.ts` |
| `salary` | Benchmarking data | `salary.service.ts` |
| `jobs` | Fidelity pipeline, URL liveness, description quality | `jobs.service.ts` |
| `matches` | Match listing, filtering, and recalculate endpoint | `matches.service.ts`, `matches.controller.ts` |

`PrismaModule` is infrastructure, and `health` is a controller-only module; neither is a feature module.

### CV import: review before save

`POST /api/profile/cv/import` extracts text from the active CV (`pdf-parse` for PDF,
`mammoth` for DOCX) and returns a **draft** parsed by `cv/cv-parser.ts`. Nothing is written:
the candidate reviews the draft, applies it to the editor, edits it, and only then does
`PATCH /api/profile` persist anything. The parser is deliberately conservative — an
unreadable line becomes a `warnings[]` entry rather than a guessed value — and a scanned
PDF is rejected with a message pointing at manual entry. Structured sections use
replace-all semantics: sending `education` (or any other section) replaces the stored rows
inside the same transaction as the profile fields.

---

## Data Model (28 Prisma Models)

```
User ──┬── CandidateProfile ── CandidateEducation / CandidateExperience /
       │                      CandidateProject / CandidateCertification /
       │                      CandidateLanguage
       ├── CvFile (kind: CV | CERTIFICATE | PORTFOLIO | OTHER)
       ├── TargetRole
       ├── LocationPreference
       ├── CandidateSkill ── Skill
       ├── JobMatch ── Job ── JobSkill ── Skill
       ├── Application ── ApplicationTransition
       ├── Notification
       ├── SearchProfile
       ├── Digest
       └── TelegramLink

Job ─── JobSource ── SourceRun ── SourceRunCategory

MatchCycle (per-cycle metrics)
SystemLog (audit trail)
BotState (Telegram polling state)
```

Saved jobs are not a separate table: saving is represented by an `Application` row in the `SAVED` stage.

---

## Frontend Pages (19)

| Route | Purpose |
|-------|---------|
| `/` | Landing / redirect to the signed-in experience |
| `/login`, `/register` | Auth forms with invite code support |
| `/onboarding` | 3-step wizard (roles → skills → locations), resumable |
| `/dashboard` | Stats, match carousel, daily digest, SSE live updates |
| `/profile` | Personal details, education, experience, projects, certifications, languages, documents, CV import review, completion meter |
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
| `/error`, `/forbidden` | Error and access-denied states |

---

## Key Design Decisions

1. **Knowledge graph over keyword matching**: The knowledge base models skill relationships, transferability, and prerequisites — enabling nuanced matching (e.g., React → Next.js at 0.90 transferability).

2. **Graceful degradation with hard constraints**: When Telegram is unavailable, notifications route to the Web Inbox. When a source fails, other sources continue. When a job has no extractable skills, the skill factor uses a conservative neutral of **0.4**, not a bonus; hard eligibility filters still prevent unrelated jobs from ranking. See the [matching reference](./matching-engine-reference.md).

3. **Batch-optimized matching**: Profile loading uses 9 parallel Prisma queries instead of N+1. The scoring loop yields to the event loop every 50 users to prevent blocking SSE streams.

4. **Transition graph for applications**: Stage transitions are validated against a directed graph — illegal moves (e.g., INTERVIEW → SAVED) return HTTP 409.

5. **Pseudonymization on deletion**: Account deletion preserves data integrity by pseudonymizing rather than hard-deleting, so match history and application records remain queryable.

6. **SQLite first**: The production topology is a single Node process with a SQLite file on a persistent volume. This is deliberate for a zero-budget, single-node deployment. Multi-instance or managed hosting requires PostgreSQL first.

---

## Infrastructure

| Component | Current (authoritative) | Optional / future |
|-----------|-------------------------|-------------------|
| Database | SQLite file (`/app/data/prod.db` in Docker) | PostgreSQL via `schema.postgresql.prisma` |
| Migrations | `node scripts/db-migrate-safe.js` → verified backup, copy test, row-count check, `prisma migrate deploy` | Same |
| Process manager | Docker entrypoint / direct `node` | PM2 / systemd |
| Rate limiter | In-memory | Redis-backed (multi-instance) |
| Job queue | Cron-based | BullMQ |
| Deployment | Docker Compose or manual | CI/CD pipeline |

Schema changes are applied only through `backend/scripts/db-migrate-safe.js`; `prisma db push` is not used against a live database. The entrypoint fails closed if a migration cannot be verified, and an existing `db push` database must be baselined once (see the runbook).

SQLite is a single-writer database. Do not run multiple backend replicas against the same file. See [Operations Runbook](./ops-runbook.md) for the baseline, backup, and restore procedure.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | `file:./dev.db` | SQLite file in development; `file:/app/data/prod.db` in Docker |
| `JWT_SECRET` | Recommended | auto-generated | Signing secret (32+ chars). If unset, a random secret is generated and sessions do not survive restarts. Set it in production. |
| `TELEGRAM_BOT_TOKEN` | ⚠️ | — | From @BotFather |
| `MATCH_THRESHOLD` | ❌ | **65** | Default notification threshold |
| `ADMIN_EMAILS` | ❌ | — | Comma-separated admin emails |
| `JOB_COLLECTION_INTERVAL` | ❌ | 30m | FAST collection tick |
| `DEEP_COLLECTION_INTERVAL` | ❌ | 60m | DEEP collection tick |
| `MATCH_CYCLE_INTERVAL` | ❌ | 10m | Matching cycle (sample `.env` uses 35m) |
| `INCREMENTAL_MATCH_LIMIT` | ❌ | 250 | Max jobs per incremental match pass |
| `RECALC_JOB_LIMIT` | ❌ | 1000 | Max jobs for a full recalculation |

---

## Further Reading

- [Architecture Facts](./architecture-facts.md) — generated inventories (models, modules, sources, routes, tests)
- [Matching Engine Reference](./matching-engine-reference.md) — scoring algorithm details
- [Application Documents](./application-documents.md) — deterministic, versioned CV / cover letter generation
- [Operations Runbook](./ops-runbook.md) — deployment, backup/restore, monitoring, troubleshooting
- [Traceability Matrix](./traceability.md) — requirement → test mapping
- [Category-Aware Collection](./plans/category-aware-collection.md) — implemented FAST/DEEP collection design
- [SRS v2.3](../JobHunter_SRS_v2.3.md) — full requirements specification

---

*Last updated: October 2026*
