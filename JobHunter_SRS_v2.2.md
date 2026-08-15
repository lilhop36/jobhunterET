# SOFTWARE REQUIREMENTS SPECIFICATION

## Intelligent Job Search, Aggregation, Matching and Notification System

### Project Name
**JobHunter**

### Document Type
Software Requirements Specification (SRS)

### Version
**2.2 — Final Development Baseline**

### Status
Development Baseline

### Date
August 2026

---

# 0. Revision Summary

## 0.1 Changes in v2.2 (Current)

This revision patches critical edge cases, lifecycle-management gaps, and scaling bottlenecks identified during a full system audit. It transitions the specification from a "happy-path" design into a resilient, production-grade data engine. **No requirement from v2.1 is removed or weakened.** The changes are:

1. **Formal role model (FR-001, §25, §33).** A `role` enum (`USER`, `ADMIN`) is added to the `User` entity. The first registered user — or any email listed in the `ADMIN_EMAILS` environment variable — is auto-promoted to `ADMIN`. All source-management routes are protected by a role guard. Previously "admin" was an implied capability with no enforcement.

2. **Ghost Job Detection (FR-015).** A job that vanishes from its source website before its stated deadline is now detected. If an `ACTIVE` job is absent from its source for **three consecutive collection cycles**, its status transitions to `REMOVED` and it is excluded from matching and notification. This prevents users from being sent to dead listings.

3. **Background Expiration Sweeper (FR-034a).** A scheduled task runs every six hours and marks any `ACTIVE` job whose `deadline` has passed as `EXPIRED`, regardless of whether the source website removed it. This guarantees the matcher never evaluates stale jobs.

4. **Data Retention & Archiving Policy (§25.2).** To prevent unbounded growth of the `rawData` JSONB payload, jobs that have been `EXPIRED` or `REMOVED` for more than 90 days **and** have no linked `Application` or `SavedJob` records are archived: their bulky `rawData` and `description` fields are purged and an `archivedAt` timestamp is set. Jobs tied to a user's application history are retained in full. Referential integrity is preserved because the `Job` row itself is never hard-deleted.

5. **Global Telegram Rate Limiting (FR-024b).** In addition to the existing per-chat throttle, a **global** queue limit of 25 messages per second across all users is enforced to stay within the Telegram Bot API's global rate limit and avoid temporary bot bans during large job drops.

6. **Profile Update Recalculation Hook (FR-003e).** When a user modifies core matching attributes (skills, target roles, location tiers, remote preference, employment types), the system queues a background task to recalculate that user's matches against the 1,000 most recent `ACTIVE` jobs. The user receives immediate, updated matches without waiting for the next collection cycle.

7. **Web Inbox Fallback (FR-024c, §32.10).** If a user has not linked Telegram, or if Telegram delivery fails permanently, the match is stored as an `UNREAD_WEB` notification and surfaced in a persistent "Inbox / Missed Alerts" tab on the web dashboard. No qualifying match is ever silently lost.

## 0.2 Changes carried forward from v2.1

All v2.1 enhancements remain in force: onboarding wizard and profile-completion meter (FR-003d); Telegram deep-link linking and bot persona (FR-003b); parse-confidence scoring (FR-012c); notification channel abstraction (FR-024a); Telegram command interface (FR-025b); match summary line (FR-025c); threshold live projection (FR-026); MatchCycle funnel metrics (FR-037a); low-bandwidth performance budget (NFR-006); accessibility and localization readiness (NFR-007); and the expanded frontend specifications (§32.4–§32.9).

## 0.3 Changes carried forward from v2.0

All v2.0 multi-user foundations remain in force: user registration and authentication promoted into the MVP; per-user scoping of profile, CV, matches, saved jobs, applications, and notifications; Telegram account linking; CV upload as a first-class requirement; and the reordered milestone sequence.

---

# 1. Introduction

## 1.1 Purpose

This SRS defines the functional, non-functional, technical, and operational requirements for **JobHunter**, an automated, **multi-user** job-search and job-notification system focused primarily on the Ethiopian job market.

The system automatically discovers job opportunities from permitted Ethiopian and international sources, collects and normalizes them, removes duplicates, evaluates each posting against **every registered user's** career profile, ranks opportunities by relevance with **explainable scoring**, and notifies each user individually when a suitable job is found — through a Telegram bot linked specifically to that user's account, or through the web Inbox when Telegram is unavailable.

**JobHunter is Ethiopia-first; remote and international are secondary.** Priority 1 is Ethiopian opportunities. Priority 2 is remote work. Priority 3 is international relocation markets (USA, Canada, UK, Netherlands, and others).

**Channel rationale:** Telegram is the primary notification channel because it is the dominant low-data messaging platform in Ethiopia, delivers near-instant push delivery, supports rich interactive messages (inline keyboards and bot commands), and its Bot API is free — aligning with the $0 budget constraint (§7.1). The web Inbox acts as a durable fallback so that no qualifying match is lost when Telegram is not linked or not reachable.

The first release operates with **zero software-service budget**, using locally hosted infrastructure, free/open-source software, accessible public APIs/feeds, permitted crawling, and the free Telegram Bot API.

## 1.2 Definitions

| Term | Meaning |
| --- | --- |
| **User** | A person with a registered account (email + password) and role `USER`. |
| **Admin** | A user with role `ADMIN` who can manage job sources and trigger manual collection. |
| **Profile** | A user's career data: skills, target roles, experience, location priorities. |
| **CV / Resume** | The uploaded file attached to a user's profile. |
| **Telegram Link** | The record connecting a `User` to their personal Telegram `chatId`. |
| **Deep Link** | A `https://t.me/<bot>?start=<code>` URL that opens the bot with the link code pre-filled. |
| **Job** | A posting collected from an external source, shared across all users. |
| **Match** | The scored relationship between one `Job` and one `User`'s profile. |
| **MatchCycle** | One collection-and-matching run, with funnel metrics recorded. |
| **Parse Confidence** | A 0–100 measure of how cleanly a job's attributes were extracted. |
| **Ghost Job** | A job that disappears from its source website before its stated deadline. |
| **Expired Job** | A job whose `deadline` has passed. |
| **Web Inbox** | A dashboard tab storing notifications that could not be delivered via Telegram. |
| **Focus Mode** | A one-job-at-a-time match review experience (Phase 2). |

---

# 2. Scope

## 2.1 Product Scope

JobHunter provides the following major capabilities:

01. User registration and authentication with a formal **role model** (`USER`, `ADMIN`).
02. Guided onboarding wizard with a profile-completion meter.
03. Per-user profile management, including CV upload with client-side validation.
04. **Automatic match recalculation when a user updates their profile.**
05. Per-user Telegram account linking via one-tap deep link or manual code.
06. **Web Inbox fallback** for users without Telegram or with failed delivery.
07. Job-source management in priority tiers (`ETHIOPIA`, `REMOTE`, `INTERNATIONAL`), restricted to admins.
08. Automated job collection.
09. Job normalization, validation, parse-confidence scoring, and deduplication.
10. **Job lifecycle management: ghost-job detection and expiration sweeping.**
11. Job storage in a shared pool with a **data retention and archiving policy**.
12. Job search and filtering.
13. Rule-based job matching — run per user against every job.
14. Job relevance scoring — stored, explainable, and visualized in the UI.
15. AI-assisted job analysis (optional, local, post-MVP).
16. Job recommendation.
17. Per-user Telegram notifications with interactive buttons, a command interface, and **global + per-chat rate limiting**.
18. Saved-job management.
19. Job application tracking with a status-board UI.
20. Search-profile management.
21. Background job processing and scheduling.
22. Source health monitoring and match-cycle funnel metrics.
23. System logging.
24. Error handling and retry mechanisms.
25. Dashboard and analytics (post-MVP expansion).

## 2.2 Out of Scope for MVP

