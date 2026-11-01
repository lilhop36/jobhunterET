# Architecture Health Report — JobHunter

**Audit date:** 2026-10-27  
**Skill:** `architecture-visualization:architecture-health` (audit only; no diagram-format foundation was used because no machine-readable model exists).  
**Audience:** maintainers, operators, and reviewers who use these documents as an architecture source of truth.  
**Scope:** `docs/architecture-overview.md`, `docs/matching-engine-reference.md`, `docs/traceability.md`, `docs/ops-runbook.md`, `docs/plans/category-aware-collection.md`, `README.md`, CI, Prisma schema, backend modules, frontend routes.  
**Method:** static evidence inspection, git history, test inventory, and the deterministic checks in `scripts/check-architecture-health.js`.  
**Runtime note:** the backend (`:3210`) and frontend (`:3211`) were not running during this audit, so no runtime trace or smoke evidence was collected.

---

## 1. Verdict

**Overall trust: medium for the high-level topology; low for the structural counts, matching behaviour, traceability, and deployment story.**

The architecture artifacts describe the right system shape — a Next.js frontend, a NestJS API, Prisma over SQLite/PostgreSQL, background collection/matching crons, Telegram plus a web inbox, and SSE delivery. That shape is supported by code and configuration.

The artifacts are **not safe as a current source of truth** for model counts, adapter inventory, deduplication behaviour, matching eligibility, test coverage, or production deployment. They were last touched on **2026-08-28**; the latest inspected code commit is **2026-10-22** (`f0cf0ca`).

There is also **no machine-readable architecture model**. All diagrams are ASCII blocks inside Markdown, with no stable node/edge IDs and no `sourceRefs`, so diagram-to-code traceability cannot be automated today.

---

## 2. Evidence snapshot

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

## 3. Artifact trust levels

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

## 4. Findings

### High severity

#### AH-01 — No machine-readable architecture model or diagram source

- **Classification:** missing
- **Evidence:** no `.dot`, `.dsl`, `.mmd`, or `.puml` files exist; diagrams are ASCII blocks in `docs/architecture-overview.md:13-51`, `README.md:51-84`, and `docs/ops-runbook.md:12-25`.
- **Impact:** diagrams cannot be diffed, validated, regenerated, or traced to code with stable IDs.
- **Action:** create a canonical Structurizr DSL (C4 context/container) or Graphviz DOT model with stable IDs and `sourceRefs`, then link it from the overview. Keep the ASCII blocks as illustrations only.

#### AH-02 — Prisma model count and data model are stale

- **Classification:** stale
- **Claim:** “16 Prisma Models” and the entity diagram in `docs/architecture-overview.md:46,134-150`.
- **Observed:** **22** models in `backend/prisma/schema.prisma:18-391`. The document omits `CvFile`, `ApplicationTransition`, `SourceRunCategory`, `Digest`, `MatchCycle`, and `BotState`, and refers to a `Source` model that is actually `JobSource`.
- **Impact:** anyone using the overview for schema work or data-lineage analysis will miss six models and misname the source entity.
- **Action:** replace the count and diagram with a generated model list, or point to a generated ER diagram.

#### AH-03 — Cross-source fingerprint deduplication is claimed but not implemented

- **Classification:** stale / aspirational
- **Claim:** “Cross-source: Fingerprint-based (URL + title hash) — prevents duplicate jobs from different sources” in `docs/architecture-overview.md:88-90`.
- **Observed:** `sources.service.ts` computes and stores `fingerprint` (`sources.service.ts:477-478`), but persistence is keyed by the Prisma unique constraint `(sourceId, sourceJobId)` (`schema.prisma:240`). `dedupeWithinRun()` groups only by `sourceJobId` inside one run (`sources.service.ts:530-544`). No query filters on `fingerprint`. `backend/scripts/QA-REPORT.md` (2026-08-25) already recorded fingerprint duplicates and noted the fingerprint was never used for deduplication.
- **Impact:** the architecture claims a duplicate-prevention layer that does not exist; cross-source duplicates remain possible.
- **Action:** either implement fingerprint lookup before `job.create`, or relabel the fingerprint as stored metadata only. Add a test proving the chosen behaviour.

#### AH-04 — Matching reference no longer describes the scoring contract

- **Classification:** stale and conflicting
- **Claims and observed code:**
  - Empty job skills: document says neutral **0.65** (`matching-engine-reference.md:78`; also `architecture-overview.md:181`); code uses **0.4** (`matching-engine.ts:323-330`).
  - Hard eligibility: document describes only penalties; code returns `score = 0` and `eligible = false` for remote-only/on-site conflicts, excluded entry-level roles, and jobs with fewer than two skill signals and role similarity below 0.5 (`matching-engine.ts:469-515,642-645`).
  - Result shape: document’s `MatchResult` lacks `eligible` and `ineligibleReasons` (`matching-engine-reference.md:230-244`; code `matching-engine.ts:399-411`).
  - Profile input: document’s `ProfileInput` lacks `excludeEntryLevel` (`matching-engine-reference.md:199-210`; code `matching-engine.ts:366-377`).
