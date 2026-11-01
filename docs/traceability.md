# JobHunter — Requirement → Test Traceability Matrix

> Current state | Regenerated from source, October 2026

Every coverage number on this page is **computed**, not typed. The requirement list comes from
`JobHunter_SRS_v2.3.md`, and the evidence for each requirement is a `describe`/`it` title in the
spec tree that cites its ID.

```bash
node scripts/generate-traceability.js          # rewrite the generated blocks
node scripts/generate-traceability.js --check  # CI: fail on drift
```

Run `npm run arch:verify` to check everything at once (facts, this matrix, and the docs claims).

**How to read the statuses**

- **Tested** — at least one test title cites the requirement ID, so the mapping cannot rot
  silently: rename or delete the test and the requirement drops back to “no evidence”.
- **No test evidence** — in-scope behaviour with no citing test. This is the working list, and
  it is deliberately narrower than “unimplemented”: the code may exist and still be unproven.
- **Deferred** — the SRS places the requirement outside the MVP. Each exemption quotes the SRS
  sentence that justifies it; if that sentence changes, the generator fails and the exemption has
  to be re-argued rather than inherited.

Coverage counts only in-scope requirements (`Tested ÷ (Total − Deferred)`). It is requirement-level
traceability, not line or branch coverage — a citing test proves the requirement is exercised, not
that its code paths are exhaustively asserted.

## Coverage Summary

<!-- BEGIN GENERATED COVERAGE -->
<!-- Generated from JobHunter_SRS_v2.3.md and the spec tree by scripts/generate-traceability.js. Do not edit by hand. -->

| Category | Requirements | Tested | Deferred | Coverage |
|---|---:|---:|---:|---:|
| Accounts, Roles & Lifecycle | 11 | 10 | 1 | 100% |
| Candidate Profile & CV | 6 | 5 | 1 | 100% |
| Telegram Account Linking | 1 | 1 | 0 | 100% |
| Skill Management | 1 | 1 | 0 | 100% |
| Target Role Management | 1 | 1 | 0 | 100% |
| Location Preferences | 2 | 2 | 0 | 100% |
| Job Source Management | 2 | 2 | 0 | 100% |
| Job Collection, Normalization, Validation, Deduplication, Lifecycle | 17 | 17 | 0 | 100% |
| Matching Engine (runs per user) | 6 | 6 | 0 | 100% |
| AI Job Analysis (optional, post-MVP) | 2 | 0 | 2 | n/a |
| Notification System (routed per user) | 11 | 11 | 0 | 100% |
| Saved Jobs, Rejections, Applications, Search Profiles | 6 | 6 | 0 | 100% |
| Background Processing & Scheduling | 10 | 10 | 0 | 100% |
| Non-Functional Requirements | 9 | 4 | 0 | 44% |
| **Total** | **85** | **76** | **4** | **94%** |

Derived from 85 requirement headings in `JobHunter_SRS_v2.3.md` and 492 test titles across 37 spec files (backend + frontend e2e).
**42** are cited by a `describe`/`it` title that names the ID; the remaining **34** are credited through the audited mapping in `scripts/generate-traceability.js`, whose clauses are re-resolved against real test titles on every run — a clause that matches nothing fails the check.
Coverage = 76 tested ÷ 81 in-scope = 94%. Deferred items are excluded from the denominator and each carries a quoted SRS line; if that line changes the generator fails.
Of those, **1** counted toward coverage are marked **Tested (partial)**: their tests are real but one SRS clause is unimplemented — each shortfall is named in the matrix and in the gaps list.

<!-- END GENERATED COVERAGE -->

## Gaps — in-scope requirements without a citing test

<!-- BEGIN GENERATED GAPS -->
<!-- Generated from JobHunter_SRS_v2.3.md and the spec tree by scripts/generate-traceability.js. Do not edit by hand. -->

Every in-scope requirement is either cited by a test or explained below.

### No citing test — reason stated (5)

These stay in the gap list: an explanation is not coverage. The note says what measures them
today, or says plainly that nothing does. A note goes stale the moment the requirement gains a
test, which fails the check.