- Payment / subscription system.
- Mobile native app.
- Advanced machine learning / semantic matching.
- Password reset via email (manual/admin reset acceptable for MVP; FR-002c).
- Social login (Google/GitHub OAuth) — deferred.
- Amharic UI localization (strings externalized from day one; translation Phase 2).
- Focus Mode match review (Phase 2).
- Drag-and-drop kanban interaction (status dropdown in MVP; Phase 2).
- Email notification channel implementation (abstraction exists in MVP; Phase 3).

---

# 3. Product Vision

> **A personal job-search agent, available to multiple users, that continuously discovers opportunities in Ethiopia — from job boards, company career pages, NGOs, and public-sector sources — while also monitoring selected remote and international opportunities. Each user configures their own profile once; the agent evaluates every new job against every user, explains why each match matters, keeps the job pool clean of expired and ghost listings, and notifies each user individually via their own linked Telegram chat or web Inbox.**

The system moves each user from manually searching many websites, opening hundreds of postings, checking requirements, and remembering what was seen — to: register and configure once → JobHunter searches continuously → evaluates per user → explains and delivers high-quality matches → user decides whether to apply.

**Differentiators vs. existing systems:** explainable scoring with freshness decay (versus black-box auto-appliers), multi-user isolation (versus single-user scripts), Telegram-first delivery with a durable web fallback (versus email-based boards), automated job lifecycle hygiene (versus aggregators that serve dead listings), and Ethiopia-first source coverage (versus global tools that cannot parse local sources).

---

# 4. Problem Statement

Job seekers commonly face:

- Job opportunities distributed across many platforms.
- New postings appearing continuously, at any hour.
- The same job appearing on multiple platforms.
- Inconsistent terminology across postings.
- Missed opportunities and missed deadlines.
- **Dead listings:** jobs that have expired or been removed but still appear on aggregators.
- Time-consuming manual filtering.
- No centralized way to track applications.
- No way to have a *personal* agent do this — existing aggregators are one-size-fits-all, not tailored to an individual's evolving profile.

JobHunter addresses these by automating discovery, filtering, matching, explanation, lifecycle hygiene, and notification on a per-user basis.

---

# 5. Objectives

## 5.1 Primary Objectives (MVP)

The system shall:

- Allow multiple users to register and log in securely, with a formal role model.
- Guide each user through profile setup and CV upload.
- Recalculate a user's matches automatically when their profile changes.
- Allow each user to link their Telegram chat with one tap, and fall back to a web Inbox otherwise.
- Automatically collect job postings from permitted sources.
- Normalize, validate, confidence-score, and deduplicate postings.
- Detect and deactivate ghost jobs and expired jobs.
- Match every new active job against every active user's profile.
- Calculate an explainable relevance score per user per job and visualize the explanation.
- Notify each user individually when a high-quality match appears, with a plain-language reason, respecting global and per-chat rate limits.
- Let users save, reject, track applications, and control notification flow (pause/resume).
- Retain historical data while preventing unbounded database growth.

## 5.2 Secondary Objectives

- Learn from user interactions to improve ranking over time.
- Use local AI to analyze ambiguous job descriptions.
- Support additional job sources and notification channels.
- Support cloud deployment.

---

# 6. Target Users

## 6.1 Primary Users

Multiple individual job seekers, each with their own account. Example initial user base: the developer, classmates, and friends also job-hunting in Ethiopia.

```
User A:
Software Engineering Graduate
Target: Backend Developer, Full Stack Developer
Experience: Junior / Entry Level
Preferred: Ethiopia (Addis Ababa), Remote

User B:
Recent Graduate
Target: Frontend Developer
Experience: Entry Level
Preferred: Ethiopia (Bahir Dar), Remote
```

## 6.2 Administrative Users

One or more administrators who manage job sources, monitor source health, and trigger manual collection. In the MVP the first registered user is auto-promoted to admin.

## 6.3 Future Users

- Career coaches managing multiple candidates.
- Recruiters (read-only aggregated view).
- NGOs posting/monitoring humanitarian-sector roles.

---

# 7. Product Constraints

## 7.1 Budget Constraint

Target software-service budget: **$0**. Prioritize open-source software, local infrastructure, free APIs/feeds, permitted crawling, and the free Telegram Bot API. Paid services may be introduced later but are not required.

## 7.2 Hardware Constraint

The initial system shall run on a personal computer. No dedicated cloud server is required for development or MVP operation, though multi-user usage should be considered when sizing background job frequency (see NFR-002).

## 7.3 Data Collection Constraint

The system shall not rely on unauthorized circumvention of CAPTCHA, authentication controls, anti-bot protections, or access restrictions. Each job source shall be implemented according to the access method it permits.

## 7.4 Account Data Constraint

Passwords shall never be stored in plain text. CV files shall be stored with access restricted to their owning user. No user's profile or CV shall be visible to another user.

## 7.5 Client Constraint

Users are assumed to be on entry-level smartphones and low-bandwidth mobile connections for Telegram interactions, and modest laptops/desktops for the web app. The UI must remain usable under these conditions (NFR-006).

---

