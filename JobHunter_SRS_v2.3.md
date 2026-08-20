# SOFTWARE REQUIREMENTS SPECIFICATION
## Intelligent Job Search, Aggregation, Matching and Notification System

### Project Name
**JobHunter**

### Document Type
Software Requirements Specification (SRS)

### Version
**2.3 — User Lifecycle, Data Fidelity & Determinism Baseline**

### Status
Development Baseline

### Date
August 2026

---

# 0. Revision Summary

## 0.1 Changes in v2.3 (Current)

No requirement from v2.2 is removed or weakened. v2.3 integrates five audited patch sets:

1. **User lifecycle & security (G-U1…G-U6, C2, C3):** user status model + "active" definition (FR-001a); account deactivation/deletion (FR-002e); admin user management + role-assignment precedence (FR-002f, C3); authentication hardening — throttling, optional invite-code gate, `emailVerifiedAt` (FR-002g); stateless token revocation via `tokenInvalidatedAt` (FR-002h); dormant-user cost control (FR-003e2, FR-034d).
2. **Matcher determinism (G-M1):** FR-019c deterministic per-factor scoring rules; freshness τ default 72h; `MATCH_THRESHOLD` default 75.
3. **Description accuracy (D-1…D-10):** description provenance fields (FR-011); extraction & cleaning pipeline (FR-012d); description quality score (FR-012e); `parseConfidence` now includes description quality (FR-012c); normalized-description fingerprint (FR-014); adapter `fetchDetail` + selector configuration (FR-008); source quality metrics + selector-drift alert (FR-037).
4. **Apply-link integrity & field accuracy (L-1…L-10):** apply fields + `applyMethod` (FR-011); URL normalization (FR-012f); ingestion link validation (FR-013); Link-Rot Sweeper (FR-034c); notification liveness condition (FR-024); apply-method extraction + adaptive CTAs (FR-012g, FR-025, §32); field accuracy rules for deadline/salary/company/location (FR-012h); source link-health metrics (FR-037).
5. **Operations & consistency:** application transition graph (FR-031a, G-A1); saved-search auto-run deferred to Phase 2 (FR-033); per-source collection lock (FR-035a); deadline timezone rule (FR-034a); notification & log retention (FR-037c); CV versioning and upload hardening (FR-003a); DB index specification (§25.3); completion-meter field list (FR-003); digest default time (FR-028); backup & restore (NFR-008); CV-assisted pre-fill (FR-003f, Phase 2); Admin Console (§32.12); minors such as threshold/complexity defaults, CORS, designed 403/404 pages, TLS Phase 3, and optional consent.

## 0.2 Changes carried forward from v2.2

All v2.2 enhancements remain in force: formal role model; ghost-job detection; background expiration sweeping; data retention and archiving; global + per-chat Telegram rate limiting; profile update recalculation; Web Inbox fallback; onboarding wizard and profile-completion meter; Telegram deep-link linking and bot persona; parse-confidence scoring; notification channel abstraction; Telegram command interface; match summary line; threshold live projection; MatchCycle funnel metrics; low-bandwidth performance budget; accessibility and localization readiness; and the expanded frontend specifications (§32.4–§32.11).

## 0.3 Changes carried forward from v2.1 and v2.0

All earlier multi-user foundations remain in force: per-user scoping, user registration and authentication in the MVP, Telegram account linking, CV upload as a first-class requirement, and the reordered milestone sequence.

# 1. Introduction

## 1.1 Purpose

This SRS defines the functional, non-functional, technical, and operational requirements for **JobHunter**, an automated, **multi-user** job-search and job-notification system focused primarily on the Ethiopian job market.

The system automatically discovers job opportunities from permitted Ethiopian and international sources, collects and normalizes them, removes duplicates, validates description and apply-link fidelity, evaluates each posting against **every active user's** career profile, ranks opportunities by **deterministic, explainable scoring**, and notifies each user individually when a suitable job is found — through a Telegram bot linked specifically to that user's account, or through the web Inbox when Telegram is unavailable.

**JobHunter is Ethiopia-first; remote and international are secondary.** Priority 1 is Ethiopian opportunities. Priority 2 is remote work. Priority 3 is international relocation markets (USA, Canada, UK, Netherlands, and others).

**Core promise in v2.3:** every job a user sees should be complete enough to evaluate, traceable to its source, and reachable through a live apply link or a valid non-URL apply method. Description and link integrity are treated as first-class ingestion concerns.

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
| **Dormant User** | A user whose status changes to `DORMANT` after `DORMANT_AFTER_DAYS` without activity; dormant users are skipped by per-cycle matching and recalculated on login. |
| **Link-Rot** | An apply URL that previously worked but later returns an invalid response such as HTTP 404 or 410. |
| **Apply Method** | The mechanism required to apply: `ONLINE_URL`, `EMAIL`, `IN_PERSON`, `SOURCE_ACCOUNT`, or `PDF_FORM`. |
| **Description Quality** | A 0–100 measure of the completeness, cleanliness, structure, and usability of an extracted job description. |
| **Token Invalidation** | Server-side rejection of JWTs issued before `User.tokenInvalidatedAt`. |

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
20. Search-profile management. MVP supports creating and **manually running** saved searches; automatic scheduled search execution is Phase 2.
21. Background job processing and scheduling.
22. Source health monitoring and match-cycle funnel metrics.
23. System logging.
24. Error handling and retry mechanisms.
25. Dashboard and analytics (post-MVP expansion).
26. Account lifecycle management (deactivate/delete, dormancy).
27. Admin user management.
28. Description-accuracy pipeline and provenance tracking.
29. Apply-link integrity and link-rot detection.
30. Deterministic factor scoring.
31. Application transition enforcement.
32. Backup and restore.

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
- Email verification **flow** (field exists in MVP; flow Phase 2).
- CV-assisted pre-fill (Phase 2).
- Admin analytics dashboard (Phase 2).
- Saved-search auto-run (manual run is MVP; auto-run Phase 2).

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
- Guarantee apply-link liveness before an online-URL notification is delivered.
- Enforce account lifecycle controls and token revocation.
- Compute match sub-scores deterministically.
- Back up application state nightly and verify restore capability.

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

One or more administrators who manage job sources, monitor source health, and trigger manual collection. In the MVP, the first registered user is auto-promoted to `ADMIN` only when `ADMIN_EMAILS` is empty.

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

## 7.6 Storage Constraint

CV files shall be stored **outside the web root**. Uploaded content shall never be executed by the application and shall be served only as file attachments with appropriate ownership checks.
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
NestJS scheduler (`@nestjs/schedule`) for MVP. Redis + BullMQ deferred to Phase 2. Lifecycle workers include expiration, dormancy, link-rot checks, retention, and backup jobs.

