# Category-Aware Collection + Deeper Pagination + Category→Tag Mapping

Status: plan (not yet implemented)
Scope: backend collection engineering only. **No category browsing frontend.**

---

## 1. Goal

Turn the JobHunter collector from a *fixed-window fetcher* into a **coverage-aware collector** that:

- knows which categories each source actually supports (verified, never invented),
- paginates until it reaches a freshness boundary instead of a hardcoded page count,
- sweeps deeper/historical pages on a separate slower cadence,
- maps source-specific categories/tags onto one canonical JobHunter taxonomy,
- reports exactly how much was searched and how much coverage was gained.

Explicitly **not** in scope: `/jobs/software`-style browsing pages, changes to the matching
algorithm, changes to Telegram delivery behaviour.

---

## 2. Why this is needed (measured, not assumed)

Live probes against the real sources plus the current dev DB:

| Fact | Evidence |
| --- | --- |
| EthioJobs has **947 live jobs across 79 pages** (~31 days of history) | `__NEXT_DATA__` → `pageProps.jobs.meta = {itemsPerPage:12, lastPage:79, total:947}` |
| JobHunter holds only **60 ACTIVE EthioJobs jobs** (~6% of the board) | `SELECT sourceId,status,COUNT(*) FROM Job` |
| EthioJobs collection is spinning: **20 runs, 1200 fetched, 160 created, 1040 duplicates** | `SourceRun` aggregate |
| EthioJobs also has **102 REMOVED vs 60 ACTIVE** — live jobs wrongly ghosted | `Job` aggregate |
| Jobicy: **50 ACTIVE vs 130 REMOVED** (same fixed-window ghosting) | `Job` aggregate |
| Arbeitnow: **19 runs, 0 jobs fetched, every time** | `SourceRun` aggregate |
| ETCareers is **DISABLED** (health 43%) although its feed returns **434 live jobs right now** | `JobSource` row + live fetch |
| EthioNGOJobs sees only 20 posts/run although **140 posts were published in the last 7 days** | `X-WP-Total: 140` for `?after=<7d>` |

Page-depth calibration for EthioJobs (today = 2026‑08‑25), used to size the windows below:

| Page | Oldest posting on page | Age |
| --- | --- | --- |
| 1 | 2026-08-24T20:00Z | ~4 h |
| 5 | 2026-08-24T10:58Z | ~1 d |
| 10 | 2026-08-22T07:17Z | ~3 d |
| 20 | 2026-08-20T09:06Z | ~5 d |
| 30 | 2026-08-19T07:16Z | ~6 d |
| 50 | 2026-08-14T05:08Z | ~11 d |
| 79 | 2026-07-25T06:49Z | ~31 d |

→ 48 h boundary ≈ **8 pages**; 14 d ≈ **55 pages**; whole board ≈ **79 pages**.
→ A sweep of the 3–4 *relevant* categories covers all relevant tech jobs in ~25 requests.

---

## 3. Verified source capabilities (the contract with reality)

Every entry below was probed live. Nothing here is inferred, and no category slug/ID is invented.
Sources not listed keep their current single-fetch behaviour and get **mapping only**.