# 8. System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                       JobHunter System                        │
├──────────────────────────────────────────────────────────────┤
│  Web App (register / onboarding / profile / CV / inbox /      │
│           applications / admin sources)                       │
│       │                                                       │
│       ▼                                                       │
│  REST API  ──── JWT Auth Guard + Role Guard (ADMIN/USER)      │
│       │                                                       │
│       ├────────────────┐                                      │
│       ▼                ▼                                      │
│  PostgreSQL          Redis (Phase 2)                          │
│   ├ User/Profile      │                                       │
│   ├ Job/JobMatch      ▼                                       │
│   ├ Notification   Background Workers                         │
│   ├ SourceRun       ├ Collectors                              │
│   └ MatchCycle      ├ Expiration Sweeper (every 6h)           │
│       │             ├ Ghost Job Detector (per cycle)          │
│       │             ├ Matchers (per user + recalc hook)       │
│       │             ├ Retention Archiver (nightly)            │
│       │             └ Notification Queue                      │
│       │                  (global 25 msg/s + per-chat 1.2s)    │
│       ▼                                                       │
│  Notification Engine (channel abstraction, per-user routing)  │
│       │                                                       │
│       ├──────────────► Telegram Bot → User A / B / C chats    │
│       └──────────────► Web Inbox (UNREAD_WEB)                 │
└──────────────────────────────────────────────────────────────┘
```

---

# 9. System Architecture

## 9.1 Architectural Style

Modular backend architecture:

1. Presentation Layer (Next.js frontend).
2. API Layer (NestJS controllers).
3. Auth Layer (Passport strategies, JWT guards, bcrypt, **role guards**).
4. Application/Service Layer.
5. Data Access Layer (Prisma).
6. Background Worker Layer.
7. External Source Integration Layer.
8. AI Layer (optional, post-MVP).
9. Notification Layer (channel abstraction, per-user routing, rate limiting).

## 9.2 Technology Stack

### Frontend
Next.js, React, TypeScript, Tailwind CSS, shadcn/ui component library (accessible primitives, themeable), `next-intl`-ready string externalization.

### Backend
NestJS, TypeScript, REST API; Passport.js (`passport-jwt`, `passport-local`) for authentication; bcrypt for password hashing; Multer for CV file upload handling.

### Database
PostgreSQL.

### ORM
Prisma.

### File Storage
Local disk under `/uploads/cv/{userId}/` for MVP (path stored in DB, not the file itself). Swappable for S3-compatible storage later without schema changes.

### Background Processing
NestJS scheduler (`@nestjs/schedule`) for MVP. Redis + BullMQ deferred to Phase 2.

### Job Collection
REST APIs, RSS, JSON feeds, Cheerio, Playwright where permitted.

### Initial Job Sources (priority-tiered)

**Tier ETHIOPIA (Priority 1)**
1. ReliefWeb API v2 — public JSON API, free, requires pre-approved `appname`.
2. EthioNGOJobs — WordPress `wp-json` REST API, zero setup.
3. Ethiojobs.net — sitemap-driven discovery + polite HTML parsing.
4. HaHuJobs — sitemap-driven, Nuxt-rendered, polite rate limits.
5. GeezJobs — low rate, respect ToS.
6. Company career pages (Ethiopian employers).
7. Government / public-sector postings via the above channels.

**Tier REMOTE (Priority 2)**
- Remotive — free JSON API, no key.
- Arbeitnow — free JSON API, no key.

**Tier INTERNATIONAL (Priority 3)**
- USAJobs — free API, requires key.
- Adzuna — free tier, requires key.
- Greenhouse / Lever / Ashby public board endpoints.

Out of scope: LinkedIn, Indeed (no permitted API access). GitHub Jobs discontinued.

### AI
Initial: rule-based matching. Optional later: Ollama / local open-source LLM.

### Notification
Initial: Telegram Bot API (per-user routing) + Web Inbox. Future: Email.

### Development
Git, GitHub, VS Code, Docker.

---

# 10. High-Level System Workflow

```
1.  User registers and logs in (first user auto-promoted to ADMIN)
2.  User completes onboarding wizard + uploads CV
3.  User links Telegram via deep-link button (or relies on Web Inbox)
4.  Scheduler starts job collection (shared, source-side)
5.  Collector contacts job source
6.  Raw jobs retrieved, normalized, validated, confidence-scored, deduplicated
7.  New jobs stored in shared Job table; MatchCycle begins
8.  Ghost Job Detector marks jobs absent for 3 cycles as REMOVED
9.  Expiration Sweeper marks past-deadline jobs as EXPIRED
10. For EACH active user: matching engine scores each new ACTIVE job
11. Profile updates trigger a targeted recalculation for that user
12. High-scoring matches enter the notification queue (global + per-chat limited)
13. Notification service sends alert to the user's Telegram, or stores UNREAD_WEB
14. User acts via buttons or commands (save / reject / apply / pause)
15. Action stored against (userId, jobId); feeds funnel metrics and future ranking
16. Nightly Retention Archiver purges bulky data from old orphaned jobs
```

---

# 11. Functional Requirements — Accounts & Roles

## FR-001 User Registration and Role Assignment

The system shall allow a new user to register with:

```
Email (unique)
Password (min 8 chars; complexity rule configurable)
```

On registration:

1. Validate the email is not already registered.
2. Hash the password with bcrypt (never store plain text).
3. **Determine the role:**
   - If this is the first user ever registered, assign role `ADMIN`.
   - Else if the email appears in the `ADMIN_EMAILS` environment variable (comma-separated), assign role `ADMIN`.
   - Otherwise assign role `USER`.
4. Create a `User` record with the assigned role.
5. Create an empty `CandidateProfile` linked to that user.
6. Return a JWT access token so the user is immediately logged in.

```
POST /api/auth/register
Body: { email, password }
Response: { accessToken, user: { id, email, role } }
```

## FR-002 User Login

```
POST /api/auth/login
Body: { email, password }
Response: { accessToken, user: { id, email, role } }
```

The system shall verify the password against the stored bcrypt hash using `passport-local`, then issue a signed JWT (via `passport-jwt`) containing `userId` and `role`.

### FR-002a Session Handling

- JWT expires after a configurable window (e.g. 7 days for MVP simplicity; refresh tokens are a Phase 2 concern).
- Every protected route is guarded by a NestJS `AuthGuard('jwt')`.
- The guard attaches `req.user.id` and `req.user.role` so every service call is automatically scoped to the correct user.

### FR-002b Logout

Logout is client-side (discard the token). No server-side session store is required for MVP since JWTs are stateless.

### FR-002c Password Reset (MVP-simplified)

Full email-based password reset is deferred. MVP requirement: an authenticated user can change their password by supplying their current password (`PATCH /api/auth/password`). A lost-password flow is a Phase 2 item.

## FR-002d Role-Based Access Control

- A `RolesGuard` shall enforce route-level role requirements via a `@Roles('ADMIN')` decorator.
- All source-management endpoints (§24) require `ADMIN`.
- All other authenticated endpoints require a valid `USER` or `ADMIN` JWT and are scoped to the caller's own data at the service layer.
- A `USER` calling an admin endpoint receives HTTP 403.

---

# 12. Functional Requirements — Candidate Profile & CV

## FR-003 Candidate Profile (per user)

Every profile is linked 1:1 to a `User` via `userId`. The profile shall contain:

- Professional title, summary.
- Skills (many-to-many via `CandidateSkill`).
- Years of experience.
- Education, certifications.
- Preferred roles (with priority — see FR-005).
- Preferred locations (priority tiers — see FR-006).
- Remote preference.
- Employment types.
- Salary preference.
- Relocation preference.
- Visa/sponsorship preference.
- Excluded job characteristics.

```
GET   /api/profile          → returns the logged-in user's profile
PATCH /api/profile          → updates the logged-in user's profile
```

The API never accepts a `userId` in the request body for this route — it is always taken from the authenticated JWT.

## FR-003e Profile Update Recalculation Hook (new in v2.2)

When `PATCH /api/profile` modifies any **core matching attribute** — skills, target roles, location preferences, remote preference, or employment types — the system shall:

1. Persist the profile change and return the response immediately (non-blocking).
2. Enqueue a background task for that user.
3. The task recalculates the user's matches against the **1,000 most recent `ACTIVE` jobs** (ordered by `firstSeenAt` descending).
4. Existing `JobMatch` records for that `(userId, jobId)` pair are updated (upserted); new matches are created; matches that fall below threshold are retained but not notified.
5. If a newly recalculated match exceeds the user's threshold and has not been notified before, it enters the notification queue.

This gives the user immediate, updated matches without waiting for the next collection cycle. Recalculation for non-core fields (e.g. summary text, salary preference) is optional and may be skipped in MVP.

## FR-003a CV Upload

The system shall let a user upload a CV file attached to their profile.

```
POST /api/profile/cv
Body: multipart/form-data, field "file"
Accepted types: .pdf, .docx
Max size: 5 MB (configurable)
```

Behavior:

1. Validate file type and size.
2. Store the file on disk at `/uploads/cv/{userId}/{timestamp}-{filename}`.
3. Save the file path, original filename, and upload date in a `CvFile` record linked to the user.
4. A new upload replaces the "active" CV (old versions may be retained for history).

```
GET    /api/profile/cv      → returns metadata + download link for the active CV
DELETE /api/profile/cv      → removes the active CV
```

**UX requirements:** client-side type/size validation before upload; visible progress indicator; replacement flow shows current active CV name/date; friendly error copy for invalid files.

## FR-003d Onboarding Wizard

After first login, the user is offered a 3-step wizard, skippable and resumable:

1. **Roles:** professional title + target roles via tap-to-select chips with priority.
2. **Skills:** typeahead input with normalized suggestions (leveraging the skill-alias dictionary, FR-004).
3. **Locations & preferences:** location priority tiers, remote preference, employment types.

A profile-completion meter (percentage of key fields populated) is computed server-side and shown on `/profile` and the dashboard until 100%.

---

# 13. Functional Requirements — Telegram Account Linking

## FR-003b Telegram Link

**Problem this solves:** a Telegram bot only ever sees a numeric `chatId` when someone messages it — it has no idea which registered `User` that chat belongs to. Without an explicit linking step, the system cannot know where to send a given user's notifications.

**Flow:**

1. The logged-in user requests a link code:

```
POST /api/telegram/link-code
Response: { code: "A1B2C3", expiresAt, deepLink }
```

where `deepLink = https://t.me/<botUsername>?start=<code>`.