- **Impact:** downstream consumers, tests, and product decisions can assume a job with weak alignment still receives a partial score; in reality it is hard-filtered to zero.
- **Action:** update the reference with the eligibility gate, the 0.4 neutral, the result fields, and the new profile field. Add a dedicated section explaining which conditions are constraints vs preferences.

#### AH-05 — Traceability matrix is not reliable

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

#### AH-06 — Source and adapter inventory is stale

- **Classification:** stale and conflicting
- **Claim:** “15 source adapters” and the adapter list in `docs/architecture-overview.md:7,29,69-73,117`; README says “11+ source adapters” (`README.md:34`) and “11 adapters” (`README.md:72`); traceability says 11 adapters (`traceability.md:47`).
- **Observed:** **11** configured web sources + **3** Telegram channels = **14** collection endpoints; **12** adapter classes (11 web + 1 parameterized Telegram adapter). The overview lists seven adapters that do not exist (`HaHuJobs`, `Himalayas`, `WorkingNomads`, `JobsFitty`, `LinkedIn`, `FindWork`, `WeWorkRemotely`), misspells `ReliefWeb`, and omits `Arbeitnow`, `ETCareers`, `Landing.jobs`, and the Telegram channels.
- **Impact:** source coverage, health monitoring, and failure analysis start from an incorrect inventory.
- **Action:** make `source-configs.json` + `telegram-channels.config.ts` the single source of truth, and generate the adapter table from them.

### Medium severity

#### AH-07 — Source auto-disable rule is wrong

- **Classification:** stale, with a possible code inconsistency
- **Claim:** “Sources that fail 3+ consecutive cycles are auto-disabled” (`architecture-overview.md:73`).
- **Observed:** `HEALTH_WINDOW = 10`; auto-disable occurs only after a full 10-run window with **zero** successful runs (`sources.service.ts:33,580-589`). `HEALTH_AUTO_DISABLE_THRESHOLD = 50` is declared but not used in that condition.
- **Impact:** operators expect a faster circuit breaker than the code provides; the unused threshold constant makes the intended policy ambiguous.
- **Action:** document the actual 10-run/zero-success rule, or implement the intended threshold policy and add a test.

#### AH-08 — Matching cadence is wrong in the overview

- **Classification:** stale
- **Claim:** incremental matching runs “cron, every 30m” (`architecture-overview.md:96`).
- **Observed:** `MATCH_CYCLE_INTERVAL` defaults to **10 minutes** (`lifecycle.tasks.ts:28-30,117`). Collection remains 30 minutes; deep collection is 60 minutes.
- **Action:** update the pipeline description and distinguish collection cadence from matching cadence.

#### AH-09 — Role matching and seniority semantics are stale

- **Classification:** stale
- **Claims:**
  - “Exact substring match” for role similarity (`matching-engine-reference.md:57`).
  - Seniority penalty applies when the title contains senior keywords **or** the title matches a role synonym that includes “senior” (`matching-engine-reference.md:156-161`).
- **Observed:** role similarity uses token-aware phrase matching (`containsPhrase()`), so `"accountant"` matches `"senior accountant"` but not `"accounting"` (`matching-engine.ts:172-234`). The seniority penalty uses only the title regex `SENIORITY_RE` and a `<4 years` check; there is no synonym branch (`matching-engine.ts:416,620-630`).
- **Impact:** matching explanations and expected scores can diverge from the documented model for multi-word roles and senior synonyms.
- **Action:** update the role-similarity and penalty sections; add examples for token matching and for a synonym-only senior title.

#### AH-10 — Production deployment topology is conflicting

- **Classification:** conflicting / ambiguous
- **Evidence:**
  - README: “PostgreSQL (production) / SQLite (development)” (`README.md:94`).
  - Overview: current SQLite, production target PostgreSQL (`architecture-overview.md:191-199`).
  - Runbook: PostgreSQL on 5432, `prisma migrate deploy`, `pg_dump` backups (`ops-runbook.md:8-34,50-86`).
  - Docker path: `DATABASE_URL=file:/app/data/prod.db` (`docker-compose.yml:9`), entrypoint runs `prisma db push --skip-generate --accept-data-loss` (`docker-entrypoint.sh:10-11`).
- **Impact:** there are two incompatible production stories. A new operator cannot tell which database, migration method, or backup procedure is authoritative.
- **Action:** declare one supported production topology. If both are supported, split the runbook into “single-container SQLite” and “managed PostgreSQL” paths with separate commands and backup procedures.