### Job Collection
REST APIs, RSS, JSON feeds, Cheerio, Playwright where permitted. Source adapters may expose a detail-page fetch path and per-source selectors for description recovery.

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

### Supporting Utilities
Local PDF text extraction (for PDF rescue and Phase 2 CV-assisted pre-fill), Cheerio-based cleaning, and a static FX table in `packages/config`.

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
13. Profile updates trigger a targeted recalculation for that user
14. High-scoring matches enter the notification queue (global + per-chat limited)
15. Notification service sends alert to the user's Telegram, or stores UNREAD_WEB; online-URL notifications require a live apply link
16. User acts via buttons or commands (save / reject / apply / pause)
17. Application transitions are validated against the allowed state graph
18. Action stored against (userId, jobId); feeds funnel metrics and future ranking
19. Nightly lifecycle tasks handle dormancy, notification/log retention, and backups; the daily link-rot sweep rechecks active apply URLs.
```

---

# 11. Functional Requirements — Accounts, Roles & Lifecycle

## FR-001 User Registration and Role Assignment

The system shall allow a new user to register with:

```
Email (unique)
Password (min 8 chars; complexity rule configurable)
```

On registration:

1. Validate the email is not already registered.
2. Hash the password with bcrypt (never store plain text).
3. **Determine the role with explicit precedence:**
   - If `ADMIN_EMAILS` is non-empty, **only** emails in that configuration become `ADMIN`.
   - If `ADMIN_EMAILS` is empty, the first user ever registered becomes `ADMIN`.
   - All other registrations become `USER`.
4. Create a `User` record with the assigned role and `status = ACTIVE`.
5. Create an empty `CandidateProfile` linked to that user.
6. Return a JWT access token so the user is immediately logged in.

```
POST /api/auth/register
Body: { email, password, inviteCode? }
Response: { accessToken, user: { id, email, role, status } }
```

## FR-001a User Status Model

`User.status` shall be one of:

`ACTIVE | DORMANT | DISABLED | DELETED`

Default is `ACTIVE`. The system shall maintain `lastActiveAt`, updated on login and authenticated API activity.

**Active user for matching = `status = ACTIVE`.** `DISABLED` and `DELETED` users cannot log in, receive notifications, or participate in matching. `DORMANT` users are skipped by per-cycle matching and reactivate on login via FR-003e2.

## FR-002 User Login

```
POST /api/auth/login
Body: { email, password }
Response: { accessToken, user: { id, email, role, status } }
```

The system shall verify the password against the stored bcrypt hash using `passport-local`, then issue a signed JWT (via `passport-jwt`) containing `userId`, `role`, and standard `iat` claims.

### FR-002a Session Handling

- JWT expires after a configurable window (e.g. 7 days for MVP simplicity; refresh tokens are a Phase 2 concern).
- Every protected route is guarded by a NestJS `AuthGuard('jwt')`.
- The guard attaches `req.user.id` and `req.user.role` so every service call is automatically scoped to the correct user.

### FR-002b Logout

Logout is client-side (discard the token). Server-side invalidation is performed when a security-sensitive lifecycle action requires it (FR-002h).

### FR-002c Password Reset (MVP-simplified)

Full email-based password reset is deferred. MVP requirement: an authenticated user can change their password by supplying their current password (`PATCH /api/auth/password`). A lost-password flow is a Phase 2 item.

### FR-002d Role-Based Access Control

- A `RolesGuard` shall enforce route-level role requirements via a `@Roles('ADMIN')` decorator.
- All source-management and admin user-management endpoints require `ADMIN`.
- All other authenticated endpoints require a valid `USER` or `ADMIN` JWT and are scoped to the caller's own data at the service layer.
- A `USER` calling an admin endpoint receives HTTP 403.

## FR-002e Account Deactivation & Deletion

- `POST /api/account/deactivate` → set status to `DISABLED`; invalidate existing tokens; invalidate the Telegram link; immediately log the user out.
- `POST /api/account/delete` → soft-delete by setting status to `DELETED`; pseudonymize the email; purge CV files from disk; delete the Telegram link; clear profile fields.
- `JobMatch` and `Application` history shall be retained in anonymized form where required for system integrity and reporting.
- Re-registration with the same email creates a new account.

## FR-002f Admin User Management

Admin endpoints:

```
GET   /api/admin/users
PATCH /api/admin/users/:id
POST  /api/admin/users/:id/reset-password
```

Supported actions: list user metadata, enable/disable, change role, and assisted password reset.

The assisted reset returns a **one-time temporary password**. Safeguards:
- The last remaining `ADMIN` cannot be disabled or demoted.
- An admin cannot self-demote or self-delete through these endpoints.
- Admins see metadata only — never another user's CV contents, matches, or notifications.

## FR-002g Authentication Hardening

- Maximum **5 failed login attempts per email + IP per 15 minutes** → HTTP 429 with `Retry-After`.
- Maximum **3 registrations per IP per hour**.
- All authentication failures are logged with `[AUTH]`.
- `emailVerifiedAt` shall exist on `User`; verification flow is Phase 2.
- If `REGISTRATION_INVITE_CODE` is configured, registration requires the matching code.

## FR-002h Token Revocation

`User.tokenInvalidatedAt DateTime?` shall be supported.

A guarded request is rejected when the JWT `iat` is earlier than `tokenInvalidatedAt`.

Set `tokenInvalidatedAt` on:
- password change,
- deactivation,
- deletion,
- role change,
- admin force-logout.

Refresh tokens remain Phase 2.

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

### Completion Meter

The profile-completion meter is composed of **six equal parts**:

1. Professional title
2. At least one skill
3. Experience
4. Education
5. At least one preferred location
6. CV

The server computes the percentage and the UI displays it until 100%.

## FR-003e Profile Update Recalculation Hook

When `PATCH /api/profile` modifies any **core matching attribute** — skills, target roles, location preferences, remote preference, or employment types — the system shall:

1. Persist the profile change and return the response immediately (non-blocking).
2. Enqueue a background task for that user.
3. Recalculate against the **1,000 most recent `ACTIVE` jobs** ordered by `firstSeenAt` descending.
4. Upsert the user's `JobMatch` records for those jobs.
5. Retain matches that fall below threshold, but do not notify them.
6. Enqueue a newly qualifying match only when it exceeds the user's threshold and has not previously been notified.

Recalculation for non-core fields may be skipped in MVP.

### FR-003e2 Dormant Reactivation

When a `DORMANT` user successfully logs in:

1. Set `status = ACTIVE`.
2. Update `lastActiveAt`.
3. Enqueue the FR-003e recalculation task.

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
2. Validate **magic bytes** (`%PDF` for PDF; `PK` ZIP signature for DOCX).
3. Sanitize filenames and reject path separators.
4. Store the file **outside the web root** at `/uploads/cv/{userId}/{timestamp}-{sanitizedFilename}`.
5. Never execute uploaded content.
6. Save file path, original filename, and upload date in a `CvFile` record linked to the user.
7. Keep the active CV plus a maximum of **2 previous versions**; purge older versions on the next upload.
8. Serve files only as attachments after verifying ownership.

```
GET    /api/profile/cv      → returns metadata + secure download link for the active CV
DELETE /api/profile/cv      → removes the active CV
```

**UX requirements:** client-side type/size validation before upload; visible progress indicator; replacement flow shows current active CV name/date; friendly error copy for invalid files.

## FR-003f CV-Assisted Pre-fill (Phase 2)

Extract plain text from the CV, match against the skill dictionary + aliases (FR-004), and present:

> We found these skills in your CV — tap to confirm

Only **user-confirmed** skills enter the profile and feed matching. Full automatic extraction remains Phase 3.

## FR-003d Onboarding Wizard

After first login, the user is offered a 3-step wizard, skippable and resumable:

1. **Roles:** professional title + target roles via tap-to-select chips with priority.
2. **Skills:** typeahead input with normalized suggestions.
3. **Locations & preferences:** location priority tiers, remote preference, employment types.

The completion meter persists on `/profile` and the dashboard until 100%.

# 13. Functional Requirements — Telegram Account Linking

## FR-003b Telegram Link

A Telegram bot only sees a numeric `chatId`; it cannot infer which registered `User` owns that chat. The link flow explicitly associates a Telegram chat with one JobHunter account.

**Flow:**

1. The logged-in user requests a link code:

```
POST /api/telegram/link-code
Response: { code: "A1B2C3", expiresAt, deepLink }
```

2. `deepLink = https://t.me/<botUsername>?start=<code>`.
3. `/settings/telegram` renders a one-tap button to open Telegram plus the raw code as fallback.
4. The user taps Start or sends `/start <code>`.
5. The bot resolves the code and creates `TelegramLink { userId, chatId, linkedAt, status }`.
6. The code is single-use and expires after 10 minutes.
7. The bot returns friendly progress and completion messages.