2. The `/settings/telegram` page renders a one-tap "Open Telegram & Link" button using the deep link, plus the raw code with a copy button as fallback.
3. The user taps Start (or sends `/start <code>`). The bot receives the message along with Telegram's own `chatId`.
4. The bot backend looks up the code, finds the matching `userId`, and creates a `TelegramLink` record:

```
TelegramLink { userId, chatId, linkedAt }
```

5. The code is single-use and expires after 10 minutes.
6. The bot replies with progress and completion messages in a consistent, friendly persona, e.g. "⏳ Checking your code… ✅ Linked to your JobHunter account! I'll send your job matches here."

```
GET    /api/telegram/status   → { linked: true/false, linkedAt }
DELETE /api/telegram/link     → unlink (user can relink later with a new code)
```

Until linking is complete, the user receives matches via the Web Inbox (FR-024c) and the UI shows a banner encouraging Telegram connection.

---

# 14. Skill Management

## FR-004 Skill Management

Users add/remove skills from their profile. Skill aliases (e.g. `Node`, `NodeJS`, `Node.js` → `Node.js`) are normalized centrally so matching stays reliable regardless of how a user or a job posting phrases a skill.

---

# 15. Target Role Management

## FR-005 Target Roles

Users define target roles with priority (`HIGH` / `MEDIUM` / `LOW`), e.g.:

```
Backend Developer        HIGH
Full Stack Developer     HIGH
Frontend Developer       MEDIUM
```

---

# 16. Location Preferences

## FR-006a Location Hierarchy

```
Country
 └── Ethiopia
      ├── Addis Ababa
      ├── Oromia
      ├── Hawassa
      ├── Adama
      ├── Bahir Dar
      ├── Dire Dawa
      ├── Jimma
      └── ...
```

Each job's location is classified as exactly one of:

```
ETHIOPIA_LOCAL, ETHIOPIA_REMOTE, INTERNATIONAL_REMOTE,
INTERNATIONAL_ONSITE, INTERNATIONAL_HYBRID
```

## FR-006b Location Priority Tiers (per user)

```
1. Ethiopia    HIGH
2. Remote      HIGH
3. USA         MEDIUM
4. Canada      MEDIUM
```

Location scoring uses each user's own priority tiers — two users can score the same job very differently based purely on their location preferences.

---

# 17. Job Source Management

## FR-007 Job Source Registration (Admin only)

Each source record: `id, name, type, baseUrl, status, priorityTier, lastSuccessfulRun, lastFailedRun, lastError, collectionFrequency`. Types: `API, RSS, JSON, HTML, Company Career Page`. Only `ADMIN` users may create, update, or disable sources.

## FR-008 Source Adapter Architecture

```
interface JobSourceAdapter {
    readonly sourceId: string;
    fetchJobs(options?: { since?: Date }): Promise<RawJob[]>;
}
```

New sources plug in without modifying the core pipeline.

---

# 18. Job Collection, Normalization, Validation, Deduplication, Lifecycle

## FR-009 Automated Job Collection

Connect → retrieve → parse → convert → validate → normalize → confidence-score → dedupe → store.

## FR-010 Manual Collection (Admin only)

`POST /sources/:id/collect` — admin trigger, processed asynchronously.

## FR-011 Job Information

Each job stores: id, title, description, company, location, remote status, employment type, experience level, salary, currency, skills, url, source, sourceJobId, postedDate, deadline, firstSeenAt, lastSeenAt, status, missedCycles, parseConfidence, archivedAt, fingerprint, and the full raw payload (`rawData` JSONB).

## FR-012 Normalization

`WFH / Work From Home / Fully Remote / Remote` → `REMOTE`. `Full-time / FULL_TIME / Permanent` → `FULL_TIME`.

## FR-012a Job Attribute Extraction

Skill dictionary + aliases, role keywords, seniority patterns, years-of-experience extraction, location extraction, employment-type extraction. Deterministic and rule-based in MVP.

## FR-012b Skill Relationship Graph

`JavaScript → TypeScript, Node.js, React`; `Node.js → Express, NestJS, Fastify`; `PostgreSQL → SQL`. Broadens matching.

## FR-012c Parse Confidence

Each job receives `parseConfidence` (0–100) reflecting how cleanly title, skills, location, seniority, and employment type were extracted. Jobs below a configurable threshold (default 40) still enter the pool but are down-weighted in matching and visually flagged.

## FR-013 Validation

Minimum required fields: title, company, source, url. Invalid jobs never enter the primary table; failures are logged.

## FR-014 Deduplication

Preferred key: `source + sourceJobId`. Fallback: fingerprint of `company + title + location + description`.

## FR-015 New Job Identification and Ghost Job Detection (amended in v2.2)

Each job tracks `firstSeenAt`, `lastSeenAt`, and `missedCycles`.

**New job identification:** On each collection cycle for a source, newly fetched jobs receive `firstSeenAt = now` and are eligible for matching against every user.

**Ghost Job Detection:** For every job belonging to the source currently being collected:

1. If the job's `sourceJobId` appears in the latest fetch, set `missedCycles = 0` and update `lastSeenAt = now`.
2. If the job's `sourceJobId` does **not** appear in the latest fetch, increment `missedCycles` by 1.
3. If `missedCycles` reaches **3** and the job's status is `ACTIVE`, set status to `REMOVED`.

`REMOVED` jobs are excluded from matching and notification but retained for application history. If a `REMOVED` job reappears on the source, it returns to `ACTIVE` and `missedCycles` resets to 0.

## FR-016 Search / FR-017 Filters

Keyword search across title, description, skills, company. Filters: location, remote status, employment type, experience, salary, date posted, source, company, required skill, match score. Search results exclude `EXPIRED` and `REMOVED` jobs by default.

---

# 19. Matching Engine (runs per user)

## FR-018 Job Matching