#### AH-11 — Category-aware collection plan status is stale

- **Classification:** stale
- **Claim:** `docs/plans/category-aware-collection.md:4` says “Status: plan (not yet implemented)”.
- **Observed:** `category-mapper.ts`, `category-taxonomy.json`, `source-categories.json`, `SourceRunCategory`, FAST/DEEP modes, `pagesFetched`, `categoriesSearched`, and `category-mapper.spec.ts` exist. The file’s last commit is `b6071ff` (“all 255 tests passing — category-aware collection…”).
- **Impact:** readers may treat implemented behaviour as future work and miss the new collection modes.
- **Action:** mark it implemented (or partially implemented), record the actual behaviour and any remaining gaps, and link the tests.

#### AH-12 — Module map omits current modules

- **Classification:** missing
- **Observed:** 18 modules with `.module.ts`; the overview lists 17 and omits `matches` (`architecture-overview.md:112-130`). `health` is a controller registered in `app.module.ts:18,47`, and `integration` is a test-only directory, so neither belongs in the feature-module table, but both deserve a one-line note if the table claims completeness.
- **Action:** add `matches`; state that `health` is a controller-only module and `integration` is a test suite.

### Low severity

#### AH-13 — Route count claims are approximate

- **Classification:** incomplete
- **Observed:** 19 `page.tsx` routes. The overview’s “17+” table lists 16 feature routes and omits `/`, `/error`, `/forbidden` (`architecture-overview.md:155-173`). README says “20+ routes” (`README.md:200`).
- **Action:** either say “19 page routes” or qualify the count as feature routes only.

#### AH-14 — `JWT_SECRET` is documented as required but the service boots without it

- **Classification:** ambiguous
- **Evidence:** the env table marks `JWT_SECRET` required (`architecture-overview.md:208`); `main.ts:20-22` and `auth.module.ts:15-34` auto-generate a random secret when it is missing or too short, warning that sessions will not survive restarts.
- **Impact:** “required” is correct for stable production sessions, but not for process startup.
- **Action:** describe it as “required for persistent sessions; auto-generated with a warning if absent.”

#### AH-15 — No version/commit metadata or ADRs

- **Classification:** maintainability gap
- **Observed:** artifacts say “Updated August 2026” but do not identify the commit or evidence snapshot. “Key Design Decisions” is prose, not ADRs (`architecture-overview.md:177-188`).
- **Action:** add `lastReviewedCommit` and `evidenceRefs` metadata to each artifact; move the five key decisions into short ADRs with code links.

---

## 5. What is safe to trust now

- The L1/L2 shape: browser → Next.js frontend → NestJS API → Prisma → SQLite/PostgreSQL.
- Ports 3211/3210, JWT/RBAC, SSE events, Telegram + web inbox, cron-based collection/matching, transition-graph 409 handling, and pseudonymization on account deletion.
- The scoring weights (25/30/15/15/5/5/5), the 153-skill knowledge base, and the factor formulas described in the reference, except for the stale items above.
- 22 Prisma models, 18 NestJS feature modules, 19 frontend page routes, 11 web sources + 3 Telegram channels, and 12 adapter classes.
- The CI gates themselves: lint/typecheck, backend tests, frontend build, dependency audit.

## 6. What must be updated before this is an architecture source of truth

1. Replace the ASCII model with a machine-readable source and stable IDs (AH-01).
2. Correct the Prisma model count/data model (AH-02).
3. Decide and document fingerprint deduplication (AH-03).
4. Rewrite the matching eligibility/neutral/input/result sections (AH-04, AH-08, AH-09).
5. Regenerate traceability from the test tree and CI (AH-05).
6. Generate the adapter/source inventory from config (AH-06).
7. Resolve the production deployment topology and migration/backup path (AH-10).
8. Mark the category-aware plan implemented (AH-11).
9. Add `matches` (and a note on `health`/`integration`) to the module map (AH-12).

## 7. What still needs evidence

- **Runtime topology:** no services were running; ports, health endpoint, SSE, and cron execution were not observed.
- **Actual production database:** SQLite vs PostgreSQL is unresolved.
- **Executed test count and pass/fail:** the static declaration count is 252; the full suite was not completed during this audit.
- **Requirement coverage:** the 41/53 and 77% figures in the traceability matrix cannot be reproduced from the current files.
- **Fingerprint deduplication intent:** product decision needed — implement it or remove the claim.
- **HagereJobs parser:** no fixture-level parser test was found.

## 8. Follow-up checks

Run the deterministic check script:

```bash
node scripts/check-architecture-health.js
node scripts/check-architecture-health.js --strict   # CI mode
```

The current run reports **14 failed checks and 5 warnings**, matching the findings above. After the documentation patches, the same script should be used as a CI gate so this drift does not recur.