```
GET    /api/telegram/status   → { linked: true/false, linkedAt, status }
DELETE /api/telegram/link     → unlink
```

Until linking is complete, qualifying matches route to the Web Inbox.

### Telegram Link Conflict and Health

- If a `chatId` is already linked to another user, the new link **transfers** the chat: the previous user's `TelegramLink` is deleted and that user receives an `UNREAD_WEB` notification explaining that the Telegram account was linked to another JobHunter account.
- `TelegramLink.status` is `ACTIVE | UNREACHABLE`.
- After **5 consecutive delivery failures**, status changes to `UNREACHABLE` and notifications route to Web Inbox.
- A successful send or relink restores `ACTIVE`.

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

Each source record: `id, name, type, baseUrl, status, priorityTier, lastSuccessfulRun, lastFailedRun, lastError, collectionFrequency`.

Types: `API, RSS, JSON, HTML, Company Career Page`.

Only `ADMIN` users may create, update, or disable sources.

## FR-008 Source Adapter Architecture

```ts
interface JobSourceAdapter {
    readonly sourceId: string;
    fetchJobs(options?: { since?: Date }): Promise<RawJob[]>;
    fetchDetail?(url: string): Promise<string>;
}
```

Each source may also define a versioned selector configuration:

```text
descriptionSelector
sectionSelectors
render = html | js | pdf
truncationRisk
selectorVersion
```

New sources plug in without modifying the core pipeline. Selector/version metadata supports drift detection and controlled description extraction.

# 18. Job Collection, Normalization, Validation, Deduplication, Lifecycle

## FR-009 Automated Job Collection

Connect → retrieve → parse → convert → validate → normalize → description extraction/cleaning → URL normalization/liveness check → confidence-score → dedupe → store.

## FR-010 Manual Collection (Admin only)

`POST /api/sources/:id/collect` — admin trigger, processed asynchronously. If the source already has a collection run in progress, the request returns HTTP 409.

## FR-011 Job Information

Each job stores:

- `id`, `title`, `description`, `company`, `location`
- `remoteStatus`, `employmentType`, `experienceLevel`
- `salary`, `currency`, `skills`
- `url`, `sourceId`, `sourceJobId`
- `postedDate`, `deadline`
- `firstSeenAt`, `lastSeenAt`, `status`, `missedCycles`
- `parseConfidence`, `descriptionSource`, `descriptionQuality`, `descriptionFetchedAt?`
- `applyUrl`, `applyUrlRaw`, `applyMethod`, `applyEmail?`
- `urlStatus`, `urlCheckedAt?`, `finalUrl?`
- `archivedAt`, `fingerprint`, and full original `rawData` JSONB

`descriptionSource = API | LIST | DETAIL | PDF`.

`applyMethod = ONLINE_URL | EMAIL | IN_PERSON | SOURCE_ACCOUNT | PDF_FORM`.

## FR-012 Normalization

`WFH / Work From Home / Fully Remote / Remote` → `REMOTE`.

`Full-time / FULL_TIME / Permanent` → `FULL_TIME`.

## FR-012a Job Attribute Extraction

Skill dictionary + aliases, role keywords, seniority patterns, years-of-experience extraction, location extraction, and employment-type extraction. Deterministic and rule-based in MVP.

## FR-012b Skill Relationship Graph

`JavaScript → TypeScript, Node.js, React`; `Node.js → Express, NestJS, Fastify`; `PostgreSQL → SQL`.

The graph broadens matching without requiring semantic ML.

## FR-012c Parse Confidence

`parseConfidence` is a 0–100 score based on attribute-extraction cleanliness **and description quality**. Jobs below a configurable threshold (default 40) remain in the pool but are down-weighted in matching and visibly flagged.

## FR-012d Description Extraction & Cleaning

1. Use per-source selectors from FR-008.
2. Strip `script`, `style`, navigation, aside, footer, ad, cookie, and social-share boilerplate.
3. Decode HTML entities.
4. Force valid UTF-8 and detect/convert common Latin-1/Windows-1252 mojibake.
5. Preserve headings, lists, and meaningful line breaks.
6. Collapse repeated whitespace.
7. Apply a boilerplate blocklist such as "apply now", "share", "©", and cookie/social text.
8. Capture meaningful sections such as description, requirements, responsibilities, qualifications, and benefits.
9. **Detail-page rescue:** when cleaned text is below `MIN_DESCRIPTION_CHARS` (300), contains truncation markers such as “…/more”, or the source declares `truncationRisk`, fetch the original detail URL **once**, politely and under a per-job limit, then set `descriptionSource = DETAIL`.
10. **PDF rescue:** when the body is or links directly to a PDF, extract local text and set `descriptionSource = PDF`.
11. `render = js` sources use Playwright before extraction.