- **NFR-001** — Performance *(SRS line 1320)*: Measured against the running stack by backend/scripts/nfr-test.ts (npm run nfr:check), which samples p95 per endpoint, login latency, and dashboard latency during five concurrent logins, plus the single-user recalculation. A unit-test title cannot prove a millisecond budget. Every sampled request including login is inside 500ms on the current stack; the login figure depends on PASSWORD_COST, which the security spec test pins at or above the OWASP bcrypt floor.
- **NFR-002** — Scalability *(SRS line 1323)*: No automated evidence. The claim is structural — a source is added by registering an adapter, and keyset pagination bounds each cycle — reviewed in docs/architecture-overview.md rather than measured.
- **NFR-003** — Availability *(SRS line 1326)*: No automated evidence. The MVP serves while the host runs; continuous availability is the cloud phase the SRS defers.
- **NFR-006** — Performance Budget — Low-Bandwidth *(SRS line 1342)*: No automated evidence. JS payload and LCP budgets need a browser/perf harness this repo does not run yet.
- **NFR-007** — Accessibility & Localization *(SRS line 1350)*: No automated evidence. Controls are driven by accessible name in the e2e suite, but contrast, touch-target and i18n clauses are unmeasured.

### Partially implemented (1)

These count toward coverage because the tests and the code are real; the shortfall is the SRS
clause still unimplemented, so it is stated here rather than hidden inside a percentage.

- **FR-030** — Reject Job *(SRS line 1064)*: the rejection is recorded per user and is terminal in the transition graph; the clause "feeds future ranking" is not implemented — the matcher never reads Application.stage

<!-- END GENERATED GAPS -->

## Security controls

<!-- BEGIN GENERATED SECURITY -->
<!-- Generated from JobHunter_SRS_v2.3.md and the spec tree by scripts/generate-traceability.js. Do not edit by hand. -->

`SEC-xxx` are code-level security-control labels (not SRS requirement IDs). Each row pairs the
comment that names the control with the test that exercises it.

| Control | Declared in | Test evidence |
|---|---|---|
| SEC-001 | main.ts, modules/auth/auth.module.ts | common/security/security.spec.ts · `SEC-001 — Helmet` |
| SEC-002 | common/security/cors-policy.ts, common/utils/escape-html.ts, main.ts, modules/telegram/telegram.service.ts | common/security/security.spec.ts · `NFR-009 — CORS origin policy (SEC-002)`<br>modules/telegram/telegram.service.spec.ts · `TelegramService.buildMatchText — SEC-002 HTML escaping` |
| SEC-003 | modules/digest/digest.service.ts, modules/notifications/notifications.service.ts, modules/profile/profile.controller.ts | common/security/security.spec.ts · `SEC-003 — magic-byte validation`<br>modules/notifications/notifications.service.spec.ts · `SEC-003: concurrent calls for the same (userId, jobId) deliver exactly once`<br>modules/notifications/notifications.service.spec.ts · `SEC-003: a unique-constraint race on insert (P2002) is treated as already-notified` |
| SEC-004 | modules/profile/profile.controller.ts | common/security/security.spec.ts · `SEC-004 — filename sanitization` |
| SEC-005 | common/security/password-policy.ts, common/utils/rate-limiter.ts, modules/auth/auth.controller.ts, modules/auth/auth.service.ts, modules/telegram/telegram.controller.ts, modules/telegram/telegram.service.ts | common/security/security.spec.ts · `SEC-005 — password hashing policy`<br>modules/auth/auth.controller.spec.ts · `AuthController — SEC-005 rate limiting`<br>modules/auth/auth.service.spec.ts · `AuthService password cost refresh (SEC-005)`<br>modules/telegram/telegram.service.spec.ts · `TelegramService.throttle — SEC-005 atomic slot reservation` |
| SEC-006 | modules/sources/sources.service.ts | modules/sources/sources.service.spec.ts · `records a transient failure but keeps the source ACTIVE for retry (SEC-006)`<br>modules/sources/sources.service.spec.ts · `skips collection while the source is in backoff after repeated failures (SEC-006)`<br>modules/sources/sources.service.spec.ts · `retries once the backoff window has elapsed and resets the failure streak on success (SEC-006)` |
| SEC-007 | modules/sources/adapters/job-source.adapter.ts, modules/telegram/telegram.service.ts | modules/sources/adapters/fetch-timeout.spec.ts · `SEC-007 — upstream fetch timeout cap`<br>modules/telegram/telegram.service.spec.ts · `SEC-007: pollOnce caps the long-poll so a silent Bot API cannot hold the poll slot` |
| SEC-010 | prisma/prisma.service.ts | prisma/prisma.service.spec.ts · `SEC-010 — SQLite boolean and JSON coercion` |
| SEC-011 | main.ts, modules/events/events.controller.ts | modules/events/events.controller.spec.ts · `SEC-011 — SSE stream authentication` |