| Source | Deep pagination | Category collection | Verified handles | Politeness constraint |
| --- | --- | --- | --- | --- |
| **ethiojobs** | `GET /jobs?page=N`, `meta.lastPage=79`, pages past `lastPage` return `data: []` | `GET /jobs/category/{slug}[?page=N]` — **42 real slugs** from `sitemap-categories.xml` | job `slug` (stable across latest feed *and* category pages → natural cross-category dedupe); `catalogs[].name` / `catalog_names` = source categories | `robots.txt` allows `/jobs*`, disallows `/api/*`. 800 ms pacing |
| **ethiongojobs** | WP REST: `per_page=100`, `page=N`, `X-WP-Total` / `X-WP-TotalPages` | `?categories=<id>` — **real IDs**: `146` ngo-jobs-in-ethiopia (1113), `133` remote-jobs (265), `7` un-jobs-in-ethiopia (18), `3` all-ngo-job-vacancies (9122) | server-side `?after=<ISO>` freshness filter (removes client-side waste) | 500 ms pacing, `_fields` to trim payloads |
| **jobicy** | n/a (`count` max 100) | `?industry=<slug>` — **real slugs** from `?get=industries` (`engineering`, `admin`, `data-science`, `cybersecurity`, `qa-testing`, `web-app-design`, `technical-support`, `management`, `project-management`, …) | `jobIndustry[]` = source categories | Documented fair use: **no more than once per hour** → DEEP sweeps only |
| **arbeitnow** | `?page=N`, `links.next`, 175 jobs/page, ordered by `created_at` | none offered | `tags[]`, `job_types[]` as source categories | 500 ms pacing; "free public API, please do not abuse" |
| **geez** | `/jobs-in-ethiopia` listing exposes **49** job links vs **7** on the homepage; `?page=` is *not* supported (returns page 1) | `/industry/{slug}`, `/study/{slug}`, `/experience-category/{slug}` hubs exist (slugs to be read from the live nav at implementation time — none hardcoded blind) | detail page per job → must skip already-known slugs | `robots.txt` allows `/`, disallows `/search-jobs?`. 700 ms pacing, hard request cap |
| **etcareers** | **not needed** — `/jobs.rss` already returns **434 items** spanning ~3 months in one request | mapping only: RSS `<category>` gives ~40 labels (`IT & Software Development Jobs in Ethiopia`, `NGO Jobs…`, `Engineering Jobs…`) | `<guid>` | `robots.txt` disallows `?page=`, `?q=`, `?sort=` → **no query sweeps**, single feed fetch |
| **reliefweb** | RSS only | mapping only from `<category>` | — | keeps Node `https` workaround (undici is 406'd) |
| **remotive** | n/a | mapping only from the `category` field already in the payload. `?category=` filtering was probed and behaved inconsistently, and their terms advise **≤ 4 requests/day** → **no sweeps** | — | single call, unchanged |
| **remoteok / landingjobs / hagerejobs / tg-\*** | unchanged | mapping only from existing `tags` / listing labels | — | unchanged |

---

## 4. Architecture

```text
                         SOURCE
                            │
              ┌─────────────┴─────────────┐
        Latest / new jobs           Category sweep
     (FAST, every `frequency`)   (DEEP, every 12 h)
              │                           │
              └─────────────┬─────────────┘
                            ↓
            INCREMENTAL PAGINATION  ── stop at freshness boundary
                            ↓            / last page / request budget
                 WITHIN-RUN DEDUPE  ── same job seen via N categories
                            ↓            counted once, categories merged
                       NORMALIZE    ── runFidelityPipeline (unchanged)
                            ↓
                    CATEGORY MAP    ── source category → canonical taxonomy
                            ↓
                     DB DEDUPE      ── (sourceId, sourceJobId) (unchanged)
                            ↓
                    CLASSIFY/TAGS   ── source-classifier (unchanged)
                            ↓
              COVERAGE-AWARE GHOSTS ── only reconcile what the run covered
                            ↓
                      MATCHING      ── unchanged
                            ↓
                     TELEGRAM       ── unchanged
```

### 4.1 Adapter contract — additive, no adapter is forced to change

`backend/src/modules/sources/adapters/job-source.adapter.ts`

```ts
export type CollectionMode = 'FAST' | 'DEEP';

export interface CollectionRequest {
  mode: CollectionMode;
  /** Freshness boundary — pagination stops once postings are older than this. */
  since: Date;
  /** Source category ids/slugs to sweep (already validated against the source). */
  categories?: string[];
  /** Hard ceilings so a source can never be hammered. */
  maxPages?: number;
  maxRequests?: number;
  requestDelayMs?: number;
  /** Lets an adapter skip detail-page fetches for jobs already stored. */
  knownSourceJobIds?: ReadonlySet<string>;
}

export type StopReason =
  | 'FRESHNESS_BOUNDARY' | 'LAST_PAGE' | 'EMPTY_PAGE'
  | 'MAX_PAGES' | 'REQUEST_BUDGET' | 'ERROR';

export interface CategoryCollectionStat {
  /** 'latest' for the main feed, otherwise the source's own category id/slug. */
  category: string;
  categoryLabel?: string;
  pagesFetched: number;
  jobsFetched: number;
  errors: number;
  stoppedReason: StopReason;
}

export interface CollectionResult {
  jobs: RawJob[];
  pagesFetched: number;
  requestsMade: number;
  categories: CategoryCollectionStat[];
  errors: string[];
}

export interface JobSourceAdapter {
  readonly sourceId: string;
  readonly selectorVersion?: string;
  fetchJobs(options?: { since?: Date }): Promise<RawJob[]>;
  /** Optional capability. When present, SourcesService prefers it. */
  collect?(request: CollectionRequest): Promise<CollectionResult>;
}
```

`RawJob` gains two optional fields (both additive):

```ts
  /** Raw category labels/ids as the source expressed them. */
  sourceCategories?: string[];
  /** Which sweep surfaced this job: 'latest' or a source category id. */
  discoveredVia?: string;
```

New shared helper `adapters/collection-budget.ts`: a small `RequestBudget` class
(`canSpend()`, `spend()`, `wait()`) that enforces `maxRequests` + `requestDelayMs`
so pacing logic is written once, not per adapter.

Adapters that implement `collect()` also keep `fetchJobs()` working by delegating to it —
existing tests, `scripts/run-adapters.ts`, and the fallback chain stay valid.

### 4.2 Configuration — source-specific, never assumed

`source-configs.types.ts` / `source-configs.json` gain a per-source `collection` block.
Absence of the block = today's behaviour, so every unlisted source is unaffected.

```json
{
  "id": "ethiojobs",
  "priorityTier": "ETHIOPIA",
  "frequency": 30,
  "collection": {
    "supportsCategories": true,
    "supportsPagination": true,
    "requestDelayMs": 800,
    "fast": { "freshnessHours": 48,  "maxPages": 12, "maxRequests": 14, "categories": [] },
    "deep": {
      "everyMinutes": 720,
      "freshnessDays": 14,
      "maxPages": 55,
      "maxRequests": 60,
      "maxPagesPerCategory": 8,
      "categories": [
        "it-computer-science-and-software-engineering",
        "technology",
        "engineering",
        "telecommunications"
      ]
    }
  }
}
```

Rules baked into the loader:

- `deep.categories` entries are validated at boot against the source's catalogue in
  `source-categories.json`; an unknown id is logged as a **config error** and skipped,
  never silently turned into a URL.
- `fast.maxRequests` / `deep.maxRequests` are hard caps enforced by `RequestBudget`.
- Sources without `collection.supportsCategories` never receive a `categories` list.
- Sources with a documented rate limit (jobicy, remotive) declare `"fast": { "categories": [] }`
  so category work only happens on the DEEP cadence.

### 4.3 Canonical taxonomy + mapping

Three new files under `backend/src/modules/sources/categories/`:

**`category-taxonomy.json`** — the canonical JobHunter tree. Tech is deep (that is the
target field); everything else is broad but present, because Ethiopian boards are
general-purpose and 90% of postings must still land somewhere real.

```text
software-engineering
├── backend            (node, java, python, php, .net, go)
├── frontend           (react, angular, vue, nextjs)
├── mobile             (android, ios, flutter, react-native)
├── qa                 (manual, automation)
├── devops
├── cloud
├── data               (data-engineering, data-analysis, bi)
├── ai-ml
├── cybersecurity
└── it-support         (sysadmin, networking, helpdesk)

engineering            (civil, mechanical, electrical, industrial)
finance-accounting     · banking-insurance      · sales-marketing
business-development   · project-management     · admin-operations
hr                     · legal                  · health-medical
pharmaceutical         · education              · ngo-development
agriculture            · logistics-supply-chain · procurement
customer-service       · media-communications   · hospitality-tourism
security               · construction-architecture
science-research       · other
```

Each node: `{ id, label, parent, aliases[], keywords[] }`.

**`source-categories.json`** — the verified per-source catalogue and its mapping into the
taxonomy. Kept separate from `source-configs.json` because EthioJobs (42) + ETCareers (~40) +
Jobicy (22) + EthioNGOJobs (5) is ~110 entries.

```json
{
  "ethiojobs": {
    "urlTemplate": "https://ethiojobs.net/jobs/category/{id}",
    "categories": [
      { "id": "it-computer-science-and-software-engineering",
        "label": "IT, Computer Science and Software Engineering",
        "canonical": ["software-engineering"] },
      { "id": "technology",  "label": "Technology",  "canonical": ["software-engineering"] },
      { "id": "health-care", "label": "Health Care", "canonical": ["health-medical"] }
    ]
  },
  "ethiongojobs": {
    "categories": [
      { "id": "146", "label": "NGO Jobs in Ethiopia",  "canonical": ["ngo-development"] },
      { "id": "133", "label": "Remote/Home based Jobs", "canonical": [] },
      { "id": "7",   "label": "UN Jobs in Ethiopia",   "canonical": ["ngo-development"] },
      { "id": "3",   "label": "Vacancies",             "canonical": [] }
    ]
  }
}
```

**`category-mapper.ts`** — resolution order (first hit wins, results de-duplicated):

1. exact source-category id/label match in `source-categories.json`,
2. alias match against taxonomy `aliases[]` (handles `React Developer` → `frontend`,
   `Frontend Engineer` → `frontend`, `Web Developer` → `frontend`, `UI Developer` → `frontend`),
3. keyword inference from the source category label,
4. keyword inference from the job title + declared skills,
5. `[]` — deliberately empty rather than a wrong guess. A run-level counter reports how
   many postings ended unmapped so gaps are visible instead of silent.

Exports: `mapSourceCategories(sourceId, labels, job)`, `getTaxonomy()`, `flattenTaxonomy()`,
`validateSourceCategoryIds(sourceId, ids)`.

---

## 5. Pipeline changes in `SourcesService`

`backend/src/modules/sources/sources.service.ts`

### 5.1 Mode-aware fetch

`collect(id)` → `collect(id, { mode = 'FAST' })`.

- `since` is no longer the hardcoded `14 * 86_400_000`; it comes from
  `collection[mode].freshnessHours|freshnessDays`, falling back to today's 14 days when a
  source has no `collection` block.
- If `adapter.collect` exists → call it with the resolved `CollectionRequest`
  (including `knownSourceJobIds` for sources that need per-job detail fetches).
- Otherwise → `adapter.fetchJobs({ since })` and synthesise a single-category result
  (`category: 'latest'`, `pagesFetched: 1`) so metrics are uniform for every source.

### 5.2 Within-run deduplication (requirement 8)

New private `dedupeWithinRun(jobs)` executed **before** any persistence:

- key = `sourceJobId` (EthioJobs proved the slug is identical on the latest feed and on
  category pages, so this is sufficient and cheap),
- first occurrence wins; subsequent occurrences only **merge `sourceCategories` and
  `discoveredVia`**, so a job found via three categories keeps all three labels,
- returns `{ unique, crossCategoryDuplicates }`.

Net effect: a job discovered through N categories is fetched once, normalised once,
persisted once, notified once. The existing DB-level `(sourceId, sourceJobId)` dedupe and
`fingerprint` logic are untouched.

### 5.3 Canonical categories on the job

`persist()` gains, alongside the existing `classifySourceJob()` output:

```ts
categories: this.prisma.json(mapSourceCategories(sourceId, j.sourceCategories ?? [], j)),
```

`tags` is deliberately **left alone** — the curated 8-tag set, `TAG_LABELS`,
`getTagCounts()`, `GET /sources/tags*`, and `jobs?tag=` keep working exactly as today.
Canonical categories live in their own column so they cannot disturb classification,
matching, or notifications.

### 5.4 Coverage-aware ghost reconciliation

Today `reconcileGhosts(sourceId, seenIds)` increments `missedCycles` for **every** ACTIVE
job of the source that was absent from the latest fetch. Because the fetch only ever
covered a fixed window, live jobs outside that window were removed after 3 cycles —
that is the measured 102-REMOVED-vs-60-ACTIVE result on EthioJobs.

New signature:

```ts
private async reconcileGhosts(
  sourceId: string,
  seenIds: Set<string>,
  coverage: { since: Date; complete: boolean },
)
```

- `complete: true` (a DEEP sweep that reached `LAST_PAGE`, or a source whose single fetch
  genuinely returns the whole board, e.g. ETCareers' 434-item feed) → reconcile the whole
  source, exactly as today.
- `complete: false` (FAST run bounded by a freshness boundary) → restrict the candidate set
  with `postedDate >= coverage.since`, i.e. only judge jobs the run could actually have seen.
- The 3-strikes → `REMOVED` rule, the reactivation path, and `statusChangedAt` are unchanged.

### 5.5 Metrics (requirement 9)

Per run, `SourceRun` records `mode`, `pagesFetched`, `categoriesSearched`,
`crossCategoryDuplicates`, `unmappedCategories`, plus the existing counters. Per category,
one `SourceRunCategory` row records `pagesFetched`, `jobsFetched`, `newJobs`, `duplicates`,
`errors`, `stoppedReason`.

New `getCoverageReport()` aggregates: per source × category → runs, pages, fetched, new,
duplicates, errors, last stop reason, and (for sources that expose it) upstream total vs
stored ACTIVE count so the coverage ratio is visible.

### 5.6 Deep scheduling (requirement 5)

- `collectDeepDue()` mirrors `collectDue()` but keys off the last `SourceRun` with
  `mode='DEEP'` and the source's `collection.deep.everyMinutes` (720 = twice a day).
- DEEP jobs are enqueued through the existing `CollectionQueue` at a **lower priority**
  than FAST jobs, so a long sweep never delays fresh-job detection.
- `lifecycle.tasks.ts` gains one `@Interval(deepCollectIntervalMs())` (env
  `DEEP_COLLECTION_INTERVAL`, default 60 min tick) wrapped in the existing
  `runExclusive('collect-deep')` guard, so ticks cannot stack.
- Admin endpoints: `POST /sources/:id/collect-deep`, `POST /sources/collect-deep-all`,
  `GET /sources/coverage`. Same `JwtAuthGuard` + `@Roles('ADMIN')` as the rest of the controller.

Resulting request budget for EthioJobs: FAST ≈ 8 requests every 30 min (was 5),
DEEP ≈ 60 requests twice a day. Roughly 500 requests/day against a board of 947 jobs,
all at ≥ 800 ms spacing.

---

## 6. Data model

Both schema files must be edited (`prisma/schema.prisma` = SQLite/active,
`prisma/schema.postgresql.prisma` = production), then
`npx prisma migrate dev --name category_aware_collection` + `prisma generate`.

```prisma
model SourceRun {
  // … existing fields unchanged …
  mode                    String   @default("FAST")   // FAST | DEEP
  pagesFetched            Int      @default(0)
  categoriesSearched      Int      @default(0)
  crossCategoryDuplicates Int      @default(0)
  unmappedCategories      Int      @default(0)
  categoryStats           SourceRunCategory[]
}

model SourceRunCategory {
  id            String    @id @default(cuid())
  runId         String
  sourceId      String
  category      String                   // 'latest' or the source's own id/slug
  categoryLabel String?
  pagesFetched  Int       @default(0)
  jobsFetched   Int       @default(0)
  newJobs       Int       @default(0)
  duplicates    Int       @default(0)
  errors        Int       @default(0)
  stoppedReason String?
  run           SourceRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@index([sourceId, category])
  @@index([runId])
}

model Job {
  // … existing fields unchanged …
  categories String? @default("[]")   // SQLite: JSON array of canonical ids
}
```

Notes:

- All new `SourceRun` columns are defaulted, so `dashboard.service.ts` and every existing
  `sourceRun.create()`/aggregate keep compiling and behaving identically.
- **Pre-existing drift found:** the PostgreSQL schema has no `tags` column on `Job` at all
  (SQLite-only addition). This plan adds both `tags Json?` and `categories Json?` to the
  PostgreSQL schema to close the gap; reads/writes continue to go through
  `PrismaService.json()` / `jsonArray()`, so no call site changes.
- `scripts/backfill-categories.ts` (modelled on the existing `backfill-tags.ts`) maps
  already-stored jobs into canonical categories using title/skills/`rawData` inference,
  so historical rows are not left blank.

---

## 7. Adjacent coverage fixes (confirmed in-scope)

These are separate from requirements 1–12 but each one is currently costing real jobs.

1. **Arbeitnow returns 0 jobs on every run.** `created_at` is Unix **seconds**
   (`1787680849`), and the adapter does `new Date(1787680849)` → `1970-01-21`, so the
   `since` filter discards all 175 jobs. Fix: detect seconds vs milliseconds
   (`value < 1e12 ? value * 1000 : value`) in `toRaw()` and in the `since` filter, then add
   the `?page=N` incremental pagination the API already supports. Regression test with a
   numeric-seconds fixture.
2. **ETCareers is switched off.** `computeHealthScore()` auto-DISABLED it at 43% after a
   run of transient failures, even though `/jobs.rss` currently serves 434 live jobs with
   ~40 category labels — the richest Ethiopian source available. Fix: set the row back to
   `ACTIVE` (reset `consecutiveFailures`/`lastError`), and make auto-disable require a
   minimum sample (`HEALTH_WINDOW` runs) plus no successful run inside the health window,
   so a source that demonstrably works is never disabled on a partial sample. Exponential
   backoff (SEC-006) remains the mechanism that protects genuinely broken sources.
3. **Orphan `hahu` source.** A `JobSource` row with no registered adapter sits permanently
   at health 0 and pollutes the health summary. Fix: remove the row (no adapter, no config
   entry, no jobs) and log the cleanup; `ensureConfigDrivenSources()` will not recreate it.

---

## 8. Tests (requirement 11)

Framework is already Jest + ts-jest, `testRegex: .*\.spec\.ts$`, run with `npm test`
(from `backend/`). Fixture-mocked HTTP, exactly like the existing `adapters.spec.ts`.

**Blocker first:** `src/modules/sources/sources.service.spec.ts` currently **fails to
compile** — `new SourcesService(...)` passes 13 arguments to a 15-parameter constructor
(`events` and `hagerejobs` are missing). Baseline today: adapters + telegram specs pass
(51 tests), sources.service spec does not run at all. This is fixed in Phase 0 so the new
tests land on a green suite.

`adapters/adapters.spec.ts` — additions:

- EthioJobs: stops at the freshness boundary mid-page (page 3 fixture contains one fresh +
  one stale posting → returns the fresh one and stops with `FRESHNESS_BOUNDARY`).
- EthioJobs: stops at `meta.lastPage` and never requests `lastPage + 1`.
- EthioJobs: a page beyond `lastPage` returning `data: []` yields `EMPTY_PAGE`, not a throw.
- EthioJobs: `maxPages` / `maxRequests` ceilings are honoured (`MAX_PAGES` / `REQUEST_BUDGET`).
- EthioJobs: category-page `pageProps` shape (`initialData[]` + `meta.slugName='category'`,
  10 per page) parses, and `catalog_names` lands in `sourceCategories`.
- EthioJobs: the same `slug` returned by two categories produces **one** `RawJob` with both
  category labels merged.
- EthioJobs: a mid-sweep page failure records the error and continues to the next category
  rather than aborting the whole run.
- EthioNGOJobs: builds `?after=<ISO>&per_page=100`, follows `X-WP-TotalPages`, stops at the
  last page, and sweeps `?categories=146` correctly.
- Arbeitnow: numeric-seconds `created_at` is parsed to the right date (regression), and
  pagination follows `links.next` until the boundary.
- GeezJobs: parses the `/jobs-in-ethiopia` listing, and **skips detail fetches** for slugs
  passed in `knownSourceJobIds` (asserted by fetch-call count).

`categories/category-mapper.spec.ts` — new:

- `React Developer` / `Frontend Engineer` / `Web Developer` / `UI Developer` all map to
  `frontend`; `Senior Node.js Engineer` → `backend`.
- EthioJobs `IT, Computer Science and Software Engineering` → `software-engineering`;
  `Health Care` → `health-medical`.
- ETCareers `IT & Software Development Jobs in Ethiopia` → `software-engineering` (label
  suffix stripping).
- Unknown label → `[]` and counted as unmapped (never a wrong guess).
- Guard test: **every** id in `source-categories.json` resolves to a real taxonomy node,
  and every `deep.categories` entry in `source-configs.json` exists in that source's
  catalogue (this is the test that stops invented slugs from ever shipping).

`sources.service.spec.ts` — additions:

- cross-category duplicates are persisted once and counted in `crossCategoryDuplicates`;
- `SourceRunCategory` rows are written per category with correct page/job/new/dupe counts;
- coverage-aware ghosts: with `complete: false`, a job older than `coverage.since` is
  **not** incremented; with `complete: true`, it is (and still REMOVEs at 3 strikes);
- FAST vs DEEP resolve different `since` windows and different `maxPages` from config;
- `collectDeepDue()` enqueues only sources whose `deep.everyMinutes` has elapsed since
  their last `mode='DEEP'` run;
- adapters without `collect()` still produce a valid single-category metric row.

---

## 9. Real-data verification and final report (requirement 12)

New `backend/scripts/collection-coverage-report.ts`, wired as `npm run collect:report`.

- **Default mode is read-only**: it drives the real adapters directly (no DB writes, no
  matching, no notifications) and prints what each source was searched for. This is what
  produces the coverage numbers.
- `--persist` runs the same sweep through `SourcesService` so `SourceRun` /
  `SourceRunCategory` rows and jobs are actually written.
- `--source=<id>` and `--mode=fast|deep` to scope a run.

Report format:

```text
SOURCE        MODE  CATEGORY                                       PAGES  FETCHED  NEW  DUPES  ERR  STOPPED
ethiojobs     DEEP  latest                                            55      651   —      —    0  FRESHNESS_BOUNDARY
ethiojobs     DEEP  it-computer-science-and-software-engineering        8       77   —      —    0  LAST_PAGE
ethiojobs     DEEP  technology                                         4       34   —      —    0  LAST_PAGE
...
TOTALS        DEEP  4 categories + latest                             71      ...
```

Plus a before/after coverage table taken from the DB:

```text
SOURCE        UPSTREAM_TOTAL  ACTIVE_BEFORE  ACTIVE_AFTER  COVERAGE_BEFORE  COVERAGE_AFTER
ethiojobs                947             60           ...              6.3%            ...%
ethiongojobs        140 (7d)             20           ...             14.3%            ...%
```

and a category-distribution table (canonical category → job count, plus the unmapped count).

**Notification safety for the first persisted deep sweep.** The Telegram bot is live and a
first DEEP EthioJobs sweep can create several hundred jobs in one pass, which the existing
pipeline would immediately match and notify. Because Telegram/matching behaviour must not
change, the mitigation uses the product's own existing feature: set
`User.notificationsPaused = 1` for all users for the duration of the one-off backfill
(`notifyForMatch()` already short-circuits to `SKIPPED` on that flag), run the sweep, then
restore the previous values. Steady-state runs afterwards create only genuinely new jobs
and notify normally. This will be confirmed with you before the persisted sweep is run.

---

## 10. Work plan

**Phase 0 — green baseline + adjacent fixes**
1. Fix the `sources.service.spec.ts` constructor arity so the suite compiles; confirm baseline green.
2. Arbeitnow seconds-vs-milliseconds fix + regression test.
3. ETCareers re-enable + minimum-sample guard on health auto-disable.
4. Remove the orphan `hahu` source row.

**Phase 1 — taxonomy and mapping (no behaviour change)**
5. `categories/category-taxonomy.json`, `categories/source-categories.json` (EthioJobs 42,
   ETCareers ~40, Jobicy 22, EthioNGOJobs 5 — all transcribed from the live probes).
6. `categories/category-mapper.ts` + `category-mapper.spec.ts` including the
   no-invented-slug guard test.
7. `source-configs.types.ts` + `source-configs.json` `collection` blocks; boot-time validation.

**Phase 2 — adapter contract + EthioJobs**
8. Extend `job-source.adapter.ts` (`CollectionRequest`/`CollectionResult`/`RawJob` fields)
   and add `collection-budget.ts`.
9. Rewrite `ethiojobs.adapter.ts`: remove `MAX_PAGES = 5`, add boundary-driven pagination,
   category sweeps, dual page-shape parsing, `sourceCategories`, per-category stats.
   Bump `selectorVersion` to `html:__NEXT_DATA__:v2.0`.
10. EthioJobs adapter tests.

**Phase 3 — service + schema**
11. Prisma changes in both schema files, migration, `prisma generate`.
12. `sources.service.ts`: mode-aware `since`, `collect()` preference, `dedupeWithinRun`,
    canonical categories in `persist()`, coverage-aware `reconcileGhosts`, run + per-category
    metrics, `getCoverageReport()`.
13. `scripts/backfill-categories.ts`.
14. Service tests.

**Phase 4 — remaining adapters**
15. `ethiongojobs` (`after` + `per_page=100` + `page` + `categories`),
    `jobicy` (DEEP-only `industry` sweeps), `arbeitnow` (pagination),
    `geez` (`/jobs-in-ethiopia` + known-id skip + industry hubs).
16. Mapping-only `sourceCategories` for `etcareers`, `reliefweb`, `remotive`, `remoteok`,
    `landingjobs`, `hagerejobs`, telegram adapters — zero extra requests.
17. Adapter tests for each.

**Phase 5 — deep scheduling**
18. `collectDeepDue()`, queue priority, `lifecycle.tasks.ts` interval, controller endpoints,
    `.env.example` documentation for `DEEP_COLLECTION_INTERVAL`.

**Phase 6 — verify and report**
19. `scripts/collection-coverage-report.ts` + `npm run collect:report`.
20. Full `npm test`; read-only real-data run across all configured sources; then (after
    confirming the notification pause) the persisted DEEP sweep.
21. Final report: categories searched, pages fetched, jobs fetched/new/duplicate/error per
    source **and** per category, with before/after coverage ratios.

---

## 11. Risks and guardrails

| Risk | Guardrail |
| --- | --- |
| Turning into a blind crawler | Every category id is validated against a live-probed catalogue; a boot-time check and a unit test both reject unknown ids. `RequestBudget` caps pages and requests per run. |
| Hammering a source | Per-source `requestDelayMs` (500–1000 ms), per-mode `maxRequests`, DEEP on a 12 h cadence, `robots.txt` respected per source (no `?page=` on ETCareers, no `/api/*` on EthioJobs, no `/search-jobs?` on Geez), documented rate limits honoured (Jobicy ≤ 1/h, Remotive single call). |
| Notification burst from the first deep sweep | Existing `notificationsPaused` flag for the one-off backfill window; no change to notification code. |
| Long DEEP run stalling fresh detection | Separate interval + `runExclusive` guard, DEEP enqueued at lower queue priority, `FETCH_TIMEOUT_MS` unchanged. |
| Ghost-detection change removing too much/little | Coverage-aware reconciliation is explicitly tested both ways (`complete: true` and `false`); the 3-strikes rule and reactivation are untouched. |
| Selector drift on EthioJobs category pages | `selectorVersion` bumped; a category page that yields no `initialData` raises a descriptive error naming the file and version to update, matching the existing convention. |
| Schema drift between SQLite and PostgreSQL | Both schema files edited in the same commit; the missing `tags` column on PostgreSQL is closed at the same time. |

---

## 12. Explicitly out of scope

- Category browsing frontend (`/jobs/software`, `/jobs/backend`, …) — not built, not routed.
- Any change to `matching-engine.ts` / `matching.service.ts` scoring or weights.
- Any change to Telegram formatting, delivery, or thresholds.
- Any change to `tags`, `TAG_LABELS`, `getTagCounts()`, or the existing
  `GET /sources/tags*` and `jobs?tag=` contracts.
- New third-party sources.