## FR-012e Description Quality Score

Description quality is 0–100 using weighted signals:

- length (≥300 = complete; <150 = near-zero),
- truncation markers,
- boilerplate ratio,
- mojibake indicators,
- structural quality such as headings/lists.

Quality `< DESCRIPTION_QUALITY_MIN` (default 40) triggers at most one detail retry. If still low, the job remains stored, is flagged in the UI, and receives lower parse confidence.

## FR-012f URL Normalization

1. Resolve relative links against the source `baseUrl`.
2. Strip tracking parameters such as `utm_*`, `fbclid`, and `gclid`.
3. Force an absolute HTTPS URL where possible.
4. Follow at most `URL_MAX_REDIRECTS` (default 3) during the link check and store `finalUrl`.
5. If the final domain differs from the expected source domain, flag the link as suspicious for review.

## FR-012g Apply-Method Extraction

- `mailto:` links or text such as "apply via email to x@y" → `EMAIL` + `applyEmail`.
- "apply in person" / "submit at office" → `IN_PERSON`.
- Boards requiring a source account → `SOURCE_ACCOUNT`.
- Direct application links → `ONLINE_URL`.
- PDF application forms → `PDF_FORM` where detected.

## FR-012h Field Accuracy Rules

- **Deadline:** parse common formats and preserve timezone when present. A past-dated deadline at ingestion is flagged as suspicious, excluded from notification, and routed for review. If timezone is missing, use 23:59 in `DEADLINE_DEFAULT_TZ` (`Africa/Addis_Ababa`).
- **Salary:** extract ranges and validate currency (`ETB`, `USD`, `EUR`, `GBP`). "Negotiable" / "unspecified" → `NULL`, never zero.
- **Company:** normalize legal suffixes such as PLC/LLC/Inc/Ltd for display/dedupe while retaining the raw value.
- **Location:** if unmappable, store `NULL` and lower `parseConfidence`; never guess.

## FR-013 Validation

Minimum required fields: title, company, source, url.

Additionally:
- `url` must be absolute and well formed.
- For `ONLINE_URL`, perform one polite HEAD/GET at ingestion and store `urlStatus`.
- If the response is 404 at ingestion, keep the job stored for audit/history but exclude it from notification until a later check passes.
- `EMAIL` and `IN_PERSON` methods do not require URL liveness.

Invalid records never enter the primary table; failures are logged.

## FR-014 Deduplication

Preferred key: `source + sourceJobId`.

Fallback fingerprint is built from `company + title + location + **normalized description**`, where normalization lowercases, strips punctuation, collapses whitespace, and uses the first 500 characters.

## FR-015 New Job Identification and Ghost Job Detection

Each job tracks `firstSeenAt`, `lastSeenAt`, and `missedCycles`.

**New job identification:** on each collection cycle, newly fetched jobs receive `firstSeenAt = now` and become eligible for matching.

**Ghost Job Detection:**

1. If `sourceJobId` appears in the latest fetch, set `missedCycles = 0` and update `lastSeenAt`.
2. Otherwise increment `missedCycles`.
3. If `missedCycles` reaches **3** while status is `ACTIVE`, set status to `REMOVED`.

`REMOVED` jobs are excluded from matching and notification but retained for application history. If they reappear, they return to `ACTIVE` and reset `missedCycles`.

## FR-016 Search / FR-017 Filters

Keyword search across title, description, skills, and company.

Filters: location, remote status, employment type, experience, salary, date posted, source, company, required skill, match score.

Search results exclude `EXPIRED` and `REMOVED` jobs by default.

# 19. Matching Engine (runs per user)

## FR-018 Job Matching

Matching runs once per **active user** against every new `ACTIVE` job. A new active job triggers up to N match calculations, where N is the number of active users.