Matching runs once per active user against every new `ACTIVE` job. A new job entering the database triggers up to N match calculations (N = number of active users). Factors considered: role, skills, experience, location (against that user's priority tiers), employment type, salary, remote preference, user exclusions. Only jobs with status `ACTIVE` are matched.

## FR-019 Match Score

Score 0–100. Example weighting (configurable):

```
Role compatibility       25%
Skill compatibility      30%
Experience compatibility 15%
Location compatibility   15%
Employment type           5%
Freshness                 5%
Salary compatibility      5%
```

### FR-019a Stored, Explainable Score

Each `JobMatch` record stores: `score, roleScore, skillScore, experienceScore, locationScore, matchedSkills, missingSkills, reasons, matcherVersion, userId, jobId`.

### FR-019b Freshness Decay

```
freshnessScore = baseFreshness × exp(-hoursSincePosted / τ)
```

A 95% match posted days ago may rank below an 89% match posted minutes ago, for every user independently.

## FR-020 Negative Criteria

E.g. `Senior, Lead, Manager, 5+ years, On-site` — reduces score or excludes, per user's own exclusions.

## Match Categories

`90–100 Excellent · 80–89 Strong · 70–79 Good · 60–69 Possible · 0–59 Low`. Only matches above each user's configured threshold trigger immediate notification.

---

# 20. AI Job Analysis (optional, post-MVP)

## FR-021 / FR-022

Local AI (e.g. Ollama) may assist with skill equivalence, seniority, and transferable-skill judgment, returning structured JSON. Fully optional — if unavailable, rule-based matching continues unaffected.

---

# 21. Notification System (routed per user)

## FR-024 Notifications

The system shall notify a user when, for that user:

```
Match score >= their configured threshold
AND job has not previously been notified to them
AND job status is ACTIVE
AND notifications are not paused
```

Delivery goes to Telegram if linked (FR-025), otherwise to the Web Inbox (FR-024c).

## FR-024a Channel Abstraction

```
interface NotificationChannel {
  send(userId: string, match: JobMatch): Promise<DeliveryResult>;
}
```

MVP implements `TelegramChannel` and `WebInboxChannel`. `EmailChannel` plugs in during Phase 3 without touching the matcher or queues.

## FR-024b Rate Limiting (amended in v2.2)

Two tiers of rate limiting protect delivery:

1. **Global limit:** The notification queue shall not exceed **25 messages per second across all users combined**. This stays safely under the Telegram Bot API global limit (~30 messages/second) and prevents temporary bot bans during large job drops.
2. **Per-chat limit:** A minimum interval of **1.2 seconds** between messages to the same `chatId`.
3. **Backoff:** On HTTP 429 from the Bot API, honor `retry_after` with exponential backoff.
4. **Burst collapse:** Bursts above a soft cap are collapsed into the daily digest when the digest is enabled.

## FR-024c Web Inbox Fallback (new in v2.2)

If a user has **no** `TelegramLink`, or if Telegram delivery **fails permanently** (e.g. the user blocked the bot, the chat is unreachable, or repeated 429/403 errors exhaust retries), the system shall:

1. Create a `Notification` record with `channel = WEB` and `status = UNREAD_WEB`.
2. Surface the notification in the user's `/inbox` page (§32.10).
3. Show an unread-count badge in the web navigation.
4. Mark the notification `READ` when the user views it.

No qualifying match is ever silently lost.

## FR-025 Telegram Alert

```
🔥 NEW JOB MATCH — Strong (92%)

Junior Backend Developer
Company: Example Technologies
Location: Remote · Full-time

💡 Why: Matches your Backend Developer goal —
3 of your 4 core skills, remote, junior level.

✓ Node.js  ✓ TypeScript  ✓ PostgreSQL
Missing: AWS

Apply:
[Original Job Link]

[Save] [Reject] [Apply] [Open]
```

Sent to the `chatId` from that user's `TelegramLink` record — never broadcast.

### FR-025a Interactive Notifications

Inline keyboard: `[Save] [Reject] [Apply] [Open]`. Callback queries are matched back to the `(userId, jobId)` pair via the `chatId → userId` lookup, and stored as feedback.

### FR-025b Telegram Command Interface

The bot supports commands as complement/fallback to inline buttons, all scoped through `chatId → userId`:

```
/start [code]   → link account (or welcome message if already linked)
/status         → link status + today's match counts
/saved          → this user's saved jobs (latest 10)
/pause          → pause notifications (sets notificationsPaused)
/resume         → resume notifications
/cancel         → exit any in-progress flow
/help           → usage instructions
```

Every command from an unlinked chat receives a linking prompt.

### FR-025c Match Summary Line

Each alert includes one human-readable sentence derived deterministically from stored `JobMatch.reasons`. Rule-based in MVP; local-AI phrasing optional in Phase 2.

## FR-026 Notification Configuration (per user)

Threshold, frequency, preferred channel, daily digest on/off, max notifications/day.

**Threshold live projection:** the settings UI shows projected weekly alert volume for the selected threshold, computed from the user's recent match history. Endpoint: `GET /api/settings/notifications-preview?threshold=N`.

## FR-027 Duplicate Notifications

No repeat notification for the same `(userId, jobId)` pair unless explicitly re-requested. Tracked via `notificationStatus` / `notifiedAt`.

## FR-028 Daily Digest (per user)

Daily report: jobs collected, new jobs, strong/excellent matches, top matches by score — delivered to Telegram and rendered as a dashboard card.

---

# 22. Saved Jobs, Rejections, Applications, Search Profiles

All scoped by `userId`.

- **FR-029 Save Job** — `GET /saved` returns this user's saved jobs only.
- **FR-030 Reject Job** — recorded per user, feeds future ranking.
- **FR-031 / FR-032 Application Tracking** — pipeline `Discovered → Saved → Applied → Assessment → Interview → Offer/Rejected/Withdrawn`, per user, rendered as a status board (§32.6).
- **FR-033 Saved Search Profiles** — reusable named searches per user, auto-executed.

---

# 23. Background Processing & Scheduling

## FR-034 Background Jobs

Async processing for collection, normalization, per-user matching, profile-recalculation, notifications, digest, and retention. MVP uses `@nestjs/schedule`; Redis/BullMQ deferred to Phase 2.

## FR-034a Expiration Sweeper (new in v2.2)

A scheduled task runs every **6 hours** (configurable) and executes:

```sql
UPDATE "Job"
SET "status" = 'EXPIRED'
WHERE "deadline" < NOW()
  AND "status" = 'ACTIVE';
```

This guarantees the matcher never evaluates a job past its deadline, even if the source website fails to remove it. Jobs with a `NULL` deadline are not swept; they rely on Ghost Job Detection (FR-015) and freshness decay (FR-019b). The sweeper logs the number of jobs transitioned.

## FR-035 Scheduled Collection

Configurable interval (e.g. every 30 minutes). Avoids excessive requests to sources.

## FR-036 Retry Mechanism

Source-level failures are retried and isolated — one source failing does not block others or block per-user matching of jobs from healthy sources.

## FR-037 Source Health Monitoring

`SourceRun` records every collection attempt: `source, startedAt, finishedAt, status, jobsFetched, jobsCreated, duplicates, errors, errorMessage`.

## FR-037a MatchCycle Funnel Metrics

Every collection cycle records a `MatchCycle`:

```
startedAt, finishedAt, jobsEvaluated, usersProcessed,
matchesCreated, matchesAboveThreshold,
notificationsSent, notificationsFailed, notificationsToInbox, errors
```

Button callbacks increment `actionsTaken` counters (saved/rejected/applied).

## FR-037b Retention Archiver (new in v2.2)

A scheduled task runs **nightly** and enforces the Data Retention & Archiving Policy (§25.2). It logs the number of jobs archived.

---

# 24. API Requirements

```
/api/auth              register, login, password change
/api/profile           per-user, scoped via JWT
/api/profile/cv        CV upload/download/delete
/api/telegram          link-code (returns deepLink), status, unlink
/api/jobs              list, detail, search
/api/matches           per-user matches, detail, recalculate
/api/saved-jobs        per-user
/api/applications      per-user
/api/notifications     per-user history + inbox
/api/inbox             per-user web inbox (UNREAD_WEB)
/api/searches          per-user saved searches
/api/settings          per-user: threshold, frequency, paused, notifications-preview
/api/sources           ADMIN: list, create, update, disable, collect
```

### Auth
```
POST  /api/auth/register
POST  /api/auth/login
PATCH /api/auth/password
```

### Profile & CV
```
GET    /api/profile
PATCH  /api/profile            (triggers recalc hook on core fields)
POST   /api/profile/cv
GET    /api/profile/cv
DELETE /api/profile/cv
```

### Telegram
```
POST   /api/telegram/link-code   → { code, expiresAt, deepLink }
GET    /api/telegram/status
DELETE /api/telegram/link
```

### Jobs / Matching
```
GET  /api/jobs
GET  /api/jobs/:id
GET  /api/jobs/search
GET  /api/matches
GET  /api/matches/:id
POST /api/matches/recalculate
```

### Sources (ADMIN only)
```
GET   /api/sources
POST  /api/sources
PATCH /api/sources/:id
POST  /api/sources/:id/collect
```

### Settings & Inbox
```
GET   /api/settings
PATCH /api/settings
GET   /api/settings/notifications-preview?threshold=N
GET   /api/inbox
PATCH /api/inbox/:id/read
```

Every route except `/api/auth/register` and `/api/auth/login` requires a valid JWT. Every user-scoped handler derives the acting user from `req.user.id`. Source routes additionally require `req.user.role === 'ADMIN'`.

---

# 25. Database Requirements

```
User                 id, email, passwordHash, role (Enum: USER, ADMIN),
                     locale (default "en"), notificationsPaused (default false),
                     pausedUntil?, createdAt
CandidateProfile     FK userId (1:1)
CvFile               id, userId, filePath, originalName, uploadedAt
TelegramLink         id, userId, chatId (unique), linkedAt
Skill
CandidateSkill
TargetRole
LocationPreference
Job                  id, title, description, company, location, remoteStatus,
                     employmentType, experienceLevel, salary, currency, url,
                     sourceId, sourceJobId, postedDate, deadline,
                     firstSeenAt, lastSeenAt, missedCycles (default 0),
                     status (Enum: ACTIVE, EXPIRED, REMOVED),
                     parseConfidence, archivedAt?, fingerprint, rawData (JSONB)
JobSkill
Company
JobSource            id, name, type, baseUrl, status, priorityTier,
                     collectionFrequency, lastSuccessfulRun, lastFailedRun, lastError
SourceRun
SkillRelationship
JobMatch              FK userId AND jobId (+ scores, reasons, matcherVersion)
SavedJob             FK userId, jobId
Application          FK userId, jobId
Notification         id, userId, jobId, channel (Enum: TELEGRAM, WEB),
                     status (Enum: PENDING, SENT, FAILED, UNREAD_WEB, READ),
                     createdAt, sentAt?
SearchProfile        FK userId
MatchCycle
SystemLog
```

`JobMatch` is the central per-user/per-job join. `Notification` records delivery channel and outcome, powering both Telegram history and the Web Inbox.

## 25.1 Core Database Relationships

```
User
 ├── CandidateProfile (1:1)
 │     ├── CandidateSkill
 │     ├── TargetRole
 │     └── LocationPreference
 ├── CvFile (1:many)
 ├── TelegramLink (1:1)
 ├── JobMatch (1:many)
 ├── SavedJob (1:many)
 ├── Application (1:many)
 ├── Notification (1:many)
 └── SearchProfile (1:many)

Job (shared across all users)
 ├── Company
 ├── JobSource
 ├── JobSkill
 ├── JobMatch (1:many)
 ├── SavedJob (1:many)
 ├── Application (1:many)
 └── Notification (1:many)
```

## 25.2 Data Retention & Archiving Policy (new in v2.2)

To prevent unbounded growth of the `rawData` JSONB payload while preserving application history:

1. **Eligibility:** A job is eligible for archiving when its status is `EXPIRED` or `REMOVED`, it has been in that state for more than **90 days**, and it has **no** linked `Application` records and **no** linked `SavedJob` records.
2. **Archival action:** For eligible jobs, the system sets `archivedAt = now` and purges the bulky `rawData` and `description` fields (sets them to `NULL`). The `Job` row itself, along with its title, company, and metadata, is **retained** so that foreign keys from `JobMatch` and any historical references remain valid.
3. **Preservation:** Jobs that have at least one linked `Application` or `SavedJob` are **never** purged, regardless of age, so a user's application history always resolves to full job details.
4. **No hard delete:** The MVP never hard-deletes a `Job` row. Hard deletion or movement to a separate cold-storage table is a Phase 3 optimization.

---

# 26. Non-Functional Requirements

## NFR-001 Performance
API requests < 500ms under normal local conditions. Job collection, per-user matching, recalculation, and notifications run asynchronously so they never block the API.

## NFR-002 Scalability
The architecture allows additional job sources without redesigning the schema. Multi-user matching is O(users × new jobs) per collection cycle — the key scaling factor. If the user base grows past a few dozen, move matching to a queue (Phase 2 BullMQ).

## NFR-003 Availability
MVP operates while the host machine is running. Cloud deployment (Phase 3) provides continuous availability.

## NFR-004 Reliability
A failure in one job source does not stop collection from others. A failure matching one user's profile does not stop matching for other users. A failure delivering one notification does not block others.

## NFR-005 Security
- Passwords hashed with bcrypt (never plain text, never logged).
- All non-auth routes protected by JWT guards.
- Admin routes protected by role guards.
- Users can access only their own profile, CV, matches, saved jobs, applications, notifications, search profiles, and Telegram link.
- CV files stored in per-user directories; file access endpoints verify ownership before serving.
- Telegram link codes are single-use and time-limited.
- Input validation on all endpoints (class-validator DTOs).
- Secrets via environment variables, never committed to Git.

## NFR-006 Performance Budget — Low-Bandwidth
- Initial JS payload < 200 KB gzipped on core routes.
- LCP < 3 s on simulated 3G.
- Skeleton loaders on all async lists; no layout shift.
- Images via `next/image` with lazy loading; no autoplay media.
- Job list/detail pages statically rendered (SSG/ISR) where auth permits.
- Total page weight < 1 MB.

## NFR-007 Accessibility & Localization
- WCAG 2.1 AA: contrast ≥ 4.5:1, keyboard-operable controls, focus states.
- Touch targets ≥ 44×44 px.
- All user-facing strings externalized for i18n from day one; English MVP; Amharic Phase 2; `User.locale` persisted.

# 27. Privacy Requirements

The system shall minimize collection of personal information. Profile and CV data are used only for job matching, recommendations, notifications, and application tracking. Private candidate information (including the CV file itself) is never exposed to job sources or to other users. It is only shared externally if the user explicitly clicks through to apply on the source's own site.

# 28. External System Requirements

Job APIs, RSS feeds, public job pages, company career pages, Telegram, Ollama (optional), PostgreSQL. Each integration is isolated behind an adapter/service so a source or channel can be swapped without touching core logic.

# 29. Data Collection Ethics

Respect rate limits. No authentication bypass, CAPTCHA bypass, or anti-bot circumvention. Collect and store only information required for job discovery and matching — this applies equally to job postings and to user account data.

# 30. Error Handling & Logging

**External errors:** network failure, timeout, HTTP error, rate limit, invalid response.
**Internal errors:** database failure, parsing failure, validation failure, queue failure, AI failure, notification failure, auth failure, role failure.

Structured logs, e.g.:

```
[AUTH] User registered: userId=42 role=USER
[COLLECTOR] Source: ReliefWeb — Retrieved: 52 jobs
[NORMALIZER] Valid: 49 · Invalid: 3 · AvgConfidence: 84
[GHOST] Marked 2 jobs REMOVED (missedCycles >= 3)
[SWEEPER] Marked 5 jobs EXPIRED (deadline passed)
[MATCHER] userId=42 → Excellent: 2, Strong: 5
[RECALC] userId=42 recalculated against 1000 jobs after profile update
[NOTIFICATION] userId=42 → Telegram: 2 · Inbox: 0 · Failed: 0
[BOT] /pause from chatId=8821 → userId=42
[RETENTION] Archived 12 orphaned jobs (purged rawData)
```

# 31. Configuration

```
DATABASE_URL=
REDIS_URL=

JWT_SECRET=
JWT_EXPIRES_IN=7d

ADMIN_EMAILS=

TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=JobHunterBot
TELEGRAM_GLOBAL_RATE_PER_SEC=25
TELEGRAM_PER_CHAT_INTERVAL_MS=1200

CV_UPLOAD_DIR=./uploads/cv
CV_MAX_SIZE_MB=5

JOB_COLLECTION_INTERVAL=
MATCH_THRESHOLD=
PARSE_CONFIDENCE_MIN=40
GHOST_MISSED_CYCLE_LIMIT=3
EXPIRATION_SWEEP_INTERVAL=6h
RETENTION_DAYS=90
RECALC_JOB_LIMIT=1000
```

Secrets are never committed to Git.

---

# 32. Frontend Requirements

Responsive: desktop, tablet, mobile browser. Mobile-first for candidate-facing flows (NFR-006).

Main pages:

```
/register · /login · /dashboard · /profile · /profile/cv
/settings/telegram · /settings/notifications
/jobs · /jobs/:id · /matches · /saved · /applications · /searches
/inbox · /sources (ADMIN)
```

Unauthenticated users are redirected to `/login` for any page except `/register` and `/login`. Non-admin users accessing `/sources` see a 403 message.

## 32.1 Dashboard
Opens with a personalized greeting, followed by: horizontal match carousel, profile-completion meter (if < 100%), Telegram connection banner (if unlinked), saved jobs, applications summary, upcoming interviews, recent notifications, and unread Inbox badge.

## 32.2 Job Card
```
┌──────────────────────────────────────┐
│ Junior Backend Developer      92%    │
│ ABC Technologies                     │
│ Remote · Full-time · Posted 2h ago   │
│                                      │
│ ✓ Node.js ✓ TypeScript ✓ PostgreSQL  │
│                                      │
│ [View] [Save] [Apply]                │
└──────────────────────────────────────┘
```
Score badge uses category color. Low-confidence parses show a subtle flag.

## 32.3 Application Pipeline
`DISCOVERED → SAVED → APPLIED → ASSESSMENT → INTERVIEW → OFFER`; rejected/withdrawn shown separately, per user.

## 32.4 Match Feed
`/matches`: ranked card list sorted by score then freshness, with filter chips (All / Excellent / Strong / Unseen). Focus Mode is Phase 2.

## 32.5 Explainable Match Panel
On `/jobs/:id` and `/matches/:id`, for the logged-in user:
- Score gauge (0–100) with category label.
- Category breakdown bars: Role, Skills, Experience, Location, Employment, Freshness, Salary — each showing achieved/max.
- Skill chips: matched (green ✓), missing (amber ✗), related-via-graph (blue).
- One-line natural-language summary.
- Expandable "Why this score?" list from stored `reasons`.
- Freshness indicator.

## 32.6 Applications Board
Status board with one column per FR-031 stage. Cards show job title, company, days-in-stage, and follow-up date. MVP: status change via dropdown. Drag-and-drop is Phase 2. Rejected applications in a collapsible section.

## 32.7 Onboarding Wizard
Per FR-003d: 3 steps with tap-to-select chips; skippable; resumable via banner; completion meter persists until 100%.

## 32.8 Empty States
Every list renders a designed empty state with an icon, message, and CTA. First-run experience must never show a blank page.

## 32.9 Telegram Settings Page
`/settings/telegram`: link status, one-tap deep-link button, raw code with copy button as fallback, expiry countdown, unlink option, and instructions.

## 32.10 Web Inbox (new in v2.2)
`/inbox`: lists all `UNREAD_WEB` and `READ` web notifications, newest first. Each entry renders the job card, the match summary line, the match score, and action buttons (Save / Reject / Apply / Open). A navigation badge shows the unread count. Opening an entry marks it `READ`.

## 32.11 Admin Source Dashboard (new in v2.2)
`/sources` (ADMIN only): lists all job sources with status, priority tier, last successful/failed run, and error message. Provides buttons to enable/disable a source and to trigger a manual collection. Shows recent `SourceRun` history.

---

# 33. Security Architecture

```
Client
 ↓ (email + password)
POST /api/auth/login
 ↓
bcrypt.compare()
 ↓
JWT issued (payload: { sub: userId, role })
 ↓
Client stores token, sends as Bearer header on every request
 ↓
NestJS AuthGuard('jwt') validates + attaches req.user
 ↓
RolesGuard checks @Roles('ADMIN') where required
 ↓
Controller / Service uses req.user.id to scope every query
```

Authorization ensures users can access only their own data. This is enforced at the service layer (every query includes `WHERE userId = :currentUserId`), not just the route layer. Role elevation is enforced by `RolesGuard`; a `USER` cannot invoke admin endpoints even with a valid JWT. The Telegram bot applies the same principle: every callback and command resolves `chatId → userId` before touching data; an unknown `chatId` receives only public help/linking content.

---

# 34. Testing Requirements

- **Unit tests:** password hashing, JWT generation/validation, role assignment, matching-score calculation, skill normalization, parse-confidence calculation, summary-line generation, threshold projection, ghost-job counter, retention eligibility.
- **Integration tests:**
  - register → login → wizard → profile → CV → Telegram link (deep-link variant) → collect job → verify match created for the correct user only.
  - first registered user receives `ADMIN`; second receives `USER`.
  - `USER` calling `/api/sources` receives 403.
- **Lifecycle tests:**
  - A job absent from its source for 3 consecutive cycles transitions to `REMOVED`.
  - A job whose deadline passes transitions to `EXPIRED` via the sweeper.
  - An archived orphan job has `rawData` purged but the row retained; a job with an `Application` is never purged.
- **Recalculation test:** updating a user's skills triggers recalculation against recent active jobs and produces updated matches.
- **Notification tests:**
  - Two users with different profiles receive different notifications for the same job.
  - An unlinked user receives an `UNREAD_WEB` inbox entry instead of a Telegram message.
  - A burst of matches respects the 25 msg/sec global limit.
- **Authorization boundary test:** User A's JWT cannot read User B's profile/CV/matches; User A's Telegram commands never return User B's data.

---

# 35. Acceptance Criteria (MVP)

The MVP is accepted when:

```
[✓] A new user can register and log in (under 60 seconds)
[✓] The first registered user is auto-promoted to ADMIN
[✓] A USER receives 403 on all /api/sources endpoints
[✓] Onboarding wizard + completion meter functional
[✓] A logged-in user can build a profile and upload a CV with progress feedback
[✓] Updating core profile fields triggers match recalculation
[✓] Deep-link button opens Telegram with code pre-filled; linking completes on one tap
[✓] Manual code entry works as fallback
[✓] /status /saved /pause /resume respond correctly, scoped to sender's chatId
[✓] User A cannot see User B's profile, CV, or matches under any circumstance
[✓] At least one Ethiopian job source collects real postings automatically
[✓] Jobs are normalized, validated, confidence-scored, deduplicated
[✓] A job absent for 3 cycles is marked REMOVED
[✓] A past-deadline job is marked EXPIRED by the sweeper
[✓] Every new ACTIVE job is matched against every active user's profile
[✓] Match detail page renders the explainable panel matching stored scores
[✓] Each user above threshold receives a Telegram alert in THEIR OWN chat,
    with summary line and [Save][Reject][Apply][Open]
[✓] An unlinked user receives the match in their Web Inbox instead
[✓] Notification bursts respect the global 25 msg/sec limit
[✓] Button presses are recorded against the correct (userId, jobId) pair
[✓] Old orphaned expired jobs have rawData purged after 90 days;
    application-linked jobs are retained in full
[✓] Core routes meet NFR-006 performance budget
[✓] All list views render designed empty states
```

---

# 36. MVP Definition

The MVP shall contain:

```
✓ PostgreSQL + Prisma (with role, missedCycles, parseConfidence,
  archivedAt, Notification channel/status, MatchCycle)
✓ NestJS with multi-user auth + role guards (register, login, JWT, bcrypt)
✓ Per-user candidate profile + CV upload + onboarding wizard
✓ Profile update recalculation hook
✓ Per-user Telegram account linking (deep-link + code fallback + persona)
✓ Telegram command interface
✓ Web Inbox fallback
✓ ReliefWeb (or EthioNGOJobs) as the first permitted Ethiopian source
✓ Job collector, normalization + extraction, parse confidence, validation, dedupe
✓ Ghost Job Detection + Expiration Sweeper
✓ SourceRun + MatchCycle records, rawData JSONB retention
✓ Data Retention Archiver
✓ Rule-based matching engine run PER USER with stored, explainable scores
✓ Explainable match panel in web UI
✓ Telegram notification with global + per-chat rate limiting
✓ Applications status board
✓ NestJS scheduler for collection + matching + sweeping + retention
```

The MVP shall NOT require:

```
✗ Redis / BullMQ (Phase 2)
✗ Focus Mode (Phase 2)
✗ Drag-and-drop kanban (Phase 2)
✗ Amharic localization (Phase 2)
✗ Email channel implementation (Phase 3; abstraction exists)
✗ Next.js dashboard beyond the listed pages
✗ Email-based password reset
✗ Social login
✗ Paid AI
✗ Cloud infrastructure
✗ Mobile application
✗ Advanced machine learning / semantic matching
✗ Payment system
```

---

# 37. Phase 2 Requirements

Redis / BullMQ for background matching at scale; AI analysis (Ollama); Focus Mode match review; drag-and-drop applications board; Amharic localization; application tracking enhancements; saved searches auto-run; daily digest expansion; advanced filters; source health dashboard; behavioral learning; email-based password reset.

# 38. Phase 3 Requirements

Personalized ranking (learned); resume parsing (auto-extract skills from uploaded CV); cover-letter assistance; skill-gap analysis; application analytics; interview tracking; email notification channel; mobile PWA; cloud deployment; social login (OAuth); cold-storage table for archived jobs.

---

# 39. Recommended Repository Structure

```
jobhunter/
│
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── auth/            register, login, JWT strategy, guards, roles
│   │   │   ├── profile/         includes CV upload + onboarding + recalc hook
│   │   │   ├── telegram/        link-code flow, bot webhook, commands, persona
│   │   │   ├── jobs/
│   │   │   ├── sources/         ADMIN-only
│   │   │   ├── matching/        iterates users; recalculation service
│   │   │   ├── lifecycle/       ghost detector, expiration sweeper, retention
│   │   │   ├── notifications/   channel abstraction, rate limiter, inbox
│   │   │   └── settings/
│   │   ├── prisma/
│   │   ├── uploads/cv/          per-user CV storage (gitignored)
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── web/
│       ├── app/
│       │   ├── (auth)/register · (auth)/login
│       │   ├── profile/ · settings/telegram/ · settings/notifications/
│       │   ├── matches/ · jobs/ · applications/ · saved/ · inbox/
│       │   ├── sources/         (ADMIN)
│       │   └── dashboard/
│       ├── components/
│       ├── lib/
│       └── package.json
│
├── packages/
│   ├── shared/ · types/ · config/
│
├── docs/
│   ├── SRS.md · architecture.md · database.md · api.md · deployment.md
│
├── docker-compose.yml · .env.example · .gitignore · README.md · package.json
```

---

# 40. MVP Implementation Sequence

## Milestone 1 — Foundation + Auth + Roles
```
Monorepo (npm workspaces)
    ↓
NestJS API package
    ↓
PostgreSQL + Prisma
    ↓
User schema (with role enum), CandidateProfile, CvFile, TelegramLink,
Job (with missedCycles, parseConfidence, archivedAt), JobSource,
SourceRun, MatchCycle, Notification schemas
    ↓
Auth module: register (role assignment), login, bcrypt, JWT strategy,
AuthGuard, RolesGuard
```
**Done when:** register/login work; first user is ADMIN; protected routes scope by user; a USER gets 403 on admin routes.

## Milestone 2 — Profile, CV, Telegram Linking, Recalc
```
Onboarding wizard + completion meter
    ↓
Profile update endpoints + recalculation hook
    ↓
CV upload (Multer) → CvFile record
    ↓
Telegram bot registered with BotFather
    ↓
Link-code endpoint (returns deepLink) + bot webhook handler
    ↓
TelegramLink record created on /start CODE
```
**Done when:** two users each link their own Telegram; updating skills triggers recalculation; a targeted test message reaches only the intended user.

## Milestone 3 — First Ethiopian Source + Lifecycle, End-to-End
```
ReliefWeb v2 (or EthioNGOJobs wp-json) adapter
    ↓
Fetch → Normalize → Validate → Confidence-score → Deduplicate → Store
    ↓
Ghost Job Detector + Expiration Sweeper active
    ↓
SourceRun recorded
```
**Done when:** `npm run collect` prints real counts; the Job table is populated; a hidden job becomes REMOVED after 3 cycles; a past-deadline job becomes EXPIRED.

## Milestone 4 — Per-User Explainable Matcher
```
Skill dictionary + aliases
    ↓
Role / seniority / experience / location extraction
    ↓
Deterministic matcher — loops over all active users for each new ACTIVE job
    ↓
Explainable, stored JobMatch per (userId, jobId)
```
**Done when:** the same job produces different, correctly-explained scores for two users; the explainable panel renders them.

## Milestone 5 — Notifications, Inbox, Commands, Retention
```
High-score JobMatch (per user)
    ↓
Notification service: Telegram (rate-limited) or Web Inbox
    ↓
Telegram message + [Save][Reject][Apply][Open] inline keyboard
    ↓
Commands (/status /saved /pause /resume /help)
    ↓
Callback stored against (userId, jobId)
    ↓
Retention Archiver active
```
**At this point, the JobHunter multi-user MVP exists.**

## After the MVP
Next.js dashboard expansion → additional sources → Redis/BullMQ → Focus Mode + drag-and-drop → Amharic → saved searches, analytics → local AI, semantic matching, behavioral learning → email reset, social login, email channel.

---

# 41. MVP Completion Definition

The MVP is complete when this works automatically, **for more than one registered user**:

```
        NEW JOB (shared pool)
                ↓
          Job Collector
                ↓
   PostgreSQL + confidence score
                ↓
        Duplicate Check
                ↓
   Lifecycle: Ghost Detector + Expiration Sweeper
                ↓
   ┌────────────┴────────────┐
   ▼                          ▼
Match vs User A          Match vs User B
   │                          │
Score = 87%               Score = 41%
   │                          │
Above threshold           Below threshold
   │                          │
Telegram → User A's chat  (no notification)
   │
User taps [Save] — or /saved — and it lands in
User A's (never User B's) saved list.
If User A had no Telegram, it lands in their Web Inbox.
```

---

# 42. Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Source ToS/structure change breaks a collector | Missing jobs | Adapter isolation (FR-008); `SourceRun` health alerts (FR-037); polite-rate compliance (§29) |
| Matching load O(users × jobs) degrades latency | Slow notifications | NFR-002 queue migration path; per-cycle caps; MatchCycle monitoring |
| Telegram per-chat and global rate limits | Missed/delayed alerts or bot ban | FR-024b global 25 msg/s + per-chat 1.2s + backoff + digest collapse |
| Over-notification fatigue → users unlink | Retention loss | Explainable scores; reject feedback (FR-030); `/pause`; threshold preview (FR-026) |
| Auto-apply-style products churn on low quality | Product-market failure | Explainable, user-decided matching — quality over volume (§3) |
| Low-confidence scraped data pollutes matches | Trust erosion | FR-012c parse confidence + UI flagging |
| Ghost/expired jobs sent to users | Wasted applications, distrust | FR-015 ghost detection + FR-034a expiration sweeper |
| Unbounded rawData growth crashes DB | Outage | §25.2 retention archiving (90-day orphan purge) |
| Unlinked users miss opportunities | Churn | FR-024c Web Inbox fallback |
| Stale matches after profile update | Irrelevant results | FR-003e recalculation hook |
| Unauthorized source management | Data integrity risk | FR-002d role guards; ADMIN-only source routes |
| Single-machine MVP availability | Downtime when host off | Accepted for MVP; Phase 3 cloud deployment |

---

# 43. MVP Success Metrics

Outcome KPIs measured from `MatchCycle`, `Notification`, and action logs:

- **Speed:** median `firstSeenAt → user notification` < 10 minutes.
- **Match quality:** save-or-apply rate on notified matches > 15% within 7 days.
- **Noise control:** reject rate < 30% of notifications.
- **Adoption:** ≥ 3 active users with linked Telegram by end of Milestone 5.
- **Data hygiene:** zero `ACTIVE` jobs past their `deadline`; zero notifications sent for `REMOVED`/`EXPIRED` jobs.
- **Delivery reliability:** zero Telegram 429 bans; 100% of undeliverable matches captured in Web Inbox.
- **Security:** zero cross-user or cross-role data exposures (continuous authorization-boundary tests).
- **Performance:** core routes meet NFR-006 budget on simulated 3G.

---

**End of document — JobHunter SRS v2.2 (Final Development Baseline)**

---
