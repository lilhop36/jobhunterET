# JobHunter — Architecture Health Report (Consolidated)

**Audit date:** 2026-10-27  
**Consolidated:** 2026-10-27  
**Skill:** `architecture-visualization:architecture-health` (audit only; no diagram-format foundation was used because no machine-readable model exists).  
**Audience:** maintainers, operators, and reviewers who use these documents as an architecture source of truth.  
**Scope:** `docs/architecture-overview.md`, `docs/matching-engine-reference.md`, `docs/traceability.md`, `docs/ops-runbook.md`, `docs/plans/category-aware-collection.md`, `README.md`, CI, Prisma schema, backend modules, frontend routes.  
**Method:** static evidence inspection, git history, test inventory, and the deterministic checks in `scripts/check-architecture-health.js`.  
**Runtime note:** the backend (`:3210`) and frontend (`:3211`) were not running during the original audit, so no runtime trace was collected then. Post-remediation verification first started the backend against a database copy, then (2026-10-30) ran the **live** stack through a real browser — see [Live runtime verification](#live-runtime-verification-2026-10-30) — and finally rehearsed the same checks against the **production build with a disposable seeded database**, which is now CI Gate 6 — see [Gate 6](#gate-6-browser-runtime-verification-in-ci-2026-10-30).

> This file merges the audit report, machine-readable traceability index, diagram/model diff, living-architecture checks, regeneration summary, and raw check output into one deliverable. The original files remain in `docs/architecture-health/` for tooling and incremental updates.

---

## Remediation status (2026-10-27, post-audit)

The findings below are preserved as the audit record. The following changes were made in response; they do not alter the historical evidence.

| Area | Status | Evidence |
|---|---|---|
| Structural facts | Fixed | `scripts/generate-architecture-facts.js` derives models, modules, routes, sources, adapters, tests, versions, and CI jobs from code into `docs/architecture-facts.json`, `docs/architecture-facts.md`, and marker blocks in the overview, README, and traceability. |
| Behaviour docs | Fixed | The overview, matching reference, traceability, README, runbook, and category-collection plan now match the engine: neutral skill score 0.4, hard eligibility, token-aware role matching, 10-minute match cycle, 11 web + 3 Telegram sources, no cross-source fingerprint grouping. |
| CI protection | Fixed | Gate 5 (`.github/workflows/ci.yml`) runs `facts:check` and `check-architecture-health.js --strict`; `npm run arch:verify` runs all three generators/checks locally. Gate 6 (added 2026-10-30) boots the production build against a disposable seeded database and runs the browser specs — see [Gate 6](#gate-6-browser-runtime-verification-in-ci-2026-10-30). |
| Production database | Fixed | SQLite is documented and configured as authoritative. `prisma db push --accept-data-loss` was removed from the entrypoint and the legacy backend Dockerfile. |
| Migration safety | Fixed | `backend/scripts/db-migrate-safe.js` takes a verified `VACUUM INTO` backup, tests pending migrations on the copy, requires matching schema and unchanged row counts, and refuses drift. A sync migration (`20261027_sync_current_schema`) repairs the migration history for fresh databases. |
| Backup path | Fixed | Nightly and pre-migration backups use the same verified snapshot helper. Docker backups land on the persistent volume at `/app/data/backups/pre-migration/`. |
| Runtime verification | Fixed | Live stack started from `dev.sh` on 2026-10-30 and driven in Chromium by `frontend/e2e/runtime-verification.spec.ts` — 5 passed: `/api/health` 200, anonymous `/api/matches` 401, sign-in reaches the dashboard, authenticated `/api/matches` 200 with unique `jobId`s, and the rendered matches list contains no duplicate postings. Earlier copy-based run: `/api/health` 200, login issued a JWT, `/api/matches` and `/api/dashboard` 200, unauthenticated 401. Rehearsed again against the **production build** (`nest build` + `next build`, disposable seeded database) exactly as Gate 6 runs it: 6 passed in 2.0m. |
| Developer launcher | Fixed | `dev.sh` no longer requires PostgreSQL (it reads the Prisma provider and only starts Postgres for a `postgres` schema), no longer runs `prisma migrate dev` (which left a `_ensure` migration and an interrupted history row on every start), and its watchdog now probes real health paths with a 120s boot grace, 10s timeout, 3-strike tolerance and process-tree kills. Guarded by the `deployment.devlauncher` check. |
| E2E runner | Fixed | `frontend/playwright.config.ts` used `import.meta.dirname` in a CommonJS package, so `npm run test:e2e` failed before loading any spec. Now `__dirname`; the runner works and the new runtime spec is the first suite to prove it. |
| Parser fixture coverage (`U06`) | Fixed | `adapters.spec.ts` gained a `HagereJobsAdapter` suite: 4 fixture tests over synthetic Elementor listing pages cover the standard card layout, a layout whose fields sit before the apply link, a sparse card that must fall back to defaults, and the empty-listing failure. Writing them exposed a card-scoping defect in `hagerejobs.adapter.ts` (a fixed ±1500-character window around each `job_detail=NNN` link could read a neighbour's title); the window is now bounded by the neighbouring markers and cut at the next `article`/`li`. See [HagereJobs parser fixtures](#hagerejobs-parser-fixtures-2026-10-30). |
| Contract test precision | Fixed | `integration.spec.ts` asserted that no match references an expired job by comparing every match against the newest `EXPIRED.statusChangedAt` in the table. That global boundary flagged 17 legitimate matches — their jobs were removed hours *after* matching — and had only ever passed because one surviving EXPIRED row held a late timestamp; the duplicate merge removed that row and the assertion failed. It now compares each match to its own job's `statusChangedAt`: 0 violations across 343 matches on EXPIRED/REMOVED jobs. Test-only change; no product code or data was altered. |
| Documented smoke test | Fixed | `backend/scripts/smoke-test.sh` — the runbook's post-deployment check — probed bare paths (`/dashboard`, `/matches`) against a server mounted under `api`, so every request returned 404, and `set -euo pipefail` plus an empty `grep` aborted the script before the auth section. It reported the backend "reachable" on the strength of a 404: a green-looking script that tested nothing. It now targets `/api/…`, parses JSON with a `sed` helper that cannot abort the run, tries the seeded accounts in order, and asserts 23 real checks — health payload, JWT length, authenticated 200, anonymous 401 on two routes, security headers, 9 endpoints, match/save counts, duplicate `jobId`s, and invalid-credential rejection. Verified 23/23 against the live stack. |
| Traceability matrix (`U04`) | Fixed | `docs/traceability.md` is generated by `scripts/generate-traceability.js` from `JobHunter_SRS_v2.3.md` and the `describe`/`it` titles of every spec file — 85 requirements, 76 tested, 4 deferred, **94% coverage**, down from the 18 unexplained gaps the first generated run reported. The hand-typed "41 of 53 = 77%" is gone, along with per-file counts that had drifted by up to 20 tests. `traceability.matrix` fails CI when a block no longer matches a re-run of the generator, and `traceability.proseCoverage` fails when a percentage appears outside a generated block. See [Generated traceability matrix](#generated-traceability-matrix-2026-10-30) and [Closing the generated gaps](#closing-the-generated-gaps-2026-10-30). |
| Duplicate handling | Fixed | `persist()` matches `(sourceId, fingerprint)` before create, so a posting served under several regional `sourceJobId` values refreshes one row instead of creating another. `duplicates:report` inventories historical groups read-only; `--apply` merges safe groups after a verified backup and skips application conflicts. Cross-source grouping remains intentionally unimplemented; `dedup.sameSource` guards the behavior. |
| Backlog | Open | Cross-source fingerprint deduplication remains unimplemented and is documented as such. **Content twins** — 98 measured groups where one source publishes the same opening once per city — are a separate, same-source problem that the fingerprint key cannot see; collapsing them in the list is an open product decision, measured by `duplicate-report.js --content`. PostgreSQL remains optional. A formal diagram source (`.mmd`/`.dot`) still does not exist; the generated facts JSON is the machine-readable inventory. `FR-030`'s "feeds future ranking" clause is unimplemented — the matcher never reads `Application.stage` (recorded as `Tested (partial)`, not as covered). Login latency is closed: the auth path uses the native `bcrypt` binding and `PASSWORD_COST = 11`, a warm login went 2.06–10.2 s → 0.82–0.90 s → 0.20–0.32 s, and accounts holding an older-cost hash are re-hashed on their next login; see [Measured: login latency](#measured-login-latency-on-the-live-stack-2026-10-30-native-binding-2026-10-31-cost-11-2026-11-01). `NFR-002`, `NFR-003`, `NFR-006` and `NFR-007` stay without automated evidence, stated in the generated GAPS block rather than hidden in a percentage. |

**Fingerprint duplicate assessment (2026-10-27).** The backlog item was evaluated against the local `backend/prisma/dev.db` (3,294 jobs, all fingerprinted). Duplicate fingerprints were counted by grouping `Job.fingerprint` and counting distinct `sourceId`:

| Measure | Result |
|---|---|
| Duplicate groups spanning more than one source | **0** |
| Duplicate groups within one source | 31 (66 jobs, 2.0% of the dataset) |
| User-visible duplicate groups (same fingerprint twice in one user's matches) | 5, affecting 1 user (38 match rows on duplicated jobs) |

Cross-source grouping would not change any result on this dataset, so it was not implemented. The residual same-source duplicates are an ingestion-side issue (the same Arbeitnow posting stored under more than one `sourceJobId`). A `(sourceId, fingerprint)` lookup now runs before `job.create`, so new duplicates are suppressed and the existing row is refreshed. Historical rows were inventoried and, after a verified backup, merged in the local `dev.db`; production was not touched. `npm run duplicates:report` inventories groups read-only, and `--apply` merges safe groups after a verified backup. Both paths were tested on copies: 31 groups merged, 35 duplicate jobs removed, 14 duplicate match rows and 32 duplicate skill links removed, with integrity and foreign-key checks clean; a synthetic application conflict caused that group to be skipped intact. Revisit cross-source grouping if production data shows groups spanning sources.

**Live runtime verification (2026-10-30).** `bash dev.sh` started the documented topology — NestJS on `:3210`, Next.js on `:3211`, SQLite at `backend/prisma/dev.db` — and `npx playwright test e2e/runtime-verification.spec.ts --project=desktop` drove it in Chromium: 5 passed.

| Check | Result |
|---|---|
| `GET :3210/api/health` | 200 `{"status":"ok"}` |
| `GET :3210/api/matches` (no token) | 401 |
| `POST /api/auth/register` → `login` | 201, JWT issued (239 chars) |
| `GET /api/matches` (token) | 200, `items` non-empty, `jobId`s unique |
| Rendered `/matches` list | Every `a.job-row` href and title+company pair distinct |
| Dashboard render | Scored top match (84%), daily digest "1474 jobs collected", unread alerts, live indicator |
| Duplicate groups after live collection | 0 across 3,440 fingerprinted jobs |

The last row is the dedup fix working under real load: the running backend collected ~180 new postings during the session and the read-only `duplicates:report` still found no `(sourceId, fingerprint)` group. Screenshots: `frontend/e2e-artifacts/dashboard.png`, `frontend/e2e-artifacts/matches.png`.

Two defects surfaced only because the stack was actually run, and both are now fixed: the watchdog restarted healthy services because it probed `/` (Nest returns 404 there) with a 3s timeout while the first `/login` compile took 26.6s, and `npm run test:e2e` could not load its own config in a CommonJS package.

### HagereJobs parser fixtures (2026-10-30)

`U06` was the last open audit item: the HagereJobs adapter scraped WordPress/Elementor listing
pages with no parser-level test. Four fixture tests in
`backend/src/modules/sources/adapters/adapters.spec.ts` now drive `fetchJobs()` against synthetic
listing HTML with `fetch` mocked, so no network is involved:

| Fixture | What it pins |
|---|---|
| Two dense Ethiopia cards + an empty international page | title, company, location, deadline, employment type, apply-link precedence over the detail URL, `sourceJobId`, `locationClass`, `country`, `currency`, `parseConfidence`, and that no field is shared between cards |
| A sparse international card | defaults: location `International`, `INTERNATIONAL_ONSITE`, company `Unknown`, no country, no deadline, `experienceLevel UNKNOWN` |
| A card whose fields sit before the apply link | the same fields read from a backward-ordered block |
| Two pages that yield no card | rejects with `HagereJobs returned no parseable jobs` |

The first fixture failed against the shipped parser: the second card received the first card's
title. `extractJobFromListing()` located `job_detail=NNN` with `html.indexOf(marker)` and parsed a
fixed ±1500-character window, so on a densely packed page the window reached into the neighbouring
card's `<h3 class="job-card-title">`. The parser now slices between consecutive markers and stops at
the next `article`/`li` element opening, with a backward slice when the title precedes the link. The
same pass changed seniority derivation to `deriveExperience([title, expText].join(' '))` — the helper
matches keywords only, so "Senior Accountant" resolves to `SENIOR` while "5 years" alone stays
`UNKNOWN`, which the fixtures assert rather than leave implicit.

**This is a robustness fix, not a production incident.** The 15 `hagerejobs` rows in the local
`dev.db` all carry a title and company that belong to the same posting, so the window bleed has not
triggered on the listings actually collected; it was reachable whenever cards sat closer than 1500
characters apart. Verification: `npx jest adapters -t HagereJobs` → 4 passed; full backend suite →
23 suites, 311 tests passed; `tsc --noEmit` clean.

### Generated traceability matrix (2026-10-30)

`U04` asked whether the documented "41 of 53 requirements covered (77%)" was real. It was not
reproducible: the requirement rows, per-file test counts, and file index in `docs/traceability.md`
were all typed by hand and had drifted (one row credited `FR-003a` to the profile-completion meter,
while the SRS defines `FR-003a` as CV Upload; `FR-024c` and `FR-034d` were listed as untested and
both have citing tests). Rather than retype the table, the generator now derives it.

`scripts/generate-traceability.js` reads requirement IDs out of the SRS headings and bold bullets
(`FR-*`, `NFR-*`, plus the `SEC-*` security labels), then walks every `describe`/`it`/`test` title in
the backend and frontend spec trees. A requirement is **Tested** when a test title names its ID —
including shorthand chains such as `(FR-013/014/036)`. Where a behaviour is genuinely tested but the
test title does not cite the ID, a curated mapping in `ALIASES` credits it; every clause in that
mapping is re-resolved against the real titles on each run, so a clause that matches nothing fails
the check instead of silently keeping an old claim alive. That is what made the first version of this
generator honest on its own: 12 of its 24 initial mapping guesses resolved to nothing and were
rejected by the run, not by review. **Deferred** exemptions are only honoured while the SRS sentence
quoted in `DEFERRED` still exists verbatim.

| Measure | Value |
|---|---|
| Requirements parsed from the SRS | 85 |
| Cited directly by a test title | 29 |
| Credited through the verified mapping | 34 |
| Tested | 63 |
| Deferred (excluded from the denominator) | 4 |
| In-scope without test evidence | 18 |
| **Coverage** | **63 ÷ 81 = 78%** |

Two checks keep it living. `traceability.matrix` re-runs the generator in `--check` mode and fails on
any drift in the four generated blocks; `traceability.proseCoverage` strips the generated blocks and
fails if a coverage percentage or test count appears anywhere else in the tracked docs. Both were
proven by injecting drift: changing `78%` to `91%` inside the generated block exited 1 with
`Traceability is stale`, and appending "Overall test coverage is 95%" outside a block exited 1 with
`[FAIL] traceability.proseCoverage`. The 18 remaining gaps are the working list for the next phase;
7 are backend behaviours with implementations that simply have no citing test, and the rest are the
non-functional harness (load, uptime, backup restore) that cannot be met by a unit test.

**Status update (same day):** that working list was worked through — see
[Closing the generated gaps](#closing-the-generated-gaps-2026-10-30). The table above is the first
generated run, kept as the record of what the hand-written matrix actually was.

**Operating requirement:** the existing production SQLite file has an incomplete `_prisma_migrations` history. Before deploying the guarded entrypoint, run the one-time baseline in `docs/ops-runbook.md`; the script refuses to start otherwise. The local `dev.db` had exactly that condition — an interrupted `20261027_sync_current_schema` row left behind by `migrate dev` — and was repaired with the documented two-step (`prisma migrate resolve --rolled-back`, then `db-migrate-safe.js --baseline`) after a verified backup and a rehearsal on a copy; `prisma migrate status` now reports "Database schema is up to date!" with row counts unchanged. Production was not touched. The migration and all destructive-path tests ran against copies.

### Closing the generated gaps (2026-10-30)

The first generated matrix left 18 in-scope requirements with no citing test. They were worked through
in order of how much user-visible risk each one covered, and the matrix now reports **76 of 81 tested
(94%)** with **zero unexplained gaps**. Five new spec files and one e2e spec carry the evidence:

| New evidence | Requirement(s) | Tests |
|---|---|---|
| `backend/src/modules/digest/digest.service.spec.ts` | `FR-021a`–`FR-021d` (digest composition, routing, suppression) | 8 |
| `backend/src/modules/lifecycle/lifecycle.tasks.spec.ts` | `FR-025`–`FR-029` scheduling cadence, `NFR-005` | 9 |
| `backend/src/modules/profile/profile.service.spec.ts` | `FR-003` completion meter, `FR-005` | 4 |
| `backend/src/modules/sources/sources.controller.spec.ts` | `FR-011`/`FR-012` source CRUD surface | 4 |
| `backend/src/modules/lifecycle/backup.service.spec.ts` | `NFR-008` nightly backup | 5 |
| `backend/src/common/security/cors-policy.ts` + `security.spec.ts` | `NFR-009` / `SEC-002` CORS allowlist | 9 |
| `frontend/e2e/onboarding.spec.ts` | `FR-003d` three-step wizard, resumable, skippable | 1 (browser) |

The remaining five are non-functional clauses that a `it()` title cannot prove: `NFR-001` is measured
against the running stack by `backend/scripts/nfr-test.ts` (`npm run nfr:check`), and `NFR-002`,
`NFR-003`, `NFR-006`, `NFR-007` have no automated evidence at all. They stay listed in the generated
GAPS block with that stated plainly, because an explanation is not coverage. `FR-030` is recorded as
`Tested (partial)`: the scoring and notification behaviour is tested, the SRS clause "feeds future
ranking" is not implemented — the matcher never reads `Application.stage`.

Two honesty mechanisms make those claims self-enforcing rather than decorative. `PARTIAL` notes and
`OPERATIONAL` notes are only honoured while the requirement is still in the state the note describes;
if a requirement gains a citing test, or a partial clause gets implemented, the generator exits 1 and
says the note is stale. Both were proven by injecting a bogus ID into each map and watching
`npm run traceability:check` fail, then restoring.

### Production CORS policy was unenforceable (2026-10-30)

`main.ts` passed a **predicate function** as the `cors` `origin` option. With `cors@2.8` — the version
this app installs — a predicate that returns `true` produces no `Access-Control-Allow-Origin` header at
all, so the configured `CORS_ORIGIN` allowlist silently rejected every configured origin in production
while looking correct in review. `backend/src/common/security/cors-policy.ts` now builds the enforceable
shape: an explicit origin array in production, `origin: true` in development, and a process that
refuses to boot when `NODE_ENV=production` and `CORS_ORIGIN` is unset rather than falling open. The
nine new tests drive the real `cors` middleware and assert on the response headers that actually come
back, not on the function's return value.

### Gate 6: browser runtime verification in CI (2026-10-30)

`.github/workflows/ci.yml` gained a sixth job that runs the product the way the runbook deploys it:
`node scripts/provision-test-db.js` creates a disposable SQLite database (`prisma db push
--force-reset` + demo seed), both apps are built, `node dist/main.js` and `next start` are launched
with an ephemeral `JWT_SECRET` and raised auth limits, `/api/health` is polled until ready, and
`npx playwright test e2e/runtime-verification.spec.ts e2e/onboarding.spec.ts --project=desktop` drives
Chromium against it. Artifacts (`e2e-artifacts/`, `test-results/`) upload on failure, and both server
logs are dumped. The provisioning step is the same module `scripts/run-tests.js` uses, so the browser
gate and the unit gate read identical data.

Rehearsed locally on 2026-10-30 against the production build and a fresh `ci-rehearse.db`: **6 passed
(2.0m)** — health 200, anonymous `/api/matches` 401, sign-in reaches the dashboard, authenticated
matches returns scored rows with unique `jobId`s, the rendered list has no duplicate postings, and the
onboarding wizard completes, persists, resumes and skips correctly. The QA account the onboarding spec
creates is deleted through `POST /api/account/delete` in a `finally` block, so the disposable database
stays the only thing the run touches.

The rehearsal earned its keep before it ever ran in CI: the first pass failed the sign-in test at the
45 s project default, and the run against the local `dev.db` surfaced the content-twin duplication
described in the next section. Timing each phase in Chromium showed the budget was being spent on
infrastructure rather than behaviour — a browser context costs ~2.5 s to start, `page.goto('/login')`
~5.5 s, and each test signs in again in its own context while the backend hashes passwords in
JavaScript. The spec now carries its own 150 s budget with those measurements in the comment, so the
gate fails on product behaviour instead of laptop speed.

### Measured: login latency on the live stack (2026-10-30; native binding 2026-10-31; cost 11 2026-11-01)

Profiling the same run produced the first hard performance numbers for `NFR-001` on this machine
(production build, real database). The cause was `bcryptjs` — pure JavaScript, cost 12 — running on
the request thread. It was fixed the next day by switching the auth path to the native `bcrypt`
binding, which does the same cost-12 work on libuv's thread pool.

| Call | Before (`bcryptjs`) | Native `bcrypt`, cost 12 | Native `bcrypt`, cost 11 |
|---|---|---|---|
| `POST /api/auth/login`, warm | 2.06–3.57 s | 0.82–0.90 s | 0.20–0.32 s |
| `POST /api/auth/login`, first call after boot | 10.4 s | — | 0.65 s (verify at 12, re-hash at 11) |
| 5 concurrent logins, slowest | 10.2 s | 3.0 s | 0.60–0.71 s wall for all five |
| Other API calls while 5 logins run | up to 0.17 s (single login) | p95 0.31 s, max 0.31 s | p95 0.16–0.20 s |
| `GET /api/matches` (authenticated) | 0.07 s | 0.10 s | 0.21 s p95 |
| `GET /api/jobs` | 0.20 s | 0.11 s | 0.08 s p95 |

Only the login rows move because of the cost; the authenticated-read rows are re-sampled in the same
runs and their spread is run-to-run noise, shown so the table is a full picture of one measurement
session rather than a claim that unrelated endpoints got faster.

The library swap was not a security change: cost 12 was unchanged then, and the two formats are
interchangeable, which was verified before any code moved. `bcrypt.compare()` accepts the `$2a$`
hashes `bcryptjs` wrote (checked against the live `dev.db`, where all 13 stored hashes were then
`$2a$`, including the admin's cost-12 pair), and new hashes are written `$2b$`, which `bcryptjs` also
read. Wrong passwords still return 401. Backend suite: 28 suites pass, 377 tests at the swap and 382
after the cost-11 policy added its own; the suite itself got
faster (95 s from 127 s) because its fixtures hash at cost 4. Gate 6 then signed in through the real
login form in Chromium against `dev.db` — 6 passed (1.2 m) — so both the legacy-hash read path and
the new-hash registration path ran in a browser.

**Closed by a decision, on 2026-11-01: cost 11.** NFR-001 asks for *every* API request under 500 ms,
and a cost-12 bcrypt hash cannot meet that on this CPU — the harness reported `Login (slowest of 3):
895 ms` as a warning. The two ways to close it were accepting a lower cost or scoping NFR-001's 500 ms
to non-auth endpoints and stating a separate login budget. The first was chosen, so the cost now comes
from `backend/src/common/security/password-policy.ts` (`PASSWORD_COST = 11`) and is read by the auth
service, the admin reset path and the seed rather than repeated as literals. 11 is still above the
OWASP floor of 10 for bcrypt; what was traded was ~2× the offline-cracking work per hash removed in
exchange for the auth endpoint meeting the same budget every other endpoint already met.

Because bcrypt records the cost inside each hash, existing accounts keep verifying at their own cost
until something re-hashes them, so `AuthService.login()` re-hashes when
`bcrypt.getRounds(storedHash) !== PASSWORD_COST` and folds the new hash into the `lastActiveAt` update
that login already performs — no extra write, and no user-visible migration. Measured on a `VACUUM
INTO` snapshot of `dev.db`: a login that carries a legacy cost-12 hash takes 653 ms once (verify at 12,
write at 11), and the same account afterwards answers in 197–321 ms; five concurrent logins at cost 11
finish in 601–713 ms with the interleaved dashboard reads at p95 160–203 ms. The harness verdict on a
warm stack is `Login (slowest of 3): 316ms` and `Dashboard while 5 logins run: p95 170ms`, both inside
the 500 ms budget. The first login after boot can still read slower than the steady state — cold
prepared statements and first-compiled routes, not the hash — which is why the figures below are the
second run of the suite.

This was also verified in a browser, not only over HTTP: the Gate 6 suite signed in through the real
login form against the live `dev.db` — 6 passed (20.3 s, from 1.2 m at cost 12) — and that run is what
converted `admin@jobhunter.et` from `$2a$12$` to `$2b$11$` in the real database, the same path a
long-standing user follows. Accounts that have not logged in since are still at their original cost and
will refresh on their next login.

Finding this required fixing the measurement first: `backend/scripts/nfr-test.ts` — the script
traceability credits with proving NFR-001 — requested the bare port paths (`/auth/login`,
`/dashboard`) while `main.ts` puts every route behind `/api`, so every request answered 404 and the
suite exited at login without measuring anything. Its data-quality panel had a second bug of the same
family: Prisma returns raw SQLite counts as `BigInt`, so `count === 0` was never true and clean data
reported as three failures ("Match scores out of range: 0 invalid"). Both are fixed; the current
honest output is 23 passed, 0 failed, 4 warnings:

```bash
cd backend
AUTH_RATE_MAX=500 AUTH_EMAIL_RATE_MAX=500 …   # the suite makes more auth calls than the 5/15 min budget
BACKEND_URL=… QA_ADMIN_EMAIL=… QA_ADMIN_PASSWORD=… npm run nfr:check
```

### SEC-007, SEC-010, SEC-011: controls declared in code with no test (2026-11-01)

The generated SECURITY table pairs each `SEC-xxx` control with the code that declares it and the test
that proves it. Three rows had the code and `**none**` for evidence, which is the shape this matrix
exists to catch: `SEC-007` (every upstream fetch capped so a hung source cannot stall the scheduler),
`SEC-010` (SQLite stores booleans as `Int` and JSON as text, so the access layer coerces on one engine
and must not on the other), `SEC-011` (the SSE stream authenticates like any other protected route,
from the HttpOnly `jh_token` cookie rather than a header).

Each now has a spec exercising its behaviour — `adapters/fetch-timeout.spec.ts`,
`prisma/prisma.service.spec.ts`, `events/events.controller.spec.ts`, 15 tests — and the SEC-007 one is
written as a tree-wide invariant rather than a single call site: it extracts every `fetch(...)` in the
production source and fails if any lacks a `signal`. **That test found a live defect on its first
run.** `TelegramService.pollOnce()` long-polls the Bot API with `?timeout=5` and had no signal at all,
while the SEC-007 comment two methods above it covered sends only. A Bot API that accepts the
connection and never answers leaves that `fetch` pending inside
`runExclusive('telegram-poll')`, which drops every subsequent poll tick — the bot stops answering all
users until the process restarts. It now carries `AbortSignal.timeout(20_000)`, comfortably above the
5 s window the server is asked to hold, so a normal empty poll cannot trip it; the SEC-007 spec pins
both the presence of the signal and the invariant that keeps the next adapter from repeating the miss.

The other two are boundary tests rather than bug hunts: SEC-010 asserts the coercion in both
directions (`bool(true)` is `1` on SQLite and stays `true` on PostgreSQL, an unparseable JSON column
yields `[]`/`null` instead of throwing), and SEC-011 asserts the stream refuses a token that would be
refused anywhere else — absent, unverifiable, from a deactivated account, or issued before a
"sign out everywhere" — and opens for the cookie-only browser case. Backend suite after the three
specs landed: 32 suites / 421 tests (2026-11-01), and the generated SECURITY table now shows evidence
on every control rather than three `**none**` rows.

### Content twins: one posting, one page per city (2026-10-30)

The Gate 6 rehearsal ran against the local `dev.db` as well as the seeded database, and on the account
with 2,123 matches the browser check found rows that are the same job twice to a human reader. Measured
with `npm run duplicates:report -- --content` (read-only, added the same day):

| Measure | Result |
|---|---|
| ACTIVE jobs sharing `(sourceId, title, company)` with another job | 98 groups |
| Groups whose members carry **distinct fingerprints** | 98 — the fingerprint guard cannot see any of them |
| Worst group | 7 rows for one posting (caronsale, Arbeitnow) |
| Users who saw two or more copies of a top-5 group in one list | 1 (the dev admin, whose threshold matches everything) |

The cause is not a broken guard. Arbeitnow publishes one page per city — `…-munster-78186`,
`…-bochum-216172`, `…-bonn-430061` — each with its own `sourceJobId`, its own URL (sometimes on a
different country domain), and a description that differs only in the location sentence. The fingerprint
is computed over company + title + location + body, so every city variant is a legitimately distinct
posting as far as stored data can tell.

That is exactly why this was not merged automatically: "same opening republished per city" and "two
genuine openings in two cities" are indistinguishable from the fields we store, and merging the second
case would hide real jobs. The audit's earlier conclusion — *cross-source* grouping would change no
result, because 0 duplicate fingerprints span sources — still holds; this is a different, same-source
phenomenon that the fingerprint measure never covered.

What shipped instead: the browser check now asserts the guarantee the data model can actually make (one
posting = title + company + location = one slot) and **reports** the extra title+company rows in CI
output rather than hiding them, and `duplicate-report.js --content` makes the population measurable on
demand. The product decision — collapse twins in the list behind an "also posted in N locations" line,
or leave them separate — is open, and now has numbers attached to it.

---

## Contents

1. Architecture health report
2. Traceability index
3. Diagram / model diff
4. Living architecture checks
5. Regeneration summary
6. Appendix — Raw check output

---

## Part 1 — Architecture health report

The full audit report follows, using the metadata, scope, and method declared above.

---

### 1. Verdict

**Overall trust: medium for the high-level topology; low for the structural counts, matching behaviour, traceability, and deployment story.**

The architecture artifacts describe the right system shape — a Next.js frontend, a NestJS API, Prisma over SQLite/PostgreSQL, background collection/matching crons, Telegram plus a web inbox, and SSE delivery. That shape is supported by code and configuration.

The artifacts are **not safe as a current source of truth** for model counts, adapter inventory, deduplication behaviour, matching eligibility, test coverage, or production deployment. They were last touched on **2026-08-28**; the latest inspected code commit is **2026-10-22** (`f0cf0ca`).

There is also **no machine-readable architecture model**. All diagrams are ASCII blocks inside Markdown, with no stable node/edge IDs and no `sourceRefs`, so diagram-to-code traceability cannot be automated today.

---

### 2. Evidence snapshot

| Fact | Observed value | Evidence | Confidence |
|---|---|---|---|
| Stack | Next.js 15.5, React 19.2, NestJS 10.4, Prisma 5.20, TypeScript | `frontend/package.json`, `backend/package.json` | high |
| Ports | Frontend 3211, backend 3210 | `frontend/package.json:7`, `dev.sh:29-30`, `docker-compose.yml:5-6` | high |
| Prisma models | **22** (SQLite and PostgreSQL schemas agree) | `backend/prisma/schema.prisma:18-391`; `schema.postgresql.prisma` | high |
| NestJS modules | **18** with a `.module.ts`; **20** module directories including `health` (controller) and `integration` (test-only) | `backend/src/app.module.ts:26-47`; module directory listing | high |
| Frontend routes | **19** `page.tsx` routes | `frontend/app/**/page.tsx` | high |
| Web job sources | **11** configured sources | `backend/src/modules/sources/source-configs.json` | high |
| Telegram channels | **3** (`tg-elelanajobs`, `tg-shegarjob`, `tg-ethiojobvacancy1`) | `backend/src/modules/sources/adapters/telegram-channels.config.ts:13-29` | high |
| Adapter classes | **12**: 11 web adapters + 1 parameterized Telegram adapter | `backend/src/modules/sources/sources.module.ts:8-19,41-47` | high |
| Knowledge base | **153** skills, **146** aliases, **17** role profiles, **31** role synonyms, **34** relationships | `backend/src/modules/matching/knowledge-base.json` | high |
| Scoring weights | 25 role / 30 skills / 15 experience / 15 location / 5 employment / 5 freshness / 5 salary | `backend/src/modules/matching/matching-engine.ts:598-605` | high |
| Match schedule | **10 minutes** (`MATCH_CYCLE_INTERVAL`) | `backend/src/modules/lifecycle/lifecycle.tasks.ts:28-30,117` | high |
| Collection schedule | 30 minutes FAST, 60 minutes DEEP, 24 hours digest | `lifecycle.tasks.ts:58-72,129-158` | high |
| Test inventory | **23** spec files, **252** `it`/`test` declarations (parameterized cases expand further) | `backend/src/**/*.spec.ts` | high |
| CI gates | 4 jobs: lint/typecheck, backend tests, frontend build, dependency audit | `.github/workflows/ci.yml:23-168` | high |
| Docs freshness | Docs last changed 2026-08-28; code last changed 2026-10-22 | `git log -1 --format='%h %cs %s' -- <path>` | high |
| Runtime health | Not verified; `curl :3210/api/health` and `:3211/login` failed to connect | local probe 2026-10-27 | unknown |

---

### 3. Artifact trust levels

| Artifact | Trust | Assessment |
|---|---|---|
| `docs/architecture-overview.md` | **Medium / stale** | L1/L2 topology and module purposes are broadly right. Counts, adapter list, dedup claim, matching schedule, and several behaviours are stale. |
| `docs/matching-engine-reference.md` | **Medium / stale and conflicting** | Weights, factor math, penalties, and knowledge-base structure are largely accurate. Empty-skill neutral, hard eligibility, role matching, seniority condition, and result shape are wrong. |
| `docs/traceability.md` | **Low** | Per-file test counts and the file index do not match the current test tree. Do not use the 77% figure for release decisions without regeneration. |
| `docs/ops-runbook.md` | **Low / conflicting** | Assumes PostgreSQL on 5432, `prisma migrate deploy`, and `pg_dump`; the Docker path uses a SQLite file and `prisma db push` in the entrypoint. |
| `docs/plans/category-aware-collection.md` | **Low status, content largely implemented** | Says “plan (not yet implemented)”, but the category mapper, taxonomy, `SourceRunCategory`, FAST/DEEP modes, and tests exist. |
| `README.md` | **Medium** | Stack and feature overview are current. Test count, route count, production database, and adapter count need reconciliation. |
| `.github/workflows/ci.yml` | **High for its gates** | Deterministic lint/test/build/audit jobs exist. No architecture-drift gate. |
| Prisma schema and backend source | **High as evidence** | Treated as the controlling evidence source for this audit. |

---

### 4. Findings

#### High severity

##### AH-01 — No machine-readable architecture model or diagram source

- **Classification:** missing
- **Evidence:** no `.dot`, `.dsl`, `.mmd`, or `.puml` files exist; diagrams are ASCII blocks in `docs/architecture-overview.md:13-51`, `README.md:51-84`, and `docs/ops-runbook.md:12-25`.
- **Impact:** diagrams cannot be diffed, validated, regenerated, or traced to code with stable IDs.
- **Action:** create a canonical Structurizr DSL (C4 context/container) or Graphviz DOT model with stable IDs and `sourceRefs`, then link it from the overview. Keep the ASCII blocks as illustrations only.

##### AH-02 — Prisma model count and data model are stale

- **Classification:** stale
- **Claim:** “16 Prisma Models” and the entity diagram in `docs/architecture-overview.md:46,134-150`.
- **Observed:** **22** models in `backend/prisma/schema.prisma:18-391`. The document omits `CvFile`, `ApplicationTransition`, `SourceRunCategory`, `Digest`, `MatchCycle`, and `BotState`, and refers to a `Source` model that is actually `JobSource`.
- **Impact:** anyone using the overview for schema work or data-lineage analysis will miss six models and misname the source entity.
- **Action:** replace the count and diagram with a generated model list, or point to a generated ER diagram.

##### AH-03 — Cross-source fingerprint deduplication is claimed but not implemented

- **Classification:** stale / aspirational
- **Claim:** “Cross-source: Fingerprint-based (URL + title hash) — prevents duplicate jobs from different sources” in `docs/architecture-overview.md:88-90`.
- **Observed:** `sources.service.ts` computes and stores `fingerprint` (`sources.service.ts:477-478`), but persistence is keyed by the Prisma unique constraint `(sourceId, sourceJobId)` (`schema.prisma:240`). `dedupeWithinRun()` groups only by `sourceJobId` inside one run (`sources.service.ts:530-544`). No query filters on `fingerprint`. `backend/scripts/QA-REPORT.md` (2026-08-25) already recorded fingerprint duplicates and noted the fingerprint was never used for deduplication.
- **Impact:** the architecture claims a duplicate-prevention layer that does not exist; cross-source duplicates remain possible.
- **Action:** either implement fingerprint lookup before `job.create`, or relabel the fingerprint as stored metadata only. Add a test proving the chosen behaviour.

##### AH-04 — Matching reference no longer describes the scoring contract

- **Classification:** stale and conflicting
- **Claims and observed code:**
  - Empty job skills: document says neutral **0.65** (`matching-engine-reference.md:78`; also `architecture-overview.md:181`); code uses **0.4** (`matching-engine.ts:323-330`).
  - Hard eligibility: document describes only penalties; code returns `score = 0` and `eligible = false` for remote-only/on-site conflicts, excluded entry-level roles, and jobs with fewer than two skill signals and role similarity below 0.5 (`matching-engine.ts:469-515,642-645`).
  - Result shape: document’s `MatchResult` lacks `eligible` and `ineligibleReasons` (`matching-engine-reference.md:230-244`; code `matching-engine.ts:399-411`).
  - Profile input: document’s `ProfileInput` lacks `excludeEntryLevel` (`matching-engine-reference.md:199-210`; code `matching-engine.ts:366-377`).
- **Impact:** downstream consumers, tests, and product decisions can assume a job with weak alignment still receives a partial score; in reality it is hard-filtered to zero.
- **Action:** update the reference with the eligibility gate, the 0.4 neutral, the result fields, and the new profile field. Add a dedicated section explaining which conditions are constraints vs preferences.

##### AH-05 — Traceability matrix is not reliable

- **Classification:** stale
- **Evidence:** `docs/traceability.md:114-136` claims per-file counts and a total of **~227** tests. The current tree has **23** spec files and **252** `it`/`test` declarations (parameterized cases expand further). Examples:
  - `auth.service.spec.ts`: claimed ~15, actual 1 declaration.
  - `adapters.spec.ts`: claimed 41, actual 51.
  - `matching-engine.spec.ts`: claimed ~22, actual 34.
  - `integration.spec.ts`: claimed 21, actual 10.
  - `sources.service.spec.ts`: claimed ~8, actual 20.
  - `applications.service.spec.ts`: claimed ~10, actual 2.
  - `security.spec.ts`: claimed 12, actual 3.
- **Missing from the index:** `url-safety.spec.ts`, `jobs.service.spec.ts`, `lifecycle.service.spec.ts`, `category-mapper.spec.ts`.
- **Adapter coverage gap:** the matrix says each of the 11 adapters parses fixtures (`traceability.md:47`). `adapters.spec.ts` covers 10 web adapters; `HagereJobsAdapter` appears only as a mock in `sources.service.spec.ts`, not as a parser test.
- **Impact:** coverage percentages and “tested” claims are not auditable.
- **Action:** regenerate the matrix from the test tree and CI output. Add the missing specs. Add a parser fixture test for HagereJobs or mark it explicitly as untested.

##### AH-06 — Source and adapter inventory is stale

- **Classification:** stale and conflicting
- **Claim:** “15 source adapters” and the adapter list in `docs/architecture-overview.md:7,29,69-73,117`; README says “11+ source adapters” (`README.md:34`) and “11 adapters” (`README.md:72`); traceability says 11 adapters (`traceability.md:47`).
- **Observed:** **11** configured web sources + **3** Telegram channels = **14** collection endpoints; **12** adapter classes (11 web + 1 parameterized Telegram adapter). The overview lists seven adapters that do not exist (`HaHuJobs`, `Himalayas`, `WorkingNomads`, `JobsFitty`, `LinkedIn`, `FindWork`, `WeWorkRemotely`), misspells `ReliefWeb`, and omits `Arbeitnow`, `ETCareers`, `Landing.jobs`, and the Telegram channels.
- **Impact:** source coverage, health monitoring, and failure analysis start from an incorrect inventory.
- **Action:** make `source-configs.json` + `telegram-channels.config.ts` the single source of truth, and generate the adapter table from them.

#### Medium severity

##### AH-07 — Source auto-disable rule is wrong

- **Classification:** stale, with a possible code inconsistency
- **Claim:** “Sources that fail 3+ consecutive cycles are auto-disabled” (`architecture-overview.md:73`).
- **Observed:** `HEALTH_WINDOW = 10`; auto-disable occurs only after a full 10-run window with **zero** successful runs (`sources.service.ts:33,580-589`). `HEALTH_AUTO_DISABLE_THRESHOLD = 50` is declared but not used in that condition.
- **Impact:** operators expect a faster circuit breaker than the code provides; the unused threshold constant makes the intended policy ambiguous.
- **Action:** document the actual 10-run/zero-success rule, or implement the intended threshold policy and add a test.

##### AH-08 — Matching cadence is wrong in the overview

- **Classification:** stale
- **Claim:** incremental matching runs “cron, every 30m” (`architecture-overview.md:96`).
- **Observed:** `MATCH_CYCLE_INTERVAL` defaults to **10 minutes** (`lifecycle.tasks.ts:28-30,117`). Collection remains 30 minutes; deep collection is 60 minutes.
- **Action:** update the pipeline description and distinguish collection cadence from matching cadence.

##### AH-09 — Role matching and seniority semantics are stale

- **Classification:** stale
- **Claims:**
  - “Exact substring match” for role similarity (`matching-engine-reference.md:57`).
  - Seniority penalty applies when the title contains senior keywords **or** the title matches a role synonym that includes “senior” (`matching-engine-reference.md:156-161`).
- **Observed:** role similarity uses token-aware phrase matching (`containsPhrase()`), so `"accountant"` matches `"senior accountant"` but not `"accounting"` (`matching-engine.ts:172-234`). The seniority penalty uses only the title regex `SENIORITY_RE` and a `<4 years` check; there is no synonym branch (`matching-engine.ts:416,620-630`).
- **Impact:** matching explanations and expected scores can diverge from the documented model for multi-word roles and senior synonyms.
- **Action:** update the role-similarity and penalty sections; add examples for token matching and for a synonym-only senior title.

##### AH-10 — Production deployment topology is conflicting

- **Classification:** conflicting / ambiguous
- **Evidence:**
  - README: “PostgreSQL (production) / SQLite (development)” (`README.md:94`).
  - Overview: current SQLite, production target PostgreSQL (`architecture-overview.md:191-199`).
  - Runbook: PostgreSQL on 5432, `prisma migrate deploy`, `pg_dump` backups (`ops-runbook.md:8-34,50-86`).
  - Docker path: `DATABASE_URL=file:/app/data/prod.db` (`docker-compose.yml:9`), entrypoint runs `prisma db push --skip-generate --accept-data-loss` (`docker-entrypoint.sh:10-11`).
- **Impact:** there are two incompatible production stories. A new operator cannot tell which database, migration method, or backup procedure is authoritative.
- **Action:** declare one supported production topology. If both are supported, split the runbook into “single-container SQLite” and “managed PostgreSQL” paths with separate commands and backup procedures.

##### AH-11 — Category-aware collection plan status is stale

- **Classification:** stale
- **Claim:** `docs/plans/category-aware-collection.md:4` says “Status: plan (not yet implemented)”.
- **Observed:** `category-mapper.ts`, `category-taxonomy.json`, `source-categories.json`, `SourceRunCategory`, FAST/DEEP modes, `pagesFetched`, `categoriesSearched`, and `category-mapper.spec.ts` exist. The file’s last commit is `b6071ff` (“all 255 tests passing — category-aware collection…”).
- **Impact:** readers may treat implemented behaviour as future work and miss the new collection modes.
- **Action:** mark it implemented (or partially implemented), record the actual behaviour and any remaining gaps, and link the tests.

##### AH-12 — Module map omits current modules

- **Classification:** missing
- **Observed:** 18 modules with `.module.ts`; the overview lists 17 and omits `matches` (`architecture-overview.md:112-130`). `health` is a controller registered in `app.module.ts:18,47`, and `integration` is a test-only directory, so neither belongs in the feature-module table, but both deserve a one-line note if the table claims completeness.
- **Action:** add `matches`; state that `health` is a controller-only module and `integration` is a test suite.

#### Low severity

##### AH-13 — Route count claims are approximate

- **Classification:** incomplete
- **Observed:** 19 `page.tsx` routes. The overview’s “17+” table lists 16 feature routes and omits `/`, `/error`, `/forbidden` (`architecture-overview.md:155-173`). README says “20+ routes” (`README.md:200`).
- **Action:** either say “19 page routes” or qualify the count as feature routes only.

##### AH-14 — `JWT_SECRET` is documented as required but the service boots without it

- **Classification:** ambiguous
- **Evidence:** the env table marks `JWT_SECRET` required (`architecture-overview.md:208`); `main.ts:20-22` and `auth.module.ts:15-34` auto-generate a random secret when it is missing or too short, warning that sessions will not survive restarts.
- **Impact:** “required” is correct for stable production sessions, but not for process startup.
- **Action:** describe it as “required for persistent sessions; auto-generated with a warning if absent.”

##### AH-15 — No version/commit metadata or ADRs

- **Classification:** maintainability gap
- **Observed:** artifacts say “Updated August 2026” but do not identify the commit or evidence snapshot. “Key Design Decisions” is prose, not ADRs (`architecture-overview.md:177-188`).
- **Action:** add `lastReviewedCommit` and `evidenceRefs` metadata to each artifact; move the five key decisions into short ADRs with code links.

---

### 5. What is safe to trust now

> Sections 5–8 are the audit-time assessment (2026-10-27) and are kept as written. Sections 6 and 7 list
> what had to change and what had no evidence yet; nearly all of it was closed the same week. The
> current state is the [remediation table](#remediation-status-2026-10-27-post-audit) at the top of this
> file, and the two open remainders are named in its Backlog row.

- The L1/L2 shape: browser → Next.js frontend → NestJS API → Prisma → SQLite/PostgreSQL.
- Ports 3211/3210, JWT/RBAC, SSE events, Telegram + web inbox, cron-based collection/matching, transition-graph 409 handling, and pseudonymization on account deletion.
- The scoring weights (25/30/15/15/5/5/5), the 153-skill knowledge base, and the factor formulas described in the reference, except for the stale items above.
- 22 Prisma models, 18 NestJS feature modules, 19 frontend page routes, 11 web sources + 3 Telegram channels, and 12 adapter classes.
- The CI gates themselves: lint/typecheck, backend tests, frontend build, dependency audit.

### 6. What must be updated before this is an architecture source of truth

1. Replace the ASCII model with a machine-readable source and stable IDs (AH-01).
2. Correct the Prisma model count/data model (AH-02).
3. Decide and document fingerprint deduplication (AH-03).
4. Rewrite the matching eligibility/neutral/input/result sections (AH-04, AH-08, AH-09).
5. Regenerate traceability from the test tree and CI (AH-05).
6. Generate the adapter/source inventory from config (AH-06).
7. Resolve the production deployment topology and migration/backup path (AH-10).
8. Mark the category-aware plan implemented (AH-11).
9. Add `matches` (and a note on `health`/`integration`) to the module map (AH-12).

### 7. What still needs evidence

- **Runtime topology:** no services were running; ports, health endpoint, SSE, and cron execution were not observed.
- **Actual production database:** SQLite vs PostgreSQL is unresolved.
- **Executed test count and pass/fail:** the static declaration count is 252; the full suite was not completed during this audit.
- **Requirement coverage:** the 41/53 and 77% figures in the traceability matrix cannot be reproduced from the current files.
- **Fingerprint deduplication intent:** product decision needed — implement it or remove the claim.
- **HagereJobs parser:** no fixture-level parser test was found.

### 8. Follow-up checks

Run the deterministic check script:

```bash
node scripts/check-architecture-health.js
node scripts/check-architecture-health.js --strict   # CI mode
```

The audit-time run reports **14 failed checks and 5 warnings**, matching the findings above. That is now
Gate 5 of CI: `node scripts/check-architecture-health.js --strict` runs on every PR, alongside
`generate-architecture-facts.js --check` and `generate-traceability.js --check`, so this kind of drift
fails a build instead of accumulating in a document. As of 2026-10-30 the same command reports
**25 passed, 0 failed, 0 warnings**.

---

## Part 2 — Traceability index

This is the human-readable companion to the machine-readable index in section 2.6. It records every checked node, edge, claim, and unresolved question.

### 2.1 Snapshot counts

| Metric | Value |
|---|---|
| `prismaModels` | 22 |
| `nestModulesWithModuleFile` | 18 |
| `nestModuleDirectories` | 20 |
| `frontendPageRoutes` | 19 |
| `configuredWebSources` | 11 |
| `telegramChannels` | 3 |
| `collectionEndpoints` | 14 |
| `adapterClasses` | 12 |
| `knowledgeBaseSkills` | 153 |
| `knowledgeBaseAliases` | 146 |
| `roleProfiles` | 17 |
| `roleSynonyms` | 31 |
| `testSpecFiles` | 28 |
| `testDeclarations` | 325 |
| `ciJobs` | 6 |

The last three rows are current as of 2026-10-30 and are the values `docs/architecture-facts.json`
generates today; the rest of the table is the audit-time snapshot. `ciJobs` went from 4 to 6 when Gate 5
(architecture drift) and Gate 6 (runtime verification) were added.

### 2.2 Nodes

| ID | Label | Type | State | Confidence | Source refs |
|---|---|---|---|---|---|
| `actor.user` | Job seeker / admin | actor | current | high | `frontend/app/login/page.tsx`<br>`frontend/app/register/page.tsx` |
| `service.frontend` | Next.js frontend | service | current | high | `frontend/package.json:7`<br>`frontend/app/layout.tsx`<br>`frontend/app/**/page.tsx` |
| `service.backend-api` | NestJS API | service | current | high | `backend/src/main.ts:56-65`<br>`backend/src/app.module.ts:26-47` |
| `module.auth` | auth | module | current | high | `backend/src/modules/auth/auth.module.ts`<br>`backend/src/app.module.ts:29` |
| `module.profile` | profile | module | current | high | `backend/src/modules/profile/profile.module.ts`<br>`backend/src/modules/profile/profile.controller.ts:27` |
| `module.matching` | matching | module | current | high | `backend/src/modules/matching/matching.module.ts`<br>`backend/src/modules/matching/matching-engine.ts`<br>`backend/src/modules/matching/matching.service.ts` |
| `module.sources` | sources | module | current | high | `backend/src/modules/sources/sources.module.ts`<br>`backend/src/modules/sources/sources.service.ts` |
| `module.notifications` | notifications | module | current | high | `backend/src/modules/notifications/notifications.module.ts`<br>`backend/src/modules/notifications/notifications.service.ts:29-165` |
| `module.telegram` | telegram | module | current | high | `backend/src/modules/telegram/telegram.module.ts`<br>`backend/src/modules/telegram/telegram.service.ts:241-278` |
| `module.lifecycle` | lifecycle | module | current | high | `backend/src/modules/lifecycle/lifecycle.module.ts`<br>`backend/src/modules/lifecycle/lifecycle.tasks.ts:95-206` |
| `module.applications` | applications | module | current | high | `backend/src/modules/applications/applications.module.ts`<br>`backend/src/modules/applications/applications.service.ts:8-29,105-147` |
| `module.events` | events | module | current | high | `backend/src/modules/events/events.module.ts`<br>`backend/src/modules/events/events.service.ts:51-84` |
| `module.matches` | matches | module | current | high | `backend/src/modules/matches/matches.module.ts`<br>`backend/src/app.module.ts:32` |
| `module.jobs` | jobs | module | current | high | `backend/src/modules/jobs/jobs.module.ts`<br>`backend/src/modules/jobs/job-fidelity.ts` |
| `module.admin` | admin | module | current | high | `backend/src/modules/admin/admin.module.ts`<br>`frontend/app/admin/dashboard/page.tsx`<br>`frontend/app/admin/users/page.tsx` |
| `module.dashboard` | dashboard | module | current | high | `backend/src/modules/dashboard/dashboard.module.ts`<br>`frontend/app/dashboard/page.tsx` |
| `module.account` | account | module | current | high | `backend/src/modules/account/account.module.ts`<br>`backend/src/modules/account/account.service.ts:42-97` |
| `module.digest` | digest | module | current | high | `backend/src/modules/digest/digest.module.ts`<br>`backend/src/modules/lifecycle/lifecycle.tasks.ts:158` |
| `module.salary` | salary | module | current | high | `backend/src/modules/salary/salary.module.ts` |
| `module.saved-jobs` | saved-jobs | module | current | high | `backend/src/modules/saved-jobs/saved-jobs.module.ts`<br>`frontend/app/saved/page.tsx` |
| `module.searches` | searches | module | current | high | `backend/src/modules/searches/searches.module.ts`<br>`frontend/app/searches/page.tsx` |
| `controller.health` | health controller | module | current | high | `backend/src/modules/health/health.controller.ts`<br>`backend/src/app.module.ts:18,47`<br>`docker-entrypoint.sh:20` |
| `database.sqlite` | SQLite database | database | current | high | `backend/prisma/schema.prisma:5-8`<br>`docker-compose.yml:9`<br>`docker-entrypoint.sh:10-11` |
| `database.postgresql` | PostgreSQL database | database | target | medium | `backend/prisma/schema.postgresql.prisma`<br>`docs/ops-runbook.md:8-34`<br>`README.md:94` |
| `store.cv-uploads` | CV file storage | database | current | high | `backend/src/modules/profile/profile.controller.ts:27`<br>`Dockerfile:43` |
| `external.job-boards` | External job boards and feeds | external-system | current | high | `backend/src/modules/sources/source-configs.json`<br>`backend/src/modules/sources/adapters/telegram-channels.config.ts:13-29` |
| `external.telegram-bot` | Telegram Bot API | external-system | current | high | `backend/src/modules/telegram/telegram.service.ts:241-278`<br>`backend/src/modules/notifications/notifications.service.ts:107` |
| `worker.lifecycle-crons` | Lifecycle cron workers | service | current | high | `backend/src/modules/lifecycle/lifecycle.tasks.ts:95-206` |
| `ci.pipeline` | GitHub Actions CI | service | current | high | `.github/workflows/ci.yml:23-168` |

### 2.3 Edges

| ID | From → To | Type | Sync | Protocol | Confidence |
|---|---|---|---|---|---|
| `edge.user-to-frontend` | `actor.user` → `service.frontend` | calls | sync | HTTP | high |
| `edge.frontend-to-api` | `service.frontend` → `service.backend-api` | calls | sync | HTTP | high |
| `edge.api-to-sqlite` | `service.backend-api` → `database.sqlite` | reads | sync | SQL | high |
| `edge.api-to-postgresql` | `service.backend-api` → `database.postgresql` | reads | sync | SQL | medium |
| `edge.sources-to-job-boards` | `module.sources` → `external.job-boards` | calls | sync | HTTP | high |
| `edge.sources-to-sqlite` | `module.sources` → `database.sqlite` | writes | sync | SQL | high |
| `edge.sources-to-matching` | `module.sources` → `module.matching` | calls | sync | in-process | high |
| `edge.matching-to-sqlite` | `module.matching` → `database.sqlite` | writes | sync | SQL | high |
| `edge.matching-to-notifications` | `module.matching` → `module.notifications` | calls | sync | in-process | high |
| `edge.notifications-to-telegram` | `module.notifications` → `module.telegram` | calls | sync | in-process | high |
| `edge.notifications-to-sqlite` | `module.notifications` → `database.sqlite` | writes | sync | SQL | high |
| `edge.notifications-to-events` | `module.notifications` → `module.events` | publishes | async | in-process | high |
| `edge.telegram-to-bot-api` | `module.telegram` → `external.telegram-bot` | calls | sync | HTTP | high |
| `edge.lifecycle-to-sources` | `worker.lifecycle-crons` → `module.sources` | calls | batch | in-process | high |
| `edge.lifecycle-to-matching` | `worker.lifecycle-crons` → `module.matching` | calls | batch | in-process | high |
| `edge.lifecycle-to-digest` | `worker.lifecycle-crons` → `module.digest` | calls | batch | in-process | high |
| `edge.profile-to-cv-store` | `module.profile` → `store.cv-uploads` | writes | sync | file | high |
| `edge.applications-to-sqlite` | `module.applications` → `database.sqlite` | writes | sync | SQL | high |
| `edge.ci-to-backend` | `ci.pipeline` → `service.backend-api` | validates | batch | in-process | high |
| `edge.ci-to-frontend` | `ci.pipeline` → `service.frontend` | validates | batch | in-process | high |

### 2.4 Claims

| ID | Artifact | Verdict | Claim | Observed | Confidence |
|---|---|---|---|---|---|
| `C01` | docs/architecture-overview.md | confirmed | Next.js frontend on 3211, NestJS backend on 3210, Prisma over SQLite/PostgreSQL. |  | high |
| `C02` | docs/architecture-overview.md:46,134-150 | stale | 16 Prisma models. | 22 models; six are absent from the document and 'Source' should be 'JobSource'. | high |
| `C03` | docs/architecture-overview.md:7,29,69-73,117 | stale | 15 source adapters with the listed adapter names. | 11 web sources + 3 Telegram channels = 14 endpoints; 12 adapter classes; seven listed adapters do not exist. | high |
| `C04` | docs/architecture-overview.md:88-90 | stale | Cross-source fingerprint deduplication prevents duplicates from different sources. | Fingerprint is stored only; dedupeWithinRun groups sourceJobId within one run; no fingerprint query exists. | high |
| `C05` | docs/matching-engine-reference.md:78 | stale | Jobs without extractable skills receive 0.65 skill credit. | Neutral value is 0.4. | high |
| `C06` | docs/matching-engine-reference.md:154-173,230-244 | stale | Matching uses penalties but no hard eligibility result. | Hard-ineligible jobs get score 0 and eligible=false; MatchResult exposes eligible and ineligibleReasons. | high |
| `C07` | docs/matching-engine-reference.md:199-210 | missing | ProfileInput has skills, targetRoles, locationTiers, remote, employmentTypes, years, minSalary, excludeOnsite. | ProfileInput also requires excludeEntryLevel. | high |
| `C08` | docs/architecture-overview.md:96 | stale | Incremental matching runs every 30 minutes. | MATCH_CYCLE_INTERVAL defaults to 10 minutes; collection is 30 minutes. | high |
| `C09` | docs/matching-engine-reference.md:57,156-161 | stale | Role similarity uses exact substring matching; seniority also fires via synonym match. | Token-aware phrase matching; seniority uses only the title regex and a <4-year check. | high |
| `C10` | docs/traceability.md:114-136 | stale | ~227 tests across the indexed files; per-file counts as listed. | 23 spec files, 252 it/test declarations; many per-file counts differ; four spec files are absent from the index. | high |
| `C11` | docs/traceability.md:47 | stale | Each of the 11 adapters parses fixtures in adapters.spec.ts. | Ten web adapters are parser-tested; HagereJobs is only mocked in the service test. | high |
| `C12` | docs/architecture-overview.md:73 | stale | Sources failing 3+ consecutive cycles are auto-disabled. | Auto-disable requires a full 10-run window with zero successes; HEALTH_AUTO_DISABLE_THRESHOLD=50 is unused. | high |
| `C13` | README.md:94; docs/ops-runbook.md:8-86; docker-compose.yml:9 | conflicting | PostgreSQL is the production database and Prisma migrations are the deployment path. | Docker production path uses a SQLite file and prisma db push --accept-data-loss; the runbook uses PostgreSQL and prisma migrate deploy. | high |
| `C14` | docs/plans/category-aware-collection.md:4 | stale | Category-aware collection is a plan, not yet implemented. | The mapper, taxonomy, SourceRunCategory model, and FAST/DEEP collection modes exist. | high |
| `C15` | docs/architecture-overview.md:112-130 | missing | The module map is complete. | matches is omitted; health is a controller-only module and integration is a test-only directory. | high |
| `C16` | README.md:200; docs/architecture-overview.md:155-173 | stale | 20+ frontend routes; 17+ feature routes. | 19 page routes; the overview lists 16 feature routes and omits /, /error, /forbidden. | high |
| `C17` | all architecture docs | stale | Updated August 2026. | Docs last changed 2026-08-28; code last changed 2026-10-22. | high |
| `C18` | architecture artifact set | missing | Architecture diagrams are maintained sources. | Only ASCII diagrams inside Markdown; no .dot/.dsl/.mmd/.puml source. | high |
| `C19` | docs/architecture-overview.md:208 | inferred | JWT_SECRET is required. | The service auto-generates a random secret when missing; persistent sessions require the env var. | high |
| `C20` | docs/architecture-overview.md:177-188 | missing | Key design decisions are recorded. | Five prose decisions; no ADR files or decision records with source links. | high |

### 2.5 Unknowns

| ID | Question | Why it matters | Next check |
|---|---|---|---|
| `U01` | Which production database and migration path is authoritative? | The README, runbook, and Docker path disagree; backup and migration procedures differ. | **Resolved 2026-10-27:** SQLite is authoritative; `db-migrate-safe.js` is the only migration path. Guarded by `deployment.db` and `deployment.migrations`. |
| `U02` | Do the services start and serve the documented ports and health endpoint? | No runtime evidence was collected; both local ports refused connections. | **Resolved 2026-10-30:** live stack verified in Chromium — see [Live runtime verification](#live-runtime-verification-2026-10-30). Re-run with `npx playwright test e2e/runtime-verification.spec.ts`. |
| `U03` | What is the executed test count and pass/fail status? | The traceability matrix and README disagree with the static declaration count. | **Resolved 2026-10-30:** 377 tests across 28 spec files pass (exit 0, 132 s); 325 static declarations, because parameterized cases expand at runtime. The counts in README, the overview, and `docs/traceability.md` are generated, not typed. |
| `U04` | Are 41/53 requirements actually covered? | The per-file counts and file index are stale, so the 77% figure is not reproducible. | **Resolved 2026-10-30:** `docs/traceability.md` is now *generated* from `JobHunter_SRS_v2.3.md` and the spec tree by `scripts/generate-traceability.js` — 85 requirements, 76 tested, 4 deferred, 94% coverage, 0 unexplained gaps. The hand-typed 41/53 figure is gone, and `traceability.matrix` + `traceability.proseCoverage` fail CI on any drift. See [Generated traceability matrix](#generated-traceability-matrix-2026-10-30) and [Closing the generated gaps](#closing-the-generated-gaps-2026-10-30). |
| `U05` | Should cross-source fingerprint deduplication be implemented or removed from the architecture? | It is a product/data-integrity decision, not only a documentation fix. | **Resolved 2026-10-27:** same-source `(sourceId, fingerprint)` guard implemented and tested; cross-source grouping intentionally left unimplemented because no measured group spans sources. |
| `U06` | Is HagereJobs parser output verified against a fixture? | The adapter exists but no parser-level test was found. | **Resolved 2026-10-30:** four fixture tests in `adapters.spec.ts` cover both card layouts, sparse cards, and the empty-listing failure; they found and fixed a real card-scoping defect. |

### 2.6 Machine-readable index (JSON)

<details>
<summary>Expand the raw traceability-index.json</summary>

```json
{
  "metadata": {
    "artifact": "JobHunter current-state traceability index",
    "generated": "2026-10-27",
    "scope": "Architecture claims in docs and README, checked against backend, frontend, Prisma, Docker, and CI sources.",
    "sourceRefPolicy": "resolvable",
    "controllingEvidence": [
      "backend/prisma/schema.prisma",
      "backend/src/app.module.ts",
      "backend/src/modules/**",
      "frontend/app/**/page.tsx",
      "frontend/package.json",
      "backend/package.json",
      ".github/workflows/ci.yml",
      "docker-compose.yml",
      "Dockerfile",
      "docker-entrypoint.sh"
    ],
    "trust": "medium for high-level topology; low for counts, matching behaviour, traceability, and deployment"
  },
  "counts": {
    "prismaModels": 22,
    "nestModulesWithModuleFile": 18,
    "nestModuleDirectories": 20,
    "frontendPageRoutes": 19,
    "configuredWebSources": 11,
    "telegramChannels": 3,
    "collectionEndpoints": 14,
    "adapterClasses": 12,
    "knowledgeBaseSkills": 153,
    "knowledgeBaseAliases": 146,
    "roleProfiles": 17,
    "roleSynonyms": 31,
    "testSpecFiles": 28,
    "testDeclarations": 325,
    "ciJobs": 6
  },
  "nodes": [
    {
      "id": "actor.user",
      "label": "Job seeker / admin",
      "type": "actor",
      "state": "current",
      "description": "Uses the web app, receives Telegram alerts, and manages matches and applications.",
      "sourceRefs": ["frontend/app/login/page.tsx", "frontend/app/register/page.tsx"],
      "confidence": "high"
    },
    {
      "id": "service.frontend",
      "label": "Next.js frontend",
      "type": "service",
      "state": "current",
      "description": "Next.js 15 / React 19 application on port 3211.",
      "sourceRefs": ["frontend/package.json:7", "frontend/app/layout.tsx", "frontend/app/**/page.tsx"],
      "confidence": "high"
    },
    {
      "id": "service.backend-api",
      "label": "NestJS API",
      "type": "service",
      "state": "current",
      "description": "NestJS 10 REST API and background process on port 3210.",
      "sourceRefs": ["backend/src/main.ts:56-65", "backend/src/app.module.ts:26-47"],
      "confidence": "high"
    },
    {
      "id": "module.auth",
      "label": "auth",
      "type": "module",
      "state": "current",
      "description": "Registration, login, JWT, roles, throttling, token revocation.",
      "sourceRefs": ["backend/src/modules/auth/auth.module.ts", "backend/src/app.module.ts:29"],
      "confidence": "high"
    },
    {
      "id": "module.profile",
      "label": "profile",
      "type": "module",
      "state": "current",
      "description": "Candidate profile CRUD and CV upload.",
      "sourceRefs": ["backend/src/modules/profile/profile.module.ts", "backend/src/modules/profile/profile.controller.ts:27"],
      "confidence": "high"
    },
    {
      "id": "module.matching",
      "label": "matching",
      "type": "module",
      "state": "current",
      "description": "Deterministic scoring engine and batch match cycles.",
      "sourceRefs": ["backend/src/modules/matching/matching.module.ts", "backend/src/modules/matching/matching-engine.ts", "backend/src/modules/matching/matching.service.ts"],
      "confidence": "high"
    },
    {
      "id": "module.sources",
      "label": "sources",
      "type": "module",
      "state": "current",
      "description": "Job source adapters, collection queue, health scoring, and ghost reconciliation.",
      "sourceRefs": ["backend/src/modules/sources/sources.module.ts", "backend/src/modules/sources/sources.service.ts"],
      "confidence": "high"
    },
    {
      "id": "module.notifications",
      "label": "notifications",
      "type": "module",
      "state": "current",
      "description": "Per-match delivery: Telegram first, web inbox fallback, SSE emission.",
      "sourceRefs": ["backend/src/modules/notifications/notifications.module.ts", "backend/src/modules/notifications/notifications.service.ts:29-165"],
      "confidence": "high"
    },
    {
      "id": "module.telegram",
      "label": "telegram",
      "type": "module",
      "state": "current",
      "description": "Bot polling, account linking, commands, inline buttons, and rate limiting.",
      "sourceRefs": ["backend/src/modules/telegram/telegram.module.ts", "backend/src/modules/telegram/telegram.service.ts:241-278"],
      "confidence": "high"
    },
    {
      "id": "module.lifecycle",
      "label": "lifecycle",
      "type": "module",
      "state": "current",
      "description": "Scheduled collection, match cycle, expiry, link-rot, retention, digest, and backup tasks.",
      "sourceRefs": ["backend/src/modules/lifecycle/lifecycle.module.ts", "backend/src/modules/lifecycle/lifecycle.tasks.ts:95-206"],
      "confidence": "high"
    },
    {
      "id": "module.applications",
      "label": "applications",
      "type": "module",
      "state": "current",
      "description": "Application stage transition graph and history.",
      "sourceRefs": ["backend/src/modules/applications/applications.module.ts", "backend/src/modules/applications/applications.service.ts:8-29,105-147"],
      "confidence": "high"
    },
    {
      "id": "module.events",
      "label": "events",
      "type": "module",
      "state": "current",
      "description": "Per-user SSE streams backed by RxJS Subjects.",
      "sourceRefs": ["backend/src/modules/events/events.module.ts", "backend/src/modules/events/events.service.ts:51-84"],
      "confidence": "high"
    },
    {
      "id": "module.matches",
      "label": "matches",
      "type": "module",
      "state": "current",
      "description": "Match read/query endpoints. Omitted from the architecture-overview module map.",
      "sourceRefs": ["backend/src/modules/matches/matches.module.ts", "backend/src/app.module.ts:32"],
      "confidence": "high"
    },
    {
      "id": "module.jobs",
      "label": "jobs",
      "type": "module",
      "state": "current",
      "description": "Job fidelity pipeline, URL liveness, and description quality.",
      "sourceRefs": ["backend/src/modules/jobs/jobs.module.ts", "backend/src/modules/jobs/job-fidelity.ts"],
      "confidence": "high"
    },
    {
      "id": "module.admin",
      "label": "admin",
      "type": "module",
      "state": "current",
      "description": "Stats, source health, user management, and admin actions.",
      "sourceRefs": ["backend/src/modules/admin/admin.module.ts", "frontend/app/admin/dashboard/page.tsx", "frontend/app/admin/users/page.tsx"],
      "confidence": "high"
    },
    {
      "id": "module.dashboard",
      "label": "dashboard",
      "type": "module",
      "state": "current",
      "description": "Aggregated stats for the frontend dashboard.",
      "sourceRefs": ["backend/src/modules/dashboard/dashboard.module.ts", "frontend/app/dashboard/page.tsx"],
      "confidence": "high"
    },
    {
      "id": "module.account",
      "label": "account",
      "type": "module",
      "state": "current",
      "description": "Deactivation and deletion with pseudonymization.",
      "sourceRefs": ["backend/src/modules/account/account.module.ts", "backend/src/modules/account/account.service.ts:42-97"],
      "confidence": "high"
    },
    {
      "id": "module.digest",
      "label": "digest",
      "type": "module",
      "state": "current",
      "description": "Daily digest generation.",
      "sourceRefs": ["backend/src/modules/digest/digest.module.ts", "backend/src/modules/lifecycle/lifecycle.tasks.ts:158"],
      "confidence": "high"
    },
    {
      "id": "module.salary",
      "label": "salary",
      "type": "module",
      "state": "current",
      "description": "Salary benchmarking data.",
      "sourceRefs": ["backend/src/modules/salary/salary.module.ts"],
      "confidence": "high"
    },
    {
      "id": "module.saved-jobs",
      "label": "saved-jobs",
      "type": "module",
      "state": "current",
      "description": "Save/unsave jobs per user.",
      "sourceRefs": ["backend/src/modules/saved-jobs/saved-jobs.module.ts", "frontend/app/saved/page.tsx"],
      "confidence": "high"
    },
    {
      "id": "module.searches",
      "label": "searches",
      "type": "module",
      "state": "current",
      "description": "Saved search profiles and manual runs.",
      "sourceRefs": ["backend/src/modules/searches/searches.module.ts", "frontend/app/searches/page.tsx"],
      "confidence": "high"
    },
    {
      "id": "controller.health",
      "label": "health controller",
      "type": "module",
      "state": "current",
      "description": "Health endpoint used by the Docker entrypoint and deployment checks.",
      "sourceRefs": ["backend/src/modules/health/health.controller.ts", "backend/src/app.module.ts:18,47", "docker-entrypoint.sh:20"],
      "confidence": "high"
    },
    {
      "id": "database.sqlite",
      "label": "SQLite database",
      "type": "database",
      "state": "current",
      "description": "Prisma SQLite datasource used by tests and the single-container Docker path.",
      "sourceRefs": ["backend/prisma/schema.prisma:5-8", "docker-compose.yml:9", "docker-entrypoint.sh:10-11"],
      "confidence": "high"
    },
    {
      "id": "database.postgresql",
      "label": "PostgreSQL database",
      "type": "database",
      "state": "target",
      "description": "Supported Prisma PostgreSQL schema and runbook target; actual production use is unresolved.",
      "sourceRefs": ["backend/prisma/schema.postgresql.prisma", "docs/ops-runbook.md:8-34", "README.md:94"],
      "confidence": "medium"
    },
    {
      "id": "store.cv-uploads",
      "label": "CV file storage",
      "type": "database",
      "state": "current",
      "description": "Local upload directory for CV files.",
      "sourceRefs": ["backend/src/modules/profile/profile.controller.ts:27", "Dockerfile:43"],
      "confidence": "high"
    },
    {
      "id": "external.job-boards",
      "label": "External job boards and feeds",
      "type": "external-system",
      "state": "current",
      "description": "Eleven configured web sources plus three Telegram channels.",
      "sourceRefs": ["backend/src/modules/sources/source-configs.json", "backend/src/modules/sources/adapters/telegram-channels.config.ts:13-29"],
      "confidence": "high"
    },
    {
      "id": "external.telegram-bot",
      "label": "Telegram Bot API",
      "type": "external-system",
      "state": "current",
      "description": "Bot API for outbound alerts and inbound polling.",
      "sourceRefs": ["backend/src/modules/telegram/telegram.service.ts:241-278", "backend/src/modules/notifications/notifications.service.ts:107"],
      "confidence": "high"
    },
    {
      "id": "worker.lifecycle-crons",
      "label": "Lifecycle cron workers",
      "type": "service",
      "state": "current",
      "description": "In-process @nestjs/schedule intervals for collection, matching, sweeps, digest, and backup.",
      "sourceRefs": ["backend/src/modules/lifecycle/lifecycle.tasks.ts:95-206"],
      "confidence": "high"
    },
    {
      "id": "ci.pipeline",
      "label": "GitHub Actions CI",
      "type": "service",
      "state": "current",
      "description": "Four jobs: lint/typecheck, backend tests, frontend build, dependency audit.",
      "sourceRefs": [".github/workflows/ci.yml:23-168"],
      "confidence": "high"
    }
  ],
  "edges": [
    {
      "id": "edge.user-to-frontend",
      "from": "actor.user",
      "to": "service.frontend",
      "type": "calls",
      "sync": "sync",
      "protocol": "HTTP",
      "description": "User opens the web application.",
      "sourceRefs": ["frontend/app/login/page.tsx", "frontend/app/layout.tsx"],
      "confidence": "high"
    },
    {
      "id": "edge.frontend-to-api",
      "from": "service.frontend",
      "to": "service.backend-api",
      "type": "calls",
      "sync": "sync",
      "protocol": "HTTP",
      "description": "REST API calls plus an SSE subscription for live updates.",
      "sourceRefs": ["frontend/lib/api-store.ts", "frontend/lib/use-match-stream.ts", "backend/src/modules/events/events.controller.ts"],
      "confidence": "high"
    },
    {
      "id": "edge.api-to-sqlite",
      "from": "service.backend-api",
      "to": "database.sqlite",
      "type": "reads",
      "sync": "sync",
      "protocol": "SQL",
      "description": "Prisma CRUD against the SQLite datasource.",
      "sourceRefs": ["backend/src/prisma/prisma.service.ts", "backend/prisma/schema.prisma"],
      "confidence": "high"
    },
    {
      "id": "edge.api-to-postgresql",
      "from": "service.backend-api",
      "to": "database.postgresql",
      "type": "reads",
      "sync": "sync",
      "protocol": "SQL",
      "description": "Supported PostgreSQL schema, selected by the database switch script. Production usage is unresolved.",
      "sourceRefs": ["backend/prisma/schema.postgresql.prisma", "backend/scripts/switch-db.sh", "docs/ops-runbook.md:8-34"],
      "confidence": "medium"
    },
    {
      "id": "edge.sources-to-job-boards",
      "from": "module.sources",
      "to": "external.job-boards",
      "type": "calls",
      "sync": "sync",
      "protocol": "HTTP",
      "description": "Adapters fetch JSON, RSS, HTML, and Telegram channel pages.",
      "sourceRefs": ["backend/src/modules/sources/adapters", "backend/src/modules/sources/sources.service.ts:213-387"],
      "confidence": "high"
    },
    {
      "id": "edge.sources-to-sqlite",
      "from": "module.sources",
      "to": "database.sqlite",
      "type": "writes",
      "sync": "sync",
      "protocol": "SQL",
      "description": "Persists jobs and source runs through Prisma.",
      "sourceRefs": ["backend/src/modules/sources/sources.service.ts:339-357,442-485"],
      "confidence": "high"
    },
    {
      "id": "edge.sources-to-matching",
      "from": "module.sources",
      "to": "module.matching",
      "type": "calls",
      "sync": "sync",
      "protocol": "in-process",
      "description": "Collection invokes incremental matching after a run.",
      "sourceRefs": ["backend/src/modules/sources/sources.service.ts:384"],
      "confidence": "high"
    },
    {
      "id": "edge.matching-to-sqlite",
      "from": "module.matching",
      "to": "database.sqlite",
      "type": "writes",
      "sync": "sync",
      "protocol": "SQL",
      "description": "Persists JobMatch rows and match-cycle records.",
      "sourceRefs": ["backend/src/modules/matching/matching.service.ts", "backend/prisma/schema.prisma:259-286,363-376"],
      "confidence": "high"
    },
    {
      "id": "edge.matching-to-notifications",
      "from": "module.matching",
      "to": "module.notifications",
      "type": "calls",
      "sync": "sync",
      "protocol": "in-process",
      "description": "Qualifying matches are handed to the notification router.",
      "sourceRefs": ["backend/src/modules/matching/matching.service.ts:197"],
      "confidence": "high"
    },
    {
      "id": "edge.notifications-to-telegram",
      "from": "module.notifications",
      "to": "module.telegram",
      "type": "calls",
      "sync": "sync",
      "protocol": "in-process",
      "description": "Telegram-first delivery when the user has a reachable link.",
      "sourceRefs": ["backend/src/modules/notifications/notifications.service.ts:77-107"],
      "confidence": "high"
    },
    {
      "id": "edge.notifications-to-sqlite",
      "from": "module.notifications",
      "to": "database.sqlite",
      "type": "writes",
      "sync": "sync",
      "protocol": "SQL",
      "description": "Creates Notification rows, including the web-inbox fallback.",
      "sourceRefs": ["backend/src/modules/notifications/notifications.service.ts", "backend/prisma/schema.prisma:316-331"],
      "confidence": "high"
    },
    {
      "id": "edge.notifications-to-events",
      "from": "module.notifications",
      "to": "module.events",
      "type": "publishes",
      "sync": "async",
      "protocol": "in-process",
      "description": "Emits match events to the user's SSE stream.",
      "sourceRefs": ["backend/src/modules/notifications/notifications.service.ts:119,135,164-165", "backend/src/modules/events/events.service.ts:75-84"],
      "confidence": "high"
    },
    {
      "id": "edge.telegram-to-bot-api",
      "from": "module.telegram",
      "to": "external.telegram-bot",
      "type": "calls",
      "sync": "sync",
      "protocol": "HTTP",
      "description": "Long-polls getUpdates and sends messages.",
      "sourceRefs": ["backend/src/modules/telegram/telegram.service.ts:241-278"],
      "confidence": "high"
    },
    {
      "id": "edge.lifecycle-to-sources",
      "from": "worker.lifecycle-crons",
      "to": "module.sources",
      "type": "calls",
      "sync": "batch",
      "protocol": "in-process",
      "description": "Scheduled FAST/DEEP collection.",
      "sourceRefs": ["backend/src/modules/lifecycle/lifecycle.tasks.ts:129-144"],
      "confidence": "high"
    },
    {
      "id": "edge.lifecycle-to-matching",
      "from": "worker.lifecycle-crons",
      "to": "module.matching",
      "type": "calls",
      "sync": "batch",
      "protocol": "in-process",
      "description": "Ten-minute match cycle and ghost detection.",
      "sourceRefs": ["backend/src/modules/lifecycle/lifecycle.tasks.ts:28-30,117-125"],
      "confidence": "high"
    },
    {
      "id": "edge.lifecycle-to-digest",
      "from": "worker.lifecycle-crons",
      "to": "module.digest",
      "type": "calls",
      "sync": "batch",
      "protocol": "in-process",
      "description": "Daily digest generation.",
      "sourceRefs": ["backend/src/modules/lifecycle/lifecycle.tasks.ts:158-166"],
      "confidence": "high"
    },
    {
      "id": "edge.profile-to-cv-store",
      "from": "module.profile",
      "to": "store.cv-uploads",
      "type": "writes",
      "sync": "sync",
      "protocol": "file",
      "description": "Stores uploaded CV files on local disk.",
      "sourceRefs": ["backend/src/modules/profile/profile.controller.ts:27"],
      "confidence": "high"
    },
    {
      "id": "edge.applications-to-sqlite",
      "from": "module.applications",
      "to": "database.sqlite",
      "type": "writes",
      "sync": "sync",
      "protocol": "SQL",
      "description": "Persists application stages and transition history.",
      "sourceRefs": ["backend/src/modules/applications/applications.service.ts:105-147", "backend/prisma/schema.prisma:288-314"],
      "confidence": "high"
    },
    {
      "id": "edge.ci-to-backend",
      "from": "ci.pipeline",
      "to": "service.backend-api",
      "type": "validates",
      "sync": "batch",
      "protocol": "in-process",
      "description": "Typecheck, tests, and dependency audit.",
      "sourceRefs": [".github/workflows/ci.yml:27-111,141-168"],
      "confidence": "high"
    },
    {
      "id": "edge.ci-to-frontend",
      "from": "ci.pipeline",
      "to": "service.frontend",
      "type": "validates",
      "sync": "batch",
      "protocol": "in-process",
      "description": "TypeScript check and production build.",
      "sourceRefs": [".github/workflows/ci.yml:61-67,116-136"],
      "confidence": "high"
    }
  ],
  "claims": [
    {
      "id": "C01",
      "artifact": "docs/architecture-overview.md",
      "claim": "Next.js frontend on 3211, NestJS backend on 3210, Prisma over SQLite/PostgreSQL.",
      "verdict": "confirmed",
      "evidence": ["frontend/package.json:7", "dev.sh:29-30", "backend/src/main.ts:56-65", "backend/prisma/schema.prisma:5-8"],
      "confidence": "high"
    },
    {
      "id": "C02",
      "artifact": "docs/architecture-overview.md:46,134-150",
      "claim": "16 Prisma models.",
      "verdict": "stale",
      "evidence": ["backend/prisma/schema.prisma:18-391"],
      "confidence": "high",
      "observed": "22 models; six are absent from the document and 'Source' should be 'JobSource'."
    },
    {
      "id": "C03",
      "artifact": "docs/architecture-overview.md:7,29,69-73,117",
      "claim": "15 source adapters with the listed adapter names.",
      "verdict": "stale",
      "evidence": ["backend/src/modules/sources/source-configs.json", "backend/src/modules/sources/adapters/telegram-channels.config.ts:13-29", "backend/src/modules/sources/sources.module.ts:8-19,41-47"],
      "confidence": "high",
      "observed": "11 web sources + 3 Telegram channels = 14 endpoints; 12 adapter classes; seven listed adapters do not exist."
    },
    {
      "id": "C04",
      "artifact": "docs/architecture-overview.md:88-90",
      "claim": "Cross-source fingerprint deduplication prevents duplicates from different sources.",
      "verdict": "stale",
      "evidence": ["backend/src/modules/sources/sources.service.ts:297-312,477-478,530-544", "backend/prisma/schema.prisma:240"],
      "confidence": "high",
      "observed": "Fingerprint is stored only; dedupeWithinRun groups sourceJobId within one run; no fingerprint query exists."
    },
    {
      "id": "C05",
      "artifact": "docs/matching-engine-reference.md:78",
      "claim": "Jobs without extractable skills receive 0.65 skill credit.",
      "verdict": "stale",
      "evidence": ["backend/src/modules/matching/matching-engine.ts:323-330"],
      "confidence": "high",
      "observed": "Neutral value is 0.4."
    },
    {
      "id": "C06",
      "artifact": "docs/matching-engine-reference.md:154-173,230-244",
      "claim": "Matching uses penalties but no hard eligibility result.",
      "verdict": "stale",
      "evidence": ["backend/src/modules/matching/matching-engine.ts:469-515,642-645"],
      "confidence": "high",
      "observed": "Hard-ineligible jobs get score 0 and eligible=false; MatchResult exposes eligible and ineligibleReasons."
    },
    {
      "id": "C07",
      "artifact": "docs/matching-engine-reference.md:199-210",
      "claim": "ProfileInput has skills, targetRoles, locationTiers, remote, employmentTypes, years, minSalary, excludeOnsite.",
      "verdict": "missing",
      "evidence": ["backend/src/modules/matching/matching-engine.ts:366-377"],
      "confidence": "high",
      "observed": "ProfileInput also requires excludeEntryLevel."
    },
    {
      "id": "C08",
      "artifact": "docs/architecture-overview.md:96",
      "claim": "Incremental matching runs every 30 minutes.",
      "verdict": "stale",
      "evidence": ["backend/src/modules/lifecycle/lifecycle.tasks.ts:28-30,117"],
      "confidence": "high",
      "observed": "MATCH_CYCLE_INTERVAL defaults to 10 minutes; collection is 30 minutes."
    },
    {
      "id": "C09",
      "artifact": "docs/matching-engine-reference.md:57,156-161",
      "claim": "Role similarity uses exact substring matching; seniority also fires via synonym match.",
      "verdict": "stale",
      "evidence": ["backend/src/modules/matching/matching-engine.ts:172-234,416,620-630"],
      "confidence": "high",
      "observed": "Token-aware phrase matching; seniority uses only the title regex and a <4-year check."
    },
    {
      "id": "C10",
      "artifact": "docs/traceability.md:114-136",
      "claim": "~227 tests across the indexed files; per-file counts as listed.",
      "verdict": "stale",
      "evidence": ["backend/src/**/*.spec.ts"],
      "confidence": "high",
      "observed": "23 spec files, 252 it/test declarations; many per-file counts differ; four spec files are absent from the index."
    },
    {
      "id": "C11",
      "artifact": "docs/traceability.md:47",
      "claim": "Each of the 11 adapters parses fixtures in adapters.spec.ts.",
      "verdict": "stale",
      "evidence": ["backend/src/modules/sources/adapters/adapters.spec.ts", "backend/src/modules/sources/sources.service.spec.ts:60-62"],
      "confidence": "high",
      "observed": "Ten web adapters are parser-tested; HagereJobs is only mocked in the service test."
    },
    {
      "id": "C12",
      "artifact": "docs/architecture-overview.md:73",
      "claim": "Sources failing 3+ consecutive cycles are auto-disabled.",
      "verdict": "stale",
      "evidence": ["backend/src/modules/sources/sources.service.ts:32-34,580-589"],
      "confidence": "high",
      "observed": "Auto-disable requires a full 10-run window with zero successes; HEALTH_AUTO_DISABLE_THRESHOLD=50 is unused."
    },
    {
      "id": "C13",
      "artifact": "README.md:94; docs/ops-runbook.md:8-86; docker-compose.yml:9",
      "claim": "PostgreSQL is the production database and Prisma migrations are the deployment path.",
      "verdict": "conflicting",
      "evidence": ["README.md:94", "docs/ops-runbook.md:8-34,50-86", "docker-compose.yml:9", "docker-entrypoint.sh:10-11"],
      "confidence": "high",
      "observed": "Docker production path uses a SQLite file and prisma db push --accept-data-loss; the runbook uses PostgreSQL and prisma migrate deploy."
    },
    {
      "id": "C14",
      "artifact": "docs/plans/category-aware-collection.md:4",
      "claim": "Category-aware collection is a plan, not yet implemented.",
      "verdict": "stale",
      "evidence": ["backend/src/modules/sources/categories/category-mapper.ts", "backend/src/modules/sources/categories/category-taxonomy.json", "backend/prisma/schema.prisma:172-188", "backend/src/modules/sources/sources.service.ts:214-260"],
      "confidence": "high",
      "observed": "The mapper, taxonomy, SourceRunCategory model, and FAST/DEEP collection modes exist."
    },
    {
      "id": "C15",
      "artifact": "docs/architecture-overview.md:112-130",
      "claim": "The module map is complete.",
      "verdict": "missing",
      "evidence": ["backend/src/modules/matches/matches.module.ts", "backend/src/app.module.ts:18,32,47"],
      "confidence": "high",
      "observed": "matches is omitted; health is a controller-only module and integration is a test-only directory."
    },
    {
      "id": "C16",
      "artifact": "README.md:200; docs/architecture-overview.md:155-173",
      "claim": "20+ frontend routes; 17+ feature routes.",
      "verdict": "stale",
      "evidence": ["frontend/app/**/page.tsx"],
      "confidence": "high",
      "observed": "19 page routes; the overview lists 16 feature routes and omits /, /error, /forbidden."
    },
    {
      "id": "C17",
      "artifact": "all architecture docs",
      "claim": "Updated August 2026.",
      "verdict": "stale",
      "evidence": ["docs/architecture-overview.md", "backend/src"],
      "confidence": "high",
      "observed": "Docs last changed 2026-08-28; code last changed 2026-10-22."
    },
    {
      "id": "C18",
      "artifact": "architecture artifact set",
      "claim": "Architecture diagrams are maintained sources.",
      "verdict": "missing",
      "evidence": ["docs/architecture-overview.md:13-51", "README.md:51-84", "docs/ops-runbook.md:12-25"],
      "confidence": "high",
      "observed": "Only ASCII diagrams inside Markdown; no .dot/.dsl/.mmd/.puml source."
    },
    {
      "id": "C19",
      "artifact": "docs/architecture-overview.md:208",
      "claim": "JWT_SECRET is required.",
      "verdict": "inferred",
      "evidence": ["backend/src/main.ts:20-22", "backend/src/modules/auth/auth.module.ts:15-34"],
      "confidence": "high",
      "observed": "The service auto-generates a random secret when missing; persistent sessions require the env var."
    },
    {
      "id": "C20",
      "artifact": "docs/architecture-overview.md:177-188",
      "claim": "Key design decisions are recorded.",
      "verdict": "missing",
      "evidence": ["docs/"],
      "confidence": "high",
      "observed": "Five prose decisions; no ADR files or decision records with source links."
    }
  ],
  "unknowns": [
    {
      "id": "U01",
      "question": "Which production database and migration path is authoritative?",
      "whyItMatters": "The README, runbook, and Docker path disagree; backup and migration procedures differ.",
      "nextCheck": "Confirm the actual deployment target and run a restore drill against it.",
      "status": "resolved 2026-10-27: SQLite authoritative, db-migrate-safe.js the only migration path"
    },
    {
      "id": "U02",
      "question": "Do the services start and serve the documented ports and health endpoint?",
      "whyItMatters": "No runtime evidence was collected; both local ports refused connections.",
      "nextCheck": "Start the stack and run a smoke test against /api/health and the frontend routes.",
      "status": "resolved 2026-10-30: live stack verified in Chromium by frontend/e2e/runtime-verification.spec.ts"
    },
    {
      "id": "U03",
      "question": "What is the executed test count and pass/fail status?",
      "whyItMatters": "The traceability matrix and README disagree with the static declaration count.",
      "nextCheck": "Run the backend test suite in CI and publish the jest summary next to the matrix.",
      "status": "resolved 2026-10-30: 377 tests pass across 28 spec files (325 declarations)"
    },
    {
      "id": "U04",
      "question": "Are 41/53 requirements actually covered?",
      "whyItMatters": "The per-file counts and file index are stale, so the 77% figure is not reproducible.",
      "nextCheck": "Regenerate requirement-to-test mappings from test names and requirement IDs.",
      "status": "resolved 2026-10-30: docs/traceability.md is now generated from JobHunter_SRS_v2.3.md and the spec tree (85 requirements, 76 tested, 4 deferred = 94%, 0 unexplained gaps); the hand-typed 41/53 figure is gone and two CI checks (traceability.matrix, traceability.proseCoverage) fail on drift"
    },
    {
      "id": "U05",
      "question": "Should cross-source fingerprint deduplication be implemented or removed from the architecture?",
      "whyItMatters": "It is a product/data-integrity decision, not only a documentation fix.",
      "nextCheck": "Decide with the product owner; add a test either way.",
      "status": "resolved 2026-10-27: same-source fingerprint guard implemented and tested; cross-source grouping intentionally unimplemented (no measured group spans sources)"
    },
    {
      "id": "U06",
      "question": "Is HagereJobs parser output verified against a fixture?",
      "whyItMatters": "The adapter exists but no parser-level test was found.",
      "nextCheck": "Add a fixture parser test or document the coverage gap.",
      "status": "resolved 2026-10-30: 4 fixture tests in adapters.spec.ts cover both card layouts, sparse cards, and the empty-listing failure; they exposed and fixed a card-scoping defect in hagerejobs.adapter.ts"
    }
  ]
}
```

</details>

---

## Part 3 — Diagram / model diff

**Audit date:** 2026-10-27  
**Compared artifacts:** ASCII diagrams and tables in `docs/architecture-overview.md`, `README.md`, and `docs/ops-runbook.md`.  
**Controlling evidence:** `backend/prisma/schema.prisma`, `backend/src/app.module.ts`, backend module source, `frontend/app/**/page.tsx`, Docker files, and CI.  
**Limitation:** there is no prior machine-readable model (`.dsl`, `.dot`, `.mmd`, `.puml`) to patch. This is a **claim-level semantic diff**, not a source diff. The proposed corrections below are inputs for a future canonical model.

---

### 1. Node diff

| Documented node / count | Where documented | Evidence | Verdict | Proposed correction |
|---|---|---|---|---|
| Next.js frontend on 3211 | `architecture-overview.md:14-21` | `frontend/package.json:7`, `dev.sh:30` | **confirmed** | Keep; add stable ID `service.frontend`. |
| NestJS backend on 3210 | `architecture-overview.md:23-42` | `backend/src/main.ts:56-65`, `dev.sh:29` | **confirmed** | Keep; add stable ID `service.backend-api`. |
| SQLite / PostgreSQL via Prisma | `architecture-overview.md:44-50` | `schema.prisma:5-8`, `schema.postgresql.prisma` | **confirmed** | Keep, but split current vs target state explicitly. |
| 16 Prisma models | `architecture-overview.md:46,134` | `schema.prisma:18-391` (22 models) | **stale** | Replace with 22; add six missing models and rename `Source` to `JobSource`. |
| 15 source adapters | `architecture-overview.md:7,29,69-73,117` | 11 web sources + 3 Telegram channels; 12 adapter classes | **stale** | Replace with 14 collection endpoints / 12 adapter classes; generate from config. |
| Adapter list including HaHuJobs, Himalayas, WorkingNomads, JobsFitty, LinkedIn, FindWork, WeWorkRemotely | `architecture-overview.md:71` | Those adapter files do not exist | **stale** | Remove; add Arbeitnow, ETCareers, Landing.jobs, Telegram channels. |
| Module map of 17 modules | `architecture-overview.md:112-130` | 18 modules with `.module.ts`; `matches` omitted | **missing** | Add `matches`; note `health` is a controller and `integration` is a test suite. |
| 17+ frontend routes | `architecture-overview.md:155-173` | 19 `page.tsx` routes; 16 listed | **stale** | Say 19 page routes or qualify as feature routes; add `/`, `/error`, `/forbidden`. |
| 130+ skills knowledge base | `architecture-overview.md:93` | 153 skills, 146 aliases | **confirmed** | Keep; optionally state 153. |
| Telegram + Web Inbox notifications | `architecture-overview.md:100-106` | `notifications.service.ts:77-135` | **confirmed** | Keep. |
| SSE live updates | `architecture-overview.md:39-40` | `events.service.ts:51-84` | **confirmed** | Keep. |
| Lifecycle crons / sweeps | `architecture-overview.md:33-36` | `lifecycle.tasks.ts:95-206` | **confirmed** | Keep; correct cadence in the edge section. |
| Admin dashboard and user management | `architecture-overview.md:33-36,171-173` | `admin` module, `frontend/app/admin/**` | **confirmed** | Keep. |
| Current SQLite → target PostgreSQL | `architecture-overview.md:191-199` | Docker path uses SQLite; runbook uses PostgreSQL | **conflicting** | Declare one authoritative production topology. |
| Cross-source fingerprint dedup | `architecture-overview.md:88-90` | Fingerprint stored, never queried | **missing** | Implement or remove; do not draw it as an active path. |
| Sources auto-disabled after 3 failures | `architecture-overview.md:73` | 10-run window with zero successes | **stale** | Correct the rule or change the code. |
| PostgreSQL on 5432 as current production DB | `ops-runbook.md:8-34` | `docker-compose.yml:9` uses SQLite | **conflicting** | Split runbook paths by deployment mode. |
| 20+ frontend routes | `README.md:200` | 19 page routes | **stale** | Use 19 or define what is counted. |

---

### 2. Edge diff

| Documented edge | Where documented | Evidence | Verdict | Proposed correction |
|---|---|---|---|---|
| Frontend → backend REST + SSE | `architecture-overview.md:21-22` | `frontend/lib`, `events.controller.ts` | **confirmed** | Keep; label `calls` + `subscribes`. |
| Backend → database via Prisma | `architecture-overview.md:42-50` | `prisma.service.ts`, schema | **confirmed** | Keep; separate SQLite current and PostgreSQL target. |
| Source adapters → external job boards | `architecture-overview.md:60-73` | 11 adapters + 3 Telegram channels | **confirmed** | Keep; update endpoint count. |
| Collection → matching | `architecture-overview.md:91-99` | `sources.service.ts:384` | **confirmed** | Keep; label `calls` / in-process. |
| Matching → notification | `architecture-overview.md:100-106` | `matching.service.ts:197` | **confirmed** | Keep. |
| Notification → Telegram | `architecture-overview.md:100-104` | `notifications.service.ts:107` | **confirmed** | Keep. |
| Notification → Web Inbox | `architecture-overview.md:100-106` | `Notification` model + fallback path | **confirmed** | Keep; label `writes`. |
| Lifecycle cron → collection / match / digest | `architecture-overview.md:33-36` | `lifecycle.tasks.ts:117-166` | **confirmed** | Keep; add cadence: 30m/10m/24h. |
| Lifecycle cron → sources every 30m | `architecture-overview.md:69` | 30m FAST, 60m DEEP | **confirmed** | Add the DEEP 60m path as a separate edge. |
| Matching cron every 30m | `architecture-overview.md:96` | 10m `MATCH_CYCLE_INTERVAL` | **stale** | Change to 10m. |
| Cross-source fingerprint edge | `architecture-overview.md:88-90` | No fingerprint lookup | **missing** | Do not draw as active; add an `Unknown / validate next` branch or implement it. |
| Telegram → backend polling | Not in the overview diagram | `telegram.service.ts:241-278` | **missing** | Add an inbound edge `polls` from Telegram Bot API to the Telegram module. |
| CV upload → local file storage | Not in the overview diagram | `profile.controller.ts:27`, `Dockerfile:43` | **missing** | Add `writes` edge to `store.cv-uploads`. |
| CI → lint/test/build | `README.md:97,219-228` | `.github/workflows/ci.yml:23-168` | **confirmed** | Keep; add architecture-health check. |

---

### 3. Semantic diff summary

- **Confirmed:** high-level topology, port mapping, Prisma usage, source collection, matching trigger, Telegram/web-inbox delivery, SSE, lifecycle crons, CI gates.
- **Stale:** Prisma model count, adapter/source inventory, matching cadence, source auto-disable rule, role matching and seniority semantics, traceability counts.
- **Missing:** `matches` module, cross-source fingerprint dedup, inbound Telegram polling edge, CV storage edge, machine-readable model.
- **Conflicting:** PostgreSQL production vs SQLite Docker path; `prisma migrate deploy` vs `prisma db push`.
- **Unknown:** actual runtime topology and health; executed test count; requirement coverage; fingerprint dedup intent; HagereJobs parser coverage.

The main correction is not cosmetic: the documented architecture currently claims a deduplication layer and a matching behaviour that the code does not implement. A regenerated model should mark those as **unknown** or **not implemented**, not as confirmed paths.

---

### 4. Proposed model patch order

1. Add stable IDs and `sourceRefs` for the confirmed nodes and edges above.
2. Replace counts and adapter lists with generated values from schema/config.
3. Split `current` (SQLite) from `target` (PostgreSQL) database nodes.
4. Add `matches`, `health`, and CV storage nodes.
5. Add the inbound Telegram polling edge.
6. Mark fingerprint dedup as `not implemented` until a product decision and test exist.
7. Regenerate the matching section from `matching-engine.ts`, not from the previous prose.

---

## Part 4 — Living architecture checks

**Purpose:** keep architecture claims aligned with the code, schema, configuration, and test tree. The checks are deterministic, dependency-free, and safe to run locally or in CI.

**Current implementation:** `scripts/check-architecture-health.js`  
**Run locally:**

```bash
node scripts/check-architecture-health.js
```

**CI mode (non-zero exit on drift):**

```bash
node scripts/check-architecture-health.js --strict
```

The results in the catalogue below are the audit-time (2026-10-27) snapshot: **14 failed checks and 5 warnings**. After remediation the same command reports **25 passed, 0 failed, 0 warnings** (2026-10-30; see [`check-output-post-remediation.txt`](check-output-post-remediation.txt)). `sources.count` was folded into `sources.inventory`, and five checks were added during the work — `dedup.sameSource`, `db.migrations`, `deployment.devlauncher`, `traceability.proseCounts`, and `facts.current` — each listed at the end of the catalogue.

---

### 1. Check catalogue

| ID | Signal | What it compares | Result at audit (2026-10-27) |
|---|---|---|---|
| `models.count` | Prisma model drift | `schema.prisma` model declarations vs “N Prisma Models” in `architecture-overview.md` | FAIL: 22 vs 16 |
| `modules.coverage` | Module map drift | every backend directory with a `.module.ts` vs the overview module table | FAIL: `matches` missing |
| `sources.inventory` | Adapter inventory drift | source configs + Telegram channels vs listed adapter names | FAIL: seven non-existent adapters listed |
| `sources.count` | Endpoint count | configured endpoints vs “15 adapters” | FAIL: 14 endpoints / 12 classes |
| `dedup.fingerprint` | Behaviour drift | “cross-source fingerprint” claim vs `sources.service.ts` queries | FAIL: fingerprint stored, never queried |
| `matching.neutral` | Scoring drift | empty-skill neutral in reference vs engine | FAIL: 0.65 vs 0.4 |
| `matching.eligibility` | Contract drift | hard eligibility fields in engine vs reference | FAIL: `eligible` / `ineligibleReasons` undocumented |
| `matching.inputs` | Input drift | `ProfileInput` fields in engine vs reference | FAIL: `excludeEntryLevel` undocumented |
| `matching.schedule` | Cadence drift | matching interval in overview vs lifecycle task | FAIL: 30m vs 10m |
| `matching.role` | Semantics drift | “exact substring” claim vs token-aware matching | FAIL: stale |
| `traceability.specs` | Test index drift | every `*.spec.ts` vs `traceability.md` | FAIL: four files missing |
| `traceability.total` | Total drift | claimed ~227 vs 252 declarations | FAIL |
| `traceability.counts` | Per-file drift | claimed counts vs declarations | FAIL: 11 rows differ |
| `plan.status` | Status drift | “not yet implemented” vs category collection code | FAIL |
| `deployment.db` | Topology conflict | README PostgreSQL claim vs Docker SQLite URL | WARN |
| `deployment.migrations` | Migration conflict | runbook `migrate deploy` vs entrypoint `db push` | WARN |
| `model.source` | Model maintainability | machine-readable diagram files present | WARN: none |
| `docs.freshness` | Staleness | latest doc commit vs latest code commit | WARN: 2026-08-28 vs 2026-10-22 |
| `routes.count` | Route count | README “20+ routes” vs 19 `page.tsx` files | WARN |

Added during remediation (all PASS as of 2026-10-30):

| ID | Signal | What it compares |
|---|---|---|
| `dedup.sameSource` | Behaviour drift | `persist()` looks up `(sourceId, fingerprint)` before create, as documented |
| `db.migrations` | Migration availability | committed Prisma migrations vs the documented deploy path |
| `deployment.devlauncher` | Launcher drift | `dev.sh` reads the Prisma provider, runs `migrate deploy` (not `migrate dev`), probes real health paths, keeps a boot grace, and kills process trees |
| `traceability.proseCounts` | Prose drift | hand-written “N test declarations” claims in README and the overview vs the counted declarations |
| `facts.current` | Generated-artifact drift | `docs/architecture-facts.json` matches a fresh scan of the source tree |

---

### 2. CI integration

Implemented as Gate 5 of `.github/workflows/ci.yml`, which runs on every PR and push to `main`/`master`:

```yaml
  architecture:
    name: "Gate 5: Architecture Drift"
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Generated facts are current
        run: node scripts/generate-architecture-facts.js --check
      - name: Architecture claims match code
        run: node scripts/check-architecture-health.js --strict
```

Both scripts are dependency-free, so the job installs nothing. Gate 6 (`runtime-verification`) is the
runtime half of the same idea: it provisions a disposable seeded database, builds and boots both apps,
and runs the browser specs — so a claim that only holds against a mocked Prisma cannot pass CI on its
own either. The local equivalent of the two static checks is `npm run arch:verify`; the live equivalent
is `npm run live:verify` (documented smoke test + `nfr:check`).

The rollout order that was recommended at audit time — report-only, then fix the drift, then make the
job required — is complete: steps 1 and 2 are done, `--strict` is in the workflow, and the PR rule is
enforced by the checks themselves rather than a checklist item, because a document that drifts now
fails the build.

---

### 3. Change-triggered review policy

| Change type | Architecture artifact to review | Minimum evidence |
|---|---|---|
| Prisma model added/removed/renamed | `docs/architecture-overview.md` data model | `schema.prisma`, migration, generated ER diagram |
| New backend module or controller | module map | `app.module.ts` and module file |
| Adapter added/removed/renamed | source/adapter inventory | `source-configs.json`, `telegram-channels.config.ts`, parser test |
| Matching weights, eligibility, inputs, result type | `docs/matching-engine-reference.md` | `matching-engine.ts` and `matching-engine.spec.ts` |
| Collection cadence or mode | pipeline section | `lifecycle.tasks.ts`, source config |
| Deployment, database, or backup change | `docs/ops-runbook.md` and README | Docker files, runbook commands, restore drill |
| Test suite change | `docs/traceability.md` | jest output and spec tree |
| Plan status change | the plan file | implementation files and tests |

Use `git diff --name-only` in a pre-push hook or CI to warn when code paths change without a matching doc path.

---

### 4. Artifact metadata convention

Add a small, machine-readable header to each architecture document so future checks can compare an explicit snapshot:

```yaml
---
architecture:
  lastReviewedCommit: f0cf0ca
  lastReviewedAt: 2026-10-27
  evidence:
    prismaModels: 22
    nestModules: 18
    frontendRoutes: 19
    webSources: 11
    telegramChannels: 3
    testSpecFiles: 23
---
```

The script currently reads the code directly, so this header is optional. It becomes useful when the team wants a reviewed snapshot that is allowed to lag transient code changes.

---

### 5. Periodic checks

| Cadence | Check |
|---|---|
| Every PR touching architecture paths | `node scripts/check-architecture-health.js` |
| Nightly | Full backend test suite plus the architecture check; archive the output |
| Weekly | Review `docs.freshness` warning and untriaged “unknown” items in `traceability-index.json` |
| Quarterly | Restore drill for the authoritative database; update `docs/ops-runbook.md` |
| On incident | Add the incident’s architecture-relevant discovery to the report and, if needed, a new check |

---

### 6. Adding a new check

1. Add a small, deterministic check to `scripts/check-architecture-health.js`.
2. Use a stable ID (`area.signal`) and a detail string that tells the reader what to change.
3. Prefer evidence that exists in the repository (code, config, schema, tests) over runtime state.
4. Add the check to the catalogue above.
5. If the check is noisy, make it a warning until the underlying artifact is stable.
6. Do not make a check pass by weakening its evidence; change the documentation or the code instead.

---

## Part 5 — Regeneration summary

**Purpose:** instructions for refreshing the JobHunter architecture artifacts after this audit. Regenerate from evidence, not from the previous prose.

**Evidence precedence:** code, schema, config, and tests > operational intent recorded in the runbook > previous architecture prose.

**Do not** mark an artifact current until the controlling evidence has been inspected again. Use `scripts/check-architecture-health.js` as the minimum gate.

> **Status (2026-10-30):** steps 1–6 of the refresh sequence below are done, and most of them are no
> longer manual. `generate-architecture-facts.js` owns every structural count (models, modules, routes,
> sources, adapters, tests, CI jobs) and writes it into the overview, README, and traceability marker
> blocks; `generate-traceability.js` owns the requirement→test matrix; `check-architecture-health.js`
> owns the behavioural claims. The manual instructions are kept because they are still the fallback when
> a generator has to be extended, and because they record *which* evidence each claim rests on.
> The current refresh is two commands: `npm run arch:verify` then, if anything was stale,
> `npm run facts:generate && npm run traceability:generate`.

---

### 1. Refresh sequence

| Order | Artifact | Work |
|---|---|---|
| 1 | `docs/architecture-overview.md` | Correct counts, adapter inventory, dedup status, cadence, module map, routes, and deployment state. |
| 2 | `docs/matching-engine-reference.md` | Rewrite the eligibility/neutral/input/result/role-semantics sections from `matching-engine.ts`. |
| 3 | `docs/traceability.md` | Regenerate the file index and counts from the current spec tree and CI output. |
| 4 | `docs/ops-runbook.md` | Pick one production topology and split the commands if both are supported. |
| 5 | `docs/plans/category-aware-collection.md` | Change the status and record what shipped. |
| 6 | `README.md` | Align test count, route count, production database, adapter count, and architecture links. |
| 7 | `docs/architecture-health/*` | Re-run the checks and update the report, index, and diff with the new snapshot. |

Do 1–6 in one documentation PR, then update the health artifacts in the same PR or a follow-up. Do not mix the fingerprint implementation decision with a pure documentation PR unless the product owner has already decided.

---

### 2. Per-artifact instructions

#### `docs/architecture-overview.md`

Replace or verify:

- **Model count and data model:** `grep '^model ' backend/prisma/schema.prisma` (22 today). Add the six missing models and rename the `Source` box to `JobSource`. Prefer a generated ER diagram over a hand-drawn box list.
- **Adapter inventory:** generate from `backend/src/modules/sources/source-configs.json` (11 web) plus `telegram-channels.config.ts` (3 channels). State both endpoint count and adapter-class count. Remove the six non-existent adapters.
- **Deduplication:** after the product decision, either document the implemented fingerprint lookup or state that dedup is source-level only. Do not keep the current two-layer claim.
- **Matching cadence:** 10 minutes for the match cycle, 30 minutes for FAST collection, 60 minutes for DEEP collection, 24 hours for digest.
- **Source auto-disable:** replace “3+ failures” with the actual 10-run/zero-success rule, unless the code is changed first.
- **Module map:** add `matches`; note that `health` is a controller-only module and `integration` is a test suite.
- **Frontend routes:** 19 page routes; list feature routes and note the root/error/forbidden pages separately.
- **Infrastructure:** one authoritative production topology. If the Docker path remains SQLite, say so and move PostgreSQL to a clearly labeled alternative.
- **Metadata:** add `lastReviewedCommit`, `lastReviewedAt`, and the evidence counts from `living-architecture-checks.md`.

#### `docs/matching-engine-reference.md`

Rewrite these sections against `backend/src/modules/matching/matching-engine.ts`:

- **Empty skills:** neutral is **0.4** (`matching-engine.ts:323-330`), not 0.65.
- **Eligibility:** add a dedicated section for hard filters (`matching-engine.ts:469-515`):
  - remote-only seeker + explicit `ONSITE` → ineligible;
  - `excludeOnsite` + international on-site → ineligible;
  - `excludeEntryLevel` + `ENTRY`/`INTERN` → ineligible;
  - fewer than two skill signals and role similarity below 0.5 → ineligible;
  - ineligible jobs are returned with `score = 0` and `eligible = false` (`:642-645`).
- **Result shape:** add `eligible` and `ineligibleReasons` (`:399-411`).
- **Profile input:** add `excludeEntryLevel` (`:366-377`).
- **Role similarity:** replace “exact substring” with token-aware phrase matching (`:172-234`); add `accountant` vs `senior accountant` vs `accounting` examples.
- **Seniority penalty:** it fires from the title regex plus `<4 years`; the role-synonym branch in the document does not exist in code (`:416,620-630`).
- **Examples:** recalculate any example scores after the eligibility change. An ineligible job is now 0, not a penalized partial score.

#### `docs/traceability.md`

- Run the backend suite in the supported Node 22 environment.
- Export the jest summary (test count and pass/fail) and archive it with the CI run.
- Replace the file index with every `*.spec.ts` file. The current tree has 23 files; the index omits at least `url-safety.spec.ts`, `jobs.service.spec.ts`, `lifecycle.service.spec.ts`, and `category-mapper.spec.ts`.
- Recompute per-file counts from the run, not from memory.
- Add the HagereJobs parser gap explicitly, or add a fixture test before claiming “each adapter”.
- Do not reuse the 41/53 and 77% figures until the mapping is regenerated. If the requirement inventory is still useful, keep it but label the coverage column as “last verified on <date/commit>”.

#### `docs/ops-runbook.md`

- **Decision required:** which production topology is authoritative?
  - **Single-container SQLite:** `docker-compose.yml` + `docker-entrypoint.sh`, `prisma db push`, SQLite backup of `/app/data/prod.db`.
  - **Managed PostgreSQL:** `schema.postgresql.prisma`, `prisma migrate deploy`, `pg_dump` backup and restore drill.
- Split the runbook into two explicit paths if both are supported.
- Align the backup script with the chosen database. `lifecycle.service.ts` invokes `scripts/backup.sh`; verify that script matches the production path.
- Add a smoke test that checks `/api/health`, the frontend, and one authenticated API call.
- Record the actual host/process manager (Docker, PM2, systemd, Vercel/Railway split) rather than describing a manual `node dist/main.js` path as current.

#### `docs/plans/category-aware-collection.md`

- Change `Status: plan (not yet implemented)` to `implemented` or `partially implemented`.
- Record what shipped: `category-mapper.ts`, taxonomy JSON, `SourceRunCategory`, FAST/DEEP modes, `pagesFetched`, `categoriesSearched`, `crossCategoryDuplicates`, `unmappedCategories`.
- List remaining gaps separately (for example, any source without category support, any unmapped taxonomy entries).
- Link the implementation files and tests.

#### `README.md`

- Test count: use the CI-executed count, not “255+” unless that is still true.
- Routes: “19 page routes” or qualify as feature routes.
- Database: match the authoritative production topology.
- Adapter count: state “11 web sources + 3 Telegram channels” or “12 adapter classes”.
- Add a link to `docs/architecture-health/architecture-health-report.md` and the check script.
- Keep the high-level architecture diagram but label it “illustrative; canonical model at <path>” once a machine-readable model exists.

---

### 3. Manual review points

These cannot be resolved by a mechanical refresh:

1. **Fingerprint deduplication:** implement a cross-source lookup or remove the claim. This affects duplicate jobs and notification quality.
2. **Production database:** choose SQLite or PostgreSQL for the supported deployment. The backup/migration path depends on it.
3. **Source inventory:** confirm whether the 11 web sources + 3 Telegram channels are the intended set, and whether any disabled or removed sources should remain documented.
4. **Matching eligibility:** confirm the hard filters are product intent, especially the “fewer than two skill signals” relevance gate. It can suppress useful jobs with sparse skill extraction.
5. **Requirement coverage:** decide whether the 53-requirement inventory is still the planning unit. If not, replace it with a test-to-requirement mapping generated from test names.
6. **Architecture model ownership:** assign an owner for the future `.dsl`/`.dot` source and the CI check.

---

### 4. Verification after regeneration

Run, in order:

```bash
node scripts/check-architecture-health.js
git diff --check
git diff --stat -- docs README.md backend/prisma backend/src frontend/app .github/workflows
```

Then:

- Re-run the backend test suite in the CI toolchain and update the traceability totals.
- Start the stack and verify `/api/health`, `/login`, and one authenticated route.
- If a diagram source is added, render it with the plugin’s DSL/DOT viewer and confirm every confirmed node has a `sourceRef`.
- Update `architecture-health-report.md` with the new verdict and remove findings that are actually fixed. Do not simply delete the report.

A reasonable definition of done for this cleanup:

- `node scripts/check-architecture-health.js` exits 0 in `--strict` mode.
- The architecture overview’s counts match generated values.
- The matching reference’s eligibility and neutral values match the engine.
- The traceability index lists every spec file and uses CI-generated counts.
- The runbook names one authoritative production path and its backup/restore procedure.
- The plan status matches the implementation.

---

## Appendix — Raw check output

```text
Architecture health checks
=========================
[FAIL] models.count — architecture-overview.md says 16 models; schema.prisma defines 22: User, CandidateProfile, CvFile, TelegramLink, Skill, CandidateSkill, TargetRole, LocationPreference, JobSource, SourceRun, SourceRunCategory, Job, JobSkill, JobMatch, Application, ApplicationTransition, Notification, SearchProfile, Digest, MatchCycle, SystemLog, BotState
[FAIL] modules.coverage — modules missing from the overview map: matches
[FAIL] sources.inventory — overview lists adapters that do not exist: Himalayas, WorkingNomads, JobsFitty, LinkedIn, FindWork, WeWorkRemotely, HaHuJobs, RelieWeb. Actual: 11 web sources + 3 Telegram channels = 14 endpoints, 12 adapter classes.
[FAIL] sources.count — overview claims 15 adapters; actual is 11 web sources + 3 Telegram channels (12 adapter classes).
[FAIL] dedup.fingerprint — overview claims cross-source fingerprint deduplication, but sources.service.ts stores the fingerprint without querying it; dedupeWithinRun only groups sourceJobId within one run.
[FAIL] matching.neutral — matching reference says empty skills score 0.65; engine uses 0.4
[FAIL] matching.eligibility — engine has hard eligibility filters (score 0) and returns eligible/ineligibleReasons; the reference does not document them
[FAIL] matching.inputs — ProfileInput.excludeEntryLevel is implemented but missing from the reference
[FAIL] matching.schedule — overview says matching runs every 30m; MATCH_CYCLE_INTERVAL defaults to 10m
[FAIL] matching.role — reference says role matching is exact substring; engine uses token-aware phrase matching
[FAIL] traceability.specs — spec files missing from traceability.md: backend/src/common/utils/url-safety.spec.ts, backend/src/modules/jobs/jobs.service.spec.ts, backend/src/modules/lifecycle/lifecycle.service.spec.ts, backend/src/modules/sources/categories/category-mapper.spec.ts
[FAIL] traceability.total — traceability.md says ~227 tests; 23 spec files contain 252 it/test declarations (parameterized cases expand further, so use CI output for the executed count).
[FAIL] traceability.counts — per-file test counts are stale: auth.service.spec.ts claims 15, has 1; auth.controller.spec.ts claims 8, has 4; applications.service.spec.ts claims 10, has 2; matching-engine.spec.ts claims 22, has 34; sources.service.spec.ts claims 8, has 20; adapters.spec.ts claims 41, has 51; telegram.service.spec.ts claims 10, has 12; notifications.service.spec.ts claims 6, has 7; job-fidelity.spec.ts claims 28, has 31; integration.spec.ts claims 21, has 10; security.spec.ts claims 12, has 3
[FAIL] plan.status — category-aware-collection.md says "not yet implemented", but category-mapper.ts, category-taxonomy.json, SourceRunCategory, FAST/DEEP modes and related tests exist.
[WARN] deployment.db — README says PostgreSQL is the production database, while docker-compose.yml configures a SQLite file. Declare which production topology is authoritative.
[WARN] deployment.migrations — runbook uses prisma migrate deploy, while the Docker entrypoint uses prisma db push --accept-data-loss.
[WARN] model.source — no .dot/.dsl/.mmd/.puml architecture source exists; the diagrams are ASCII inside Markdown and cannot be diffed mechanically.
[WARN] docs.freshness — latest code commit (2026-10-22) is newer than the latest architecture-doc commit (2026-08-28).
[WARN] routes.count — README says 20+ routes; frontend/app contains 19 page.tsx routes

Summary: 0 passed, 14 failed, 5 warnings.
```

The post-remediation output is maintained in
[`check-output-post-remediation.txt`](check-output-post-remediation.txt) and reproduced below; regenerate
it at any time with `node scripts/check-architecture-health.js --strict`.

```text
Architecture health checks — post-remediation
=============================================
Command: node scripts/check-architecture-health.js --strict

[PASS] models.count — 22 Prisma models match the document
[PASS] modules.coverage — 18 NestJS modules are represented in the overview
[PASS] sources.inventory — 11 web sources + 3 Telegram channels
[PASS] dedup.fingerprint — cross-source fingerprint grouping is documented as not implemented
[PASS] dedup.sameSource — ingestion refreshes an existing row when (sourceId, fingerprint) matches
[PASS] matching.neutral — empty-skill neutral value is aligned
[PASS] matching.eligibility — eligibility contract is documented
[PASS] matching.inputs — ProfileInput fields are documented
[PASS] matching.schedule — matching schedule is aligned
[PASS] matching.role — role-matching semantics are aligned
[PASS] traceability.specs — 28 spec files are referenced
[PASS] traceability.total — test declaration count matches (325)
[PASS] traceability.proseCounts — no hand-written declaration counts contradict the specs
[PASS] traceability.counts — per-file test counts are aligned
[PASS] plan.status — plan status is aligned
[PASS] deployment.db — SQLite is the documented and configured production database
[PASS] deployment.migrations — entrypoint, Dockerfile, and runbook use the guarded migration script
[PASS] deployment.devlauncher — dev.sh respects the schema provider, applies committed migrations, and probes real health paths
[PASS] db.migrations — 2 migration(s) available to deploy
[PASS] model.source — no diagram source, but docs/architecture-facts.json provides a generated machine-readable inventory
[PASS] docs.freshness — architecture docs are at least as new as the inspected code
[PASS] routes.count — 19 frontend page routes
[PASS] facts.current — generated facts match the source tree
[PASS] traceability.matrix — requirement→test matrix matches the SRS and the spec tree
[PASS] traceability.proseCoverage — no hand-typed coverage percentages outside the generated blocks

Summary: 25 passed, 0 failed, 0 warnings.

Backend suite: node scripts/run-tests.js --ci
Test Suites: 28 passed, 28 total
Tests:       377 passed, 377 total

Traceability: node scripts/generate-traceability.js --check
Traceability is up to date (76/81 requirements = 94%, 1 partial).

Gate 6 rehearsal (production build + disposable seeded database):
npx playwright test e2e/runtime-verification.spec.ts e2e/onboarding.spec.ts --project=desktop
6 passed (2.0m) — health 200, anonymous 401, sign-in reaches dashboard,
authenticated matches scored with unique jobIds, no duplicate rows rendered,
onboarding wizard completes/persists/resumes/skips.
```

---

*End of consolidated report.*