<!-- END GENERATED SECURITY -->

## Full matrix

<!-- BEGIN GENERATED MATRIX -->
<!-- Generated from JobHunter_SRS_v2.3.md and the spec tree by scripts/generate-traceability.js. Do not edit by hand. -->

Status legend: **Tested** = a test title cites the ID · **Tested (mapping)** = evidence comes only from the
audited alias mapping · **Tested (partial)** = tests and code are real, but one clause of the SRS
sentence is unimplemented (the missing clause is quoted in the Evidence cell and listed under "Partially
implemented") · **No test evidence** = implemented scope with no citing test · **Deferred** = the SRS
places it outside the MVP.

### Accounts, Roles & Lifecycle

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-001 | User Registration and Role Assignment | Tested | auth/auth.service.spec.ts · `FR-001 — User registration and role assignment` |
| FR-001a | User Status Model | Tested (mapping) | account/account.service.spec.ts · `sets status to DISABLED and invalidates token` (+1 more) |
| FR-002 | User Login | Tested (mapping) | frontend/e2e/runtime-verification.spec.ts · `sign-in issues a session and the shell renders` |
| FR-002a | Session Handling | Tested (mapping) | frontend/e2e/runtime-verification.spec.ts · `protected API rejects anonymous callers` (+1 more) |
| FR-002b | Logout | Tested (mapping) | frontend/e2e/shell.spec.ts · `logout returns to login and clears the session` |
| FR-002c | Password Reset (MVP-simplified) | Deferred | SRS: “Full email-based password reset is deferred.” |
| FR-002d | Role-Based Access Control | Tested (mapping) | frontend/e2e/phase5.spec.ts, admin/admin.service.spec.ts · `sources page shows 403 message for non-admin` (+1 more) |
| FR-002e | Account Deactivation & Deletion | Tested | account/account.service.spec.ts · `AccountService — FR-002e deactivation` (+1 more) |
| FR-002f | Admin User Management | Tested | admin/admin.service.spec.ts · `AdminService — FR-002f user management` (+1 more) |
| FR-002g | Authentication Hardening | Tested (mapping) | auth/auth.controller.spec.ts · `also enforces the per-email budget (5) independently of the IP budget` (+1 more) |
| FR-002h | Token Revocation | Tested (mapping) | account/account.service.spec.ts, admin/admin.service.spec.ts · `sets status to DISABLED and invalidates token` (+1 more) |

### Candidate Profile & CV

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-003 | Candidate Profile (per user) | Tested (mapping) | integration/integration.spec.ts · `FR-003a — profile completion` |
| FR-003e | Profile Update Recalculation Hook | Tested | profile/profile.service.spec.ts · `FR-003e — Profile update recalculation hook` |
| FR-003e2 | Dormant Reactivation | Tested (mapping) | auth/auth.service.spec.ts · `reactivates dormant users and enqueues match recalculation on login` |
| FR-003a | CV Upload | Tested | integration/integration.spec.ts, common/security/security.spec.ts, frontend/e2e/persistence.spec.ts · `FR-003a — profile completion` (+2 more) |
| FR-003f | CV-Assisted Pre-fill (Phase 2) | Deferred | SRS: “CV-Assisted Pre-fill (Phase 2)” |
| FR-003d | Onboarding Wizard | Tested | frontend/e2e/onboarding.spec.ts · `FR-003d — onboarding wizard: three steps, resumable, skippable` |

### Telegram Account Linking

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-003b | Telegram Link | Tested | telegram/telegram.service.spec.ts · `TelegramService — link codes (FR-003b)` (+1 more) |

### Skill Management

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-004 | Skill Management | Tested (mapping) | matching/matching-engine.spec.ts · `normalizeSkill (FR-012 / skill alias dictionary)` |

### Target Role Management

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-005 | Target Roles | Tested (mapping) | matching/matching-engine.spec.ts · `roleSimilarity (FR-018 role compatibility)` |

### Location Preferences

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-006a | Location Hierarchy | Tested (mapping) | sources/adapters/adapters.spec.ts · `detects remote location class` |
| FR-006b | Location Priority Tiers (per user) | Tested (mapping) | matching/matching-engine.spec.ts · `scores location from the user tier map` |

### Job Source Management

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-007 | Job Source Registration (Admin only) | Tested (mapping) | frontend/e2e/phase5.spec.ts · `sources page shows 403 message for non-admin` |
| FR-008 | Source Adapter Architecture | Tested (mapping) | sources/adapters/adapters.spec.ts · `parses a standard remote job from the JSON API` (+2 more) |

### Job Collection, Normalization, Validation, Deduplication, Lifecycle

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-009 | Automated Job Collection | Tested (mapping) | sources/sources.service.spec.ts · `SourcesService.collect — validation, dedup counting, isolation (FR-013/014/036)` |
| FR-010 | Manual Collection (Admin only) | Tested | sources/sources.controller.spec.ts, sources/sources.service.spec.ts · `SourcesController — FR-010 manual collection` (+1 more) |
| FR-011 | Job Information | Tested (mapping) | jobs/job-fidelity.spec.ts · `normalizeSalary (FR-012h)` |
| FR-012 | Normalization | Tested | matching/matching-engine.spec.ts · `normalizeSkill (FR-012 / skill alias dictionary)` |
| FR-012a | Job Attribute Extraction | Tested (mapping) | sources/adapters/adapters.spec.ts · `parses EU tech jobs with salary and skill extraction` |
| FR-012b | Skill Relationship Graph | Tested | matching/matching-engine.spec.ts · `areSkillsRelated (FR-012b skill relationship graph)` |
| FR-012c | Parse Confidence | Tested | matching/matching-engine.spec.ts · `scoreJob — penalties and confidence (FR-020 / FR-012c)` |
| FR-012d | Description Extraction & Cleaning | Tested | jobs/job-fidelity.spec.ts · `decodeHtmlEntities (FR-012d)` (+1 more) |
| FR-012e | Description Quality Score | Tested | jobs/job-fidelity.spec.ts · `scoreDescriptionQuality (FR-012e)` |
| FR-012f | URL Normalization | Tested | jobs/job-fidelity.spec.ts · `normalizeUrl (FR-012f)` |
| FR-012g | Apply-Method Extraction | Tested | jobs/job-fidelity.spec.ts · `extractApplyMethod (FR-012g)` |
| FR-012h | Field Accuracy Rules | Tested | jobs/job-fidelity.spec.ts · `normalizeSalary (FR-012h)` (+2 more) |
| FR-013 | Validation | Tested | jobs/job-fidelity.spec.ts, sources/sources.service.spec.ts · `checkUrlLiveness — SSRF guard (FR-013)` (+1 more) |
| FR-014 | Deduplication | Tested | jobs/job-fidelity.spec.ts, sources/sources.service.spec.ts · `buildFingerprint (FR-014)` (+2 more) |
| FR-015 | New Job Identification and Ghost Job Detection | Tested | sources/sources.service.spec.ts · `SourcesService.collect — FR-015 ghost detection via reconciliation` (+1 more) |
| FR-016 | Search | Tested (mapping) | jobs/jobs.service.spec.ts, frontend/e2e/shell.spec.ts · `combines the cursor with existing filters (q + tier)` (+1 more) |
| FR-017 | Filters | Tested (mapping) | jobs/jobs.service.spec.ts · `combines the cursor with existing filters (q + tier)` |

### Matching Engine (runs per user)

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-018 | Job Matching | Tested | matching/matching-engine.spec.ts, matching/matching.service.spec.ts · `roleSimilarity (FR-018 role compatibility)` (+1 more) |
| FR-019 | Match Score | Tested | matching/matching-engine.spec.ts · `scoreJob — skill scoring (FR-019)` (+1 more) |
| FR-019a | Stored, Explainable Score | Tested (mapping) | frontend/e2e/phase5.spec.ts · `job detail explainable panel equals stored JobMatch` |
| FR-019b | Freshness Decay | Tested | matching/matching-engine.spec.ts · `scoreJob — freshness decay (FR-019b)` |
| FR-019c | Deterministic Factor Rules | Tested (mapping) | matching/matching-engine.spec.ts · `scoreJob — overall math (FR-019 weights)` |
| FR-020 | Negative Criteria | Tested | matching/matching-engine.spec.ts · `scoreJob — penalties and confidence (FR-020 / FR-012c)` |

### AI Job Analysis (optional, post-MVP)

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-021 | AI Job Analysis (optional, post-MVP) | Deferred | SRS: “AI Job Analysis (optional, post-MVP)” |
| FR-022 | AI Job Analysis (optional, post-MVP) | Deferred | SRS: “AI Job Analysis (optional, post-MVP)” |

### Notification System (routed per user)

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-024 | Notifications | Tested | notifications/notifications.service.spec.ts · `NotificationsService — FR-024/FR-025/FR-027` (+2 more) |
| FR-024a | Channel Abstraction | Tested (mapping) | notifications/notifications.service.spec.ts · `FR-024c: Telegram delivery failure falls back to the Web Inbox (UNREAD_WEB)` (+1 more) |
| FR-024b | Rate Limiting | Tested (mapping) | telegram/telegram.service.spec.ts, common/utils/rate-limiter.spec.ts · `serializes concurrent sends so they respect the global rate cap (no burst)` (+1 more) |
| FR-024c | Web Inbox Fallback | Tested | notifications/notifications.service.spec.ts · `FR-024c: Telegram delivery failure falls back to the Web Inbox (UNREAD_WEB)` |
| FR-025 | Telegram Alert | Tested | notifications/notifications.service.spec.ts · `NotificationsService — FR-024/FR-025/FR-027` (+1 more) |
| FR-025a | Interactive Notifications | Tested | telegram/telegram.service.spec.ts · `FR-025a: callback [Save] stores against the LINKED user (chatId → userId)` |
| FR-025b | Telegram Command Interface | Tested | telegram/telegram.service.spec.ts · `FR-025b/§33: an unknown chatId receives no user data (linking prompt only)` |
| FR-025c | Match Summary Line | Tested (mapping) | notifications/notifications.service.spec.ts · `FR-025: linked user receives Telegram message containing summary + [Save][Reject][Apply][Open]` |
| FR-026 | Notification Configuration (per user) | Tested (mapping) | notifications/notifications.service.spec.ts, frontend/e2e/phase5.spec.ts · `FR-024: paused user is never notified` (+1 more) |
| FR-027 | Duplicate Notifications | Tested | notifications/notifications.service.spec.ts · `NotificationsService — FR-024/FR-025/FR-027` (+1 more) |
| FR-028 | Daily Digest (per user) | Tested | digest/digest.service.spec.ts, lifecycle/lifecycle.tasks.spec.ts · `DigestService — FR-028 daily digest (per user)` (+1 more) |

### Saved Jobs, Rejections, Applications, Search Profiles

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-029 | Save Job | Tested (mapping) | telegram/telegram.service.spec.ts, frontend/e2e/persistence.spec.ts · `FR-025a: callback [Save] stores against the LINKED user (chatId → userId)` (+2 more) |
| FR-030 | Reject Job | Tested (partial) | applications/applications.service.spec.ts, telegram/telegram.service.spec.ts · `ApplicationsService — FR-030 Reject Job` (+1 more) — partial: the rejection is recorded per user and is terminal in the transition graph; the clause "feeds future ranking" is not implemented — the matcher never reads Application.stage |
| FR-031 | Saved Jobs, Rejections, Applications, Search Profiles | Tested (mapping) | applications/applications.service.spec.ts · `creates an APPLIED lifecycle record and initial transition` |
| FR-032 | Application Tracking | Tested (mapping) | frontend/e2e/phase5.spec.ts · `applications board: move stage persists after reload` |
| FR-033 | Saved Search Profiles | Tested | integration/integration.spec.ts · `FR-033 — search profiles` |
| FR-031a | Application Transition Graph | Tested | integration/integration.spec.ts · `FR-031a — transition graph` |

### Background Processing & Scheduling

| Req | Title | Status | Evidence |
|---|---|---|---|
| FR-034 | Background Jobs | Tested | lifecycle/lifecycle.tasks.spec.ts · `FR-034 — Background jobs` |
| FR-034a | Expiration Sweeper | Tested | lifecycle/lifecycle.service.spec.ts, lifecycle/lifecycle.tasks.spec.ts · `LifecycleService.sweepExpired — FR-034a expiration sweeper` (+1 more) |
| FR-034c | Link-Rot Sweeper | Tested (mapping) | lifecycle/lifecycle.service.spec.ts · `rechecks NOT_FOUND online apply links and restores them when live` |
| FR-034d | Dormancy Sweeper | Tested | integration/integration.spec.ts · `FR-034d — dormancy` |
| FR-035 | Scheduled Collection | Tested (mapping) | common/utils/exclusive.spec.ts · `skips an overlapping call while the first is still running` |
| FR-036 | Retry Mechanism | Tested | sources/sources.service.spec.ts · `SourcesService.collect — validation, dedup counting, isolation (FR-013/014/036)` |
| FR-037 | Source Health Monitoring | Tested (mapping) | sources/sources.service.spec.ts · `SourcesService.computeHealthScore` (+1 more) |
| FR-037a | MatchCycle Funnel Metrics | Tested | lifecycle/lifecycle.service.spec.ts · `LifecycleService.runMatchCycle — FR-037a funnel metrics` |
| FR-037b | Retention Archiver | Tested | lifecycle/lifecycle.service.spec.ts · `LifecycleService.retentionArchive — FR-037b` |
| FR-037c | Notification & System Log Retention | Tested | lifecycle/lifecycle.service.spec.ts · `LifecycleService.retentionNotificationsAndLogs — FR-037c` |

### Non-Functional Requirements

| Req | Title | Status | Evidence |
|---|---|---|---|
| NFR-001 | Performance | No test evidence | — |
| NFR-002 | Scalability | No test evidence | — |
| NFR-003 | Availability | No test evidence | — |
| NFR-004 | Reliability | Tested (mapping) | sources/sources.service.spec.ts · `fails cleanly for sources without a registered adapter (no demo templates)` (+1 more) |
| NFR-005 | Security | Tested (mapping) | common/security/security.spec.ts, common/utils/url-safety.spec.ts · `SEC-003 — magic-byte validation` (+1 more) |
| NFR-006 | Performance Budget — Low-Bandwidth | No test evidence | — |
| NFR-007 | Accessibility & Localization | No test evidence | — |
| NFR-008 | Backup & Restore | Tested | lifecycle/backup.service.spec.ts · `LifecycleService.runBackup — NFR-008 nightly backup` |
| NFR-009 | CORS | Tested | common/security/security.spec.ts · `NFR-009 — CORS origin policy (SEC-002)` |

<!-- END GENERATED MATRIX -->

## Test Inventory (generated)

<!-- BEGIN GENERATED TEST INDEX -->
<!-- Generated from the spec tree. Do not edit by hand. -->

| File | Declarations |
|---|---:|
| account.service.spec.ts | 7 |
| adapters.spec.ts | 55 |
| admin.service.spec.ts | 8 |
| applications.service.spec.ts | 6 |
| auth.controller.spec.ts | 4 |
| auth.service.spec.ts | 9 |
| backup.service.spec.ts | 5 |
| category-mapper.spec.ts | 9 |
| digest.service.spec.ts | 8 |
| ethiopia-eligibility.spec.ts | 13 |
| events.controller.spec.ts | 6 |
| exclusive.spec.ts | 4 |
| fetch-timeout.spec.ts | 3 |
| integration.spec.ts | 10 |
| job-fidelity.spec.ts | 31 |
| jobs.service.spec.ts | 4 |
| keyset.spec.ts | 10 |
| lifecycle.service.spec.ts | 13 |
| lifecycle.tasks.spec.ts | 9 |
| matching-engine.spec.ts | 34 |
| matching.service.spec.ts | 4 |
| notifications.service.spec.ts | 7 |
| parse-port.spec.ts | 3 |
| prisma.service.spec.ts | 6 |
| profile.service.spec.ts | 4 |
| rate-limiter.spec.ts | 5 |
| security.spec.ts | 14 |
| sources.controller.spec.ts | 4 |
| sources.service.spec.ts | 36 |
| telegram-channel.spec.ts | 11 |
| telegram.service.spec.ts | 16 |
| url-safety.spec.ts | 11 |
| **Total** | **369** |

<!-- END GENERATED TEST INDEX -->

**Reading this table:** the right column counts `it(...)` / `test(...)` declarations, including
parameterized declarations once. The executed test count in CI is higher because `it.each` tables
expand. Do not use the declaration count as a coverage or release gate.

## What this matrix does not cover

- **Frontend behaviour.** Backend specs and `frontend/e2e/*.spec.ts` are both scanned, but the
  e2e suite is small, so UI requirements in SRS §32 are largely unrepresented. Treat a
  frontend-facing requirement as unverified until an e2e test cites it.
- **Non-functional claims.** NFR rows here mean "a test cites this ID". Latency, payload size,
  accessibility, and backup/restore (NFR-001, NFR-006, NFR-007, NFR-008) need their own harness,
  documented in `docs/ops-runbook.md`, not a unit test.
- **Behaviour proven only by a comment.** Evidence must be a test title; IDs mentioned only in
  spec file headers or inline comments do not count.

---

*Generated blocks: `scripts/generate-traceability.js`. Test index: `scripts/generate-architecture-facts.js`.*