Factors: role, skills, experience, location (against that user's priority tiers), employment type, salary, remote preference, and user exclusions.

Only jobs with status `ACTIVE` are matched.

## FR-019 Match Score

Score 0–100.

```text
Role compatibility       25%
Skill compatibility      30%
Experience compatibility 15%
Location compatibility   15%
Employment type           5%
Freshness                 5%
Salary compatibility      5%
```

### FR-019a Stored, Explainable Score

Each `JobMatch` record stores:

`score, roleScore, skillScore, experienceScore, locationScore, matchedSkills, missingSkills, reasons, matcherVersion, userId, jobId`.

### FR-019b Freshness Decay

```text
freshnessScore = baseFreshness × exp(-hoursSincePosted / τ)
```

Default `τ = 72h`.

A 95% match posted days ago may rank below an 89% match posted minutes ago, independently for each user.

### FR-019c Deterministic Factor Rules

To ensure repeatable results, the matcher shall apply these rules:

- **Role (25%):** target-role title/alias hit = 100; related via role graph = 60; otherwise 0.
- **Skills (30%):** `(matched + graph-related) ÷ requiredSkills × 100`. Clamp to 100. If the posting has no extractable required skills, use the configured neutral value of 50 and reduce confidence.
- **Experience (15%):** required years ≤ user's years = 100; within 1 year = 50; otherwise 0.
- **Location (15%):** user priority HIGH = 100, MEDIUM = 60, LOW = 30, absent = 0.
- **Employment (5%):** match = 100; if user accepts ANY = 100; otherwise 0.
- **Salary (5%):** same-currency overlap = 100; different currency = 50 using the static FX table; either side missing = 50.
- **Freshness (5%):** use the FR-019b decay function with `τ = 72h` by default.

The final score is the weighted sum of these factor scores and is rounded consistently to the configured precision.

Default `MATCH_THRESHOLD = 75`.

## FR-020 Negative Criteria

Examples: `Senior`, `Lead`, `Manager`, `5+ years`, `On-site`.

A negative criterion either reduces the relevant factor or excludes the job, according to the user's configured preference.

## Match Categories

`90–100 Excellent · 80–89 Strong · 70–79 Good · 60–69 Possible · 0–59 Low`.

Only matches at or above the user's configured threshold trigger immediate notification.

# 20. AI Job Analysis (optional, post-MVP)

## FR-021 / FR-022

Local AI (e.g. Ollama) may assist with skill equivalence, seniority, and transferable-skill judgment, returning structured JSON. Fully optional — if unavailable, rule-based matching continues unaffected.

---

# 21. Notification System (routed per user)

## FR-024 Notifications

The system shall notify a user when, for that user:

```text
Match score >= their configured threshold
AND job has not previously been notified to them
AND job status is ACTIVE
AND notifications are not paused
AND (applyMethod != ONLINE_URL OR urlStatus is not NOT_FOUND/ERROR)
```

A dead online apply link is **never pushed**.

Delivery goes to Telegram if linked and reachable; otherwise to the Web Inbox.

## FR-024a Channel Abstraction

```ts
interface NotificationChannel {
  send(userId: string, match: JobMatch): Promise<DeliveryResult>;
}
```

MVP implements `TelegramChannel` and `WebInboxChannel`. `EmailChannel` plugs in during Phase 3 without touching matcher logic.

## FR-024b Rate Limiting

1. **Global limit:** maximum 25 messages per second across all users.
2. **Per-chat limit:** minimum 1.2 seconds between messages to the same `chatId`.
3. **Backoff:** on HTTP 429, honor `retry_after` and back off exponentially.
4. **Burst collapse:** bursts above a soft cap may be collapsed into the daily digest when enabled.

## FR-024c Web Inbox Fallback

If a user has no Telegram link, or Telegram delivery permanently fails, the system shall:

1. Create `Notification` with `channel = WEB` and `status = UNREAD_WEB`.
2. Surface it on `/inbox`.
3. Show an unread-count badge.
4. Mark it `READ` when viewed.

No qualifying match is silently lost.

## FR-025 Telegram Alert

The alert shall include the match category, reason summary, source, and adaptive apply action.

Example:

```text
🔥 NEW JOB MATCH — Strong (92%)

Junior Backend Developer
Company: Example Technologies
Location: Remote · Full-time

💡 Why: Matches your Backend Developer goal —
3 of your 4 core skills, remote, junior level.

✓ Node.js  ✓ TypeScript  ✓ PostgreSQL
Missing: AWS

Source: Example Technologies
```

Apply action behavior:
- `ONLINE_URL` → `[Apply]`
- `EMAIL` → `[Copy Email]`
- `SOURCE_ACCOUNT` → `[Requires source account]`
- `IN_PERSON` → `[View instructions]`
- `PDF_FORM` → `[Open Form]`

The card identifies the original source and makes it clear that the action opens or uses the original posting.

## FR-025a Interactive Notifications

Inline buttons: `[Save] [Reject] [Apply/Copy Email] [Open]`.

## FR-025b Telegram Command Interface

Supported commands remain `/start`, `/status`, `/saved`, `/pause`, `/resume`, and `/help`, all resolved through `chatId → userId`.

## FR-025c Match Summary Line

Each notification includes one short natural-language summary explaining the strongest reasons for the score.

## FR-026 Notification Configuration (per user)

Users may set match threshold, pause/resume notifications, and digest preference.

## FR-027 Duplicate Notifications

A given `(userId, jobId)` shall not generate duplicate notifications for the same qualifying match event.

## FR-028 Daily Digest (per user)

The digest remains optional. Default send time is **08:00 Africa/Addis_Ababa**. Per-user custom digest times are Phase 2.

# 22. Saved Jobs, Rejections, Applications, Search Profiles

All scoped by `userId`.

- **FR-029 Save Job** — `GET /saved` returns this user's saved jobs only.
- **FR-030 Reject Job** — recorded per user, feeds future ranking.
- **FR-031 / FR-032 Application Tracking** — pipeline `Discovered → Saved → Applied → Assessment → Interview → Offer/Rejected/Withdrawn`, per user, rendered as a status board (§32.6).
- **FR-033 Saved Search Profiles** — reusable named searches per user; MVP supports manual execution, while automatic scheduled execution is Phase 2.

---

## FR-031a Application Transition Graph

Allowed transitions are:

```text
Discovered → {Saved, Applied, Rejected}
Saved → {Applied, Rejected}
Applied → {Assessment, Interview, Rejected, Withdrawn}
Assessment → {Interview, Rejected, Withdrawn}
Interview → {Offer, Rejected, Withdrawn}
Offer → terminal
```

The service layer shall enforce this graph. An illegal transition returns **HTTP 409**. The UI shall show only valid next stages.

# 23. Background Processing & Scheduling

## FR-034 Background Jobs

Async processing covers collection, normalization, matching, profile recalculation, notifications, digest, lifecycle sweeps, retention, and backups.

MVP uses `@nestjs/schedule`; Redis/BullMQ is deferred to Phase 2.

## FR-034a Expiration Sweeper

A scheduled task runs every **6 hours** (configurable) and marks overdue active jobs as `EXPIRED`.

```sql
UPDATE "Job"
SET "status" = 'EXPIRED'
WHERE "deadline" < NOW()
  AND "status" = 'ACTIVE';
```

The deadline is interpreted using the stored timezone when present and `DEADLINE_DEFAULT_TZ` otherwise.

## FR-034c Link-Rot Sweeper

Runs daily with a cap `LINK_ROT_MAX_PER_CYCLE = 200`.

For selected `ACTIVE` jobs with an `ONLINE_URL` apply method:

1. Re-check `applyUrl` politely and rate-limited.
2. HTTP 404/410 → `urlStatus = NOT_FOUND`.
3. Exclude dead-link jobs from matching/notification and show an amber warning.
4. If the URL later responds successfully, restore `urlStatus = OK`.
5. Log every check with `[LINKCHECK]`.

## FR-034d Dormancy Sweeper

Runs nightly. Users whose `lastActiveAt` is older than `DORMANT_AFTER_DAYS` (default 30) are set to `DORMANT`.

Dormant users are excluded from per-cycle matching but reactivated and recalculated on successful login.

## FR-035 Scheduled Collection

Collection runs on a configurable interval (for example every 30 minutes).

A **per-source collection lock** is required:
- If a run is already in progress, scheduled collection skips that source.
- A manual collection request returns HTTP 409.

## FR-036 Retry Mechanism

Source-level failures are retried and isolated. One source failing shall not block other sources or per-user matching from healthy sources.

## FR-037 Source Health Monitoring

`SourceRun` records every collection attempt, including:

`source, startedAt, finishedAt, status, jobsFetched, jobsCreated, duplicates, errors, errorMessage, descriptionFailures, avgDescriptionQuality, linkChecks, linkFailures`.

Alerts:
- average description quality `< 60` for 2 consecutive runs → likely selector drift;
- link failures `> 20%` across 2 consecutive runs → link-health alert.

## FR-037a MatchCycle Funnel Metrics

Every collection cycle records:

```text
startedAt, finishedAt, jobsEvaluated, usersProcessed,
matchesCreated, matchesAboveThreshold,
notificationsSent, notificationsFailed, notificationsToInbox, errors
```

Button callbacks increment `actionsTaken` counters (saved/rejected/applied).

## FR-037b Retention Archiver

Runs nightly and enforces §25.2.

## FR-037c Notification & System Log Retention

- Purge `SENT` and `READ` notifications older than 90 days.
- Keep `UNREAD_WEB` notifications until they are read.
- Rotate `SystemLog` records older than 30 days.

All retention actions are logged.

# 24. API Requirements

```text
/api/auth              register, login, password change
/api/profile           per-user, scoped via JWT
/api/profile/cv        CV upload/download/delete
/api/account           deactivate/delete
/api/telegram          link-code, status, unlink
/api/jobs              list, detail, search
/api/matches           per-user matches, detail, recalculate
/api/saved-jobs        per-user
/api/applications      per-user
/api/notifications     per-user
/api/searches          per-user create + manual run
/api/sources           ADMIN-only
/api/admin/users       ADMIN-only
```

### Authentication

Authentication endpoints apply FR-002g throttling. Every guarded route applies FR-002h token-revocation checks.

### Profile & CV

Profile and CV endpoints always derive the user from the JWT. The client cannot provide an arbitrary `userId` to access another user's data.

### Telegram

Link-code, status, unlink, bot webhook, commands, and callbacks resolve the authenticated account or `chatId → userId` before reading or changing data.

### Jobs / Matching

Job search is shared. Match results are filtered by the authenticated user's `userId`.

### Sources (ADMIN only)

`GET/POST/PATCH /api/sources`

`POST /api/sources/:id/collect` returns **409** if a collection run is already in progress.

### Account & Admin

```text
POST  /api/account/deactivate
POST  /api/account/delete
GET   /api/admin/users
PATCH /api/admin/users/:id
POST  /api/admin/users/:id/reset-password
```

# 25. Database Requirements

```text
User                 id, email, passwordHash, role (Enum: USER, ADMIN),
                     status (Enum: ACTIVE, DORMANT, DISABLED, DELETED),
                     locale (default "en"), notificationsPaused (default false),
                     pausedUntil?, lastActiveAt, tokenInvalidatedAt?,
                     emailVerifiedAt?, createdAt
CandidateProfile     FK userId (1:1)
CvFile               id, userId, filePath, originalName, uploadedAt, version
TelegramLink         id, userId, chatId (unique), linkedAt,
                     status (Enum: ACTIVE, UNREACHABLE)
Skill
CandidateSkill
TargetRole
LocationPreference
Job                  id, title, description, company, location, remoteStatus,
                     employmentType, experienceLevel, salary, currency, skills,
                     url, sourceId, sourceJobId, postedDate, deadline,
                     firstSeenAt, lastSeenAt, missedCycles (default 0),
                     status (Enum: ACTIVE, EXPIRED, REMOVED),
                     parseConfidence, descriptionSource, descriptionQuality,
                     descriptionFetchedAt?, applyUrl, applyUrlRaw,
                     applyMethod, applyEmail?, urlStatus, urlCheckedAt?,
                     finalUrl?, archivedAt?, fingerprint, rawData (JSONB)
JobSkill
Company
JobSource            id, name, type, baseUrl, status, priorityTier,
                     collectionFrequency, lastSuccessfulRun, lastFailedRun, lastError
SourceRun            plus descriptionFailures, avgDescriptionQuality,
                     linkChecks, linkFailures
SkillRelationship
JobMatch              FK userId AND jobId (+ scores, reasons, matcherVersion)
SavedJob             FK userId, jobId
Application          FK userId, jobId
Notification         id, userId, jobId, channel (TELEGRAM, WEB),
                     status (PENDING, SENT, FAILED, UNREAD_WEB, READ),
                     createdAt, sentAt?
SearchProfile        FK userId
MatchCycle
SystemLog
```

`JobMatch` is the central per-user/per-job join. `Notification` records delivery channel and outcome, powering Telegram history and the Web Inbox.

## 25.1 Core Database Relationships

```text
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

## 25.2 Data Retention & Archiving Policy

A job is eligible for archival when:
1. status is `EXPIRED` or `REMOVED`;
2. it has been in that state for more than 90 days; and
3. it has no linked `Application` records and no linked `SavedJob` records.

Archival purges bulky `rawData` and `description` fields and sets `archivedAt`.

The `Job` row is never hard-deleted, preserving referential integrity. Jobs tied to an application or saved record retain full content.

## 25.3 Index Specification

```text
UNIQUE (Job.sourceId, Job.sourceJobId)
INDEX  Job(status, firstSeenAt DESC)
INDEX  Job(status, deadline)
INDEX  Job(sourceId, status, missedCycles)
INDEX  Job(status, urlStatus)
INDEX  JobMatch(userId, score DESC)
INDEX  JobMatch(userId, notifiedAt)
INDEX  Notification(userId, status)
UNIQUE (SavedJob.userId, SavedJob.jobId)
INDEX  Application(userId, status)
INDEX  User(status, lastActiveAt)
```

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

## NFR-008 Backup & Restore
- Run a scripted nightly PostgreSQL `pg_dump`.
- Copy `/uploads` to `./backups`.
- Rotate backups after 7 days.
- Perform a monthly restore drill.
- Log backup activity with `[BACKUP]`.

## NFR-009 CORS
Allow only configured web origins. No wildcard origin is permitted in production configuration.

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

```dotenv
DATABASE_URL=
REDIS_URL=
JWT_SECRET=
JWT_EXPIRES_IN=7d

ADMIN_EMAILS=
REGISTRATION_INVITE_CODE=
PASSWORD_MIN=8

TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=JobHunterBot
TELEGRAM_GLOBAL_RATE_PER_SEC=25
TELEGRAM_PER_CHAT_INTERVAL_MS=1200

CV_UPLOAD_DIR=./uploads/cv
CV_MAX_SIZE_MB=5
CV_MAX_VERSIONS=3

JOB_COLLECTION_INTERVAL=
MATCH_THRESHOLD=75
PARSE_CONFIDENCE_MIN=40
GHOST_MISSED_CYCLE_LIMIT=3
EXPIRATION_SWEEP_INTERVAL=6h
RETENTION_DAYS=90
RECALC_JOB_LIMIT=1000

DORMANT_AFTER_DAYS=30
MIN_DESCRIPTION_CHARS=300
DESCRIPTION_QUALITY_MIN=40
DETAIL_FETCH_MAX_PER_JOB=1
PDF_EXTRACTION=on

URL_CHECK_AT_INGEST=on
URL_MAX_REDIRECTS=3
LINK_ROT_CHECK_INTERVAL=24h
LINK_ROT_MAX_PER_CYCLE=200

FRESHNESS_TAU_HOURS=72
DEADLINE_DEFAULT_TZ=Africa/Addis_Ababa
DIGEST_DEFAULT_TIME=08:00

NOTIFICATION_RETENTION_DAYS=90
LOG_RETENTION_DAYS=30
BACKUP_DIR=./backups
CORS_ORIGINS=
```

Secrets are never committed to Git.

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

## 32.10 Web Inbox
`/inbox`: lists all `UNREAD_WEB` and `READ` web notifications, newest first. Each entry renders the job card, the match summary line, the match score, and action buttons (Save / Reject / Apply / Open). A navigation badge shows the unread count. Opening an entry marks it `READ`.

## 32.11 Admin Source Dashboard
`/sources` (ADMIN only): lists all job sources with status, priority tier, last successful/failed run, and error message. Provides buttons to enable/disable a source and to trigger a manual collection. Shows recent `SourceRun` history.

---

## 32.12 Admin Console

**MVP-lite:** `/admin/users` lists user email, role, status, and `lastActiveAt`; supports disable/enable, role changes, and assisted password reset.

The console exposes metadata only — never another user's CV contents, matches, or notifications.

**Phase 2:** source-health dashboard, MatchCycle funnel analytics, and SystemLog viewer.

# 33. Security Architecture

```text
Client
  ↓ (email + password)
POST /api/auth/login
  ↓ bcrypt.compare()
  ↓ JWT issued (payload: { sub: userId, role, iat })
  ↓ Bearer token
NestJS AuthGuard('jwt')
  ↓ validate signature + expiration
  ↓ reject if iat < User.tokenInvalidatedAt
RolesGuard
  ↓ enforce @Roles('ADMIN')
Controller / Service
  ↓ every query scoped to req.user.id
```

Security controls:
- passwords hashed with bcrypt and never logged;
- authentication endpoints throttled according to FR-002g;
- every protected route checks JWT validity and token revocation;
- admin endpoints protected by role guards;
- users can access only their own profile, CV, matches, saved jobs, applications, notifications, search profiles, and Telegram link;
- CV files are stored outside the web root, validated by magic bytes, sanitized, non-executable, and served as attachments;
- Telegram link codes are single-use and time-limited;
- secrets come from environment variables;
- configured CORS origins only;
- the Telegram bot resolves `chatId → userId` before touching user-specific data.

Authorization is enforced at the service layer, not only at route level.

# 34. Testing Requirements

- **Unit tests:** password hashing, JWT validation and token invalidation, role precedence, auth throttling, per-factor matching score calculation, skill normalization, parse-confidence calculation, description-quality scoring, URL normalization, apply-method extraction, transition-graph enforcement, ghost-job counter, link-rot behavior, dormancy, retention eligibility.
- **Integration tests:** register → login → onboarding → profile → CV → Telegram link → collect job → description extraction → URL validation → match created for the correct user only.
- **Role/lifecycle tests:** with non-empty `ADMIN_EMAILS`, first registrant is `USER`; last admin cannot be demoted; disabled users cannot log in; deleted users have CVs purged.
- **Matcher determinism tests:** identical inputs yield identical factor scores and identical total score.
- **Description fixtures:** messy HTML → clean text; truncation → one detail fetch; mojibake → corrected; PDF → extracted text; multiple HTML templates → equivalent normalized descriptions.
- **URL fixtures:** relative → absolute; tracking stripped; 404-at-ingest → no notify; link-rot → excluded; restored link → eligible; redirect domain mismatch → flagged.
- **Notification tests:** different users receive different notifications for the same job; unlinked/unreachable users receive Web Inbox entries; the global 25 msg/sec limit is respected.
- **Transition tests:** illegal move → 409; legal move persists.
- **Backup tests:** monthly restore drill succeeds.
- **Authorization-boundary tests:** User A's JWT cannot access User B's data; Telegram commands never return another user's data.

# 35. Acceptance Criteria (MVP)

The MVP is accepted when all v2.2 criteria pass, plus:

```text
[✓] Deactivated users cannot log in.
[✓] Deleted users have CV files purged from disk.
[✓] The last remaining ADMIN cannot be demoted or disabled.
[✓] Old JWTs are rejected after token invalidation.
[✓] With ADMIN_EMAILS set, the first registrant is USER.
[✓] Dormant users are excluded from cycle matching and recalculated on login.
[✓] 100% of stored jobs have an absolute applyUrl or valid non-URL applyMethod.
[✓] Zero notifications are sent for ONLINE_URL jobs with urlStatus = NOT_FOUND or ERROR.
[✓] Email postings expose a Copy Email action.
[✓] Illegal application-stage moves return HTTP 409.
[✓] Descriptions reach the configured quality target or are flagged with the original link.
[✓] Stored descriptions contain no detected mojibake after cleaning.
[✓] Nightly backups exist and the restore drill passes.
[✓] Link-rot jobs are excluded from notification and recover when their links work again.
```

# 36. MVP Definition

The MVP shall contain all v2.2 capabilities plus:

```text
✓ User lifecycle: ACTIVE / DORMANT / DISABLED / DELETED
✓ Account deactivation and deletion
✓ Admin user management (metadata-only)
✓ Auth throttling, invite gate, emailVerifiedAt field
✓ Token invalidation via tokenInvalidatedAt
✓ Deterministic FR-019c matcher with default threshold 75
✓ Description extraction, cleaning, provenance, and quality scoring
✓ URL normalization, ingestion validation, and Link-Rot Sweeper
✓ Apply-method extraction and adaptive notification CTAs
✓ Application transition graph with 409 enforcement
✓ Per-source collection lock
✓ Notification and SystemLog retention
✓ CV versioning and upload security hardening
✓ Required database indexes
✓ Nightly PostgreSQL + uploads backup
✓ /admin/users
```

The MVP shall **not** require:

```text
✗ Redis / BullMQ
✗ Focus Mode
✗ Drag-and-drop kanban
✗ Amharic localization
✗ Email channel implementation
✗ Email verification flow
✗ CV-assisted pre-fill
✗ Admin analytics dashboard
✗ Saved-search auto-run
✗ Social login
✗ Paid AI
✗ Cloud infrastructure
✗ Mobile application
✗ Advanced semantic ML
✗ Payment system
```

# 37. Phase 2 Requirements

Redis / BullMQ for background work at scale; CV-assisted pre-fill; email verification flow; Focus Mode; drag-and-drop applications board; Amharic localization; saved-search auto-run; per-user digest times; admin analytics/source-health dashboard; advanced application tracking; local AI analysis; learned behavioral ranking; email-based password reset.

# 38. Phase 3 Requirements

Personalized learned ranking; full resume parsing; automatic skill extraction from CVs; cover-letter assistance; skill-gap analysis; application analytics; interview tracking; email notification channel; mobile PWA; social login (OAuth); cloud deployment with mandatory TLS termination; cold-storage tables for archived jobs.

# 39. Recommended Repository Structure

```text
jobhunter/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── auth/            JWT, revocation, throttling, roles
│   │   │   ├── admin/           user management
│   │   │   ├── profile/         profile, CV, onboarding, recalc
│   │   │   ├── telegram/        link-code, webhook, commands
│   │   │   ├── jobs/            collection, normalization, fidelity
│   │   │   ├── sources/         ADMIN-only adapters
│   │   │   ├── matching/        deterministic matcher
│   │   │   ├── lifecycle/       ghost, expiration, linkrot, dormancy, retention, backup
│   │   │   ├── notifications/   channel abstraction, limiter, inbox
│   │   │   └── settings/
│   │   ├── prisma/
│   │   ├── uploads/cv/          outside web root, gitignored
│   │   └── test/
│   └── web/
│       ├── app/
│       │   ├── (auth)/register · (auth)/login
│       │   ├── profile/ · settings/telegram/ · settings/notifications/
│       │   ├── matches/ · jobs/ · applications/ · saved/ · inbox/
│       │   ├── sources/         ADMIN
│       │   ├── admin/users/     ADMIN
│       │   └── dashboard/
│       ├── components/
│       └── lib/
├── packages/
│   ├── shared/
│   ├── types/
│   └── config/                  static FX table
├── docs/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
└── package.json
```

# 40. MVP Implementation Sequence

## Milestone 1 — Foundation + Auth + Roles

```text
Monorepo → NestJS API → PostgreSQL + Prisma
→ User role/status/revocation fields + indexes
→ Admin user endpoints + role precedence + auth throttling
→ Auth: register, login, bcrypt, JWT, AuthGuard, RolesGuard
```

**Done when:** register/login work; role precedence is correct; a USER gets 403 on admin routes; invalidated tokens fail.

## Milestone 2 — Profile, CV, Telegram Linking, Recalc

```text
Onboarding + six-part completion meter
→ Profile update + recalculation hook
→ CV upload: magic-byte validation + versioning + secure storage
→ Telegram link-code + conflict transfer + unreachable state
```

**Done when:** two users can link independently; profile changes trigger recalculation; only the intended chat receives a notification.

## Milestone 3 — Ethiopian Source + Description & Link Fidelity

```text
Source adapter
→ Fetch → normalize → description extraction/cleaning → quality score
→ Apply URL normalization + liveness
→ Dedupe → store
→ Ghost + expiration + link-rot + collection lock
```

**Done when:** real Ethiopian jobs are collected, descriptions are complete or flagged, dead links are excluded, and lifecycle sweeps operate.

## Milestone 4 — Deterministic Explainable Matcher

```text
Skill aliases + role graph
→ FR-019c factor scoring
→ ACTIVE users × ACTIVE jobs
→ Stored explainable JobMatch
```

**Done when:** identical inputs produce identical scores and different users can receive different scores for the same job.

## Milestone 5 — Notifications, Inbox, Applications, Retention, Backup

```text
High-score JobMatch
→ Telegram or Web Inbox with adaptive apply CTA
→ Application transition graph
→ Notification/log retention
→ Nightly backup
```

**At this point, the JobHunter multi-user MVP exists.**

# 41. MVP Completion Definition

The MVP is complete when this works automatically, **for more than one registered user**:

```text
NEW JOB (shared pool)
        ↓
Job Collector
        ↓
Description extraction + quality + apply-link validation
        ↓
PostgreSQL
        ↓
Duplicate Check
        ↓
Lifecycle: Ghost Detector + Expiration + Link-Rot
        ↓
Match against ACTIVE users only
        ↓
┌────────────┴────────────┐
▼                         ▼
Match vs User A           Match vs User B
Score = 87%               Score = 41%
Above threshold           Below threshold
▼                         ▼
Telegram → A              no notification

If User A has no reachable Telegram, the match lands in A's Web Inbox.
Application stage changes follow the transition graph.
Nightly backup runs and can be restored successfully.
A dormant user's login reactivates them and triggers recalculation.
```

Every notified job has either a live online apply link or a valid non-URL apply method.

# 42. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Source ToS/structure change breaks a collector | Missing jobs | Adapter isolation; `SourceRun` health; selector/description-quality alerts; polite-rate compliance |
| Matching load O(users × jobs) degrades latency | Slow notifications | Queue migration path; per-cycle caps; ACTIVE-only loop; MatchCycle monitoring |
| Telegram global/per-chat limits | Delayed alerts or bot ban | 25 msg/s global + 1.2s per chat + backoff + digest collapse |
| Over-notification fatigue | Users unlink | Explainable scoring; reject feedback; `/pause`; threshold control |
| Low-confidence scraped data | Trust erosion | Parse-confidence + description-quality scoring and UI flags |
| Ghost/expired/dead-link jobs sent to users | Wasted applications | Ghost detection + expiration + URL liveness checks |
| Selector drift produces thin descriptions | Incomplete listings | Description-quality metrics + drift alerts |
| Unbounded rawData growth | DB outage | 90-day orphan archival policy |
| Unlinked/unreachable users miss opportunities | Churn | Web Inbox fallback |
| Stale matches after profile update | Irrelevant results | Recalculation hook |
| Unauthorized source/admin management | Data-integrity risk | Role guards + admin-only routes |
| Dormant users inflate matching cost | Latency | Dormancy sweeper + ACTIVE-only matcher |
| Stolen JWT | Account takeover | `tokenInvalidatedAt` revocation |
| First-user admin takeover | System compromise | `ADMIN_EMAILS` precedence |
| Single-machine data loss | Total loss | Nightly backup + monthly restore drill |
| Brute-force login | Account takeover | Auth throttling + invite gate |

# 43. MVP Success Metrics

Outcome KPIs measured from `MatchCycle`, `Notification`, and action logs:

- **Speed:** median `firstSeenAt → user notification` < 10 minutes.
- **Match quality:** save-or-apply rate on notified matches > 15% within 7 days.
- **Noise control:** reject rate < 30% of notifications.
- **Adoption:** ≥ 3 active users with linked Telegram by end of Milestone 5.
- **Data hygiene:** zero `ACTIVE` jobs past their `deadline`; zero notifications sent for `REMOVED`/`EXPIRED` jobs.
- **Delivery reliability:** zero Telegram 429 bans; 100% of undeliverable matches captured in Web Inbox.
- **Apply integrity:** 100% of stored jobs have absolute `applyUrl` or a valid `applyMethod`; zero notifications with `urlStatus = NOT_FOUND`; no detected mojibake.
- **Description quality:** average `descriptionQuality` ≥ 70 across Ethiopian sources.
- **Backup:** monthly restore drill passes; zero data-loss incidents.
- **Security:** zero cross-user or cross-role data exposures.
- **Performance:** core routes meet NFR-006 low-bandwidth budget.

---

**End of document — JobHunter SRS v2.3 (User Lifecycle, Data Fidelity & Determinism Baseline)**

