# Ethiopia-only scope

Abdi JobPilot ET only recommends vacancies that a candidate resident in Ethiopia
can actually take. The rule lives in one module and is enforced server-side, so
no adapter, cron, manual trigger or frontend filter can bypass it.

## The policy

`backend/src/modules/eligibility/ethiopia-eligibility.ts` — pure, dependency-free,
shared by ingestion, the seed and the backfill script.

| Job location | Decision |
| --- | --- |
| Addis Ababa / any Ethiopian city or region | `ELIGIBLE` |
| Remote, explicitly open to Ethiopian residents | `ELIGIBLE` |
| Remote, restricted to another country | `REJECTED` |
| Located outside Ethiopia | `REJECTED` |
| Location unknown, or remote eligibility unconfirmed | `REVIEW` |

`REVIEW` is deliberately not "probably fine": nothing is recommended on a guess.

Evidence rules:

- Positive Ethiopian evidence comes **only** from `location` and `country`.
  A description that mentions Ethiopia does not make the job Ethiopian (an
  "Ethiopian Airlines Country Manager" role in Nairobi is still foreign).
- `country` accepts `ET`, `ETH` or `Ethiopia`.
- The description is read only for remote eligibility: an explicit grant
  ("open to candidates based in Ethiopia") makes the job eligible, an explicit
  restriction ("must be based in the United States") rejects it.
- Unrecognised text that names no place stays `REVIEW`.

## Where it is enforced

- **Ingestion** — `SourcesService.persist()` is the single funnel for scheduled,
  manual, fallback and Telegram collection. It classifies every raw job and
  stores `eligibility` + `eligibilityReason` on the `Job` row. Existing rows are
  re-classified on refresh.
- **Feed and digest** — `JobsService.list()`, tag counts and the digest query
  filter to `eligibility = 'ELIGIBLE'`.
- **Matching** — both matching passes (`matchUnmatchedJobs`, `recalculate`) only
  score eligible jobs, so a rejected job can never reach a recommendation.
- **Telegram adapter** — reads only an explicitly labelled location field
  (`Location:`, `Duty Station:`, …). An unlabelled post is `Unknown` → `REVIEW`;
  it is no longer assumed to be Addis Ababa.

Rows stored before the policy existed default to `REVIEW`. Classify them once:

```bash
cd backend
npm run eligibility:backfill -- --dry-run   # inspect counts
npm run eligibility:backfill                # apply
```

## Sources

All sources are declared in
`backend/src/modules/sources/source-configs.json`. `enabled: false` keeps the
adapter registered but removes the source from scheduled collection, manual
collection, fallback and `collectAll`.

| Scope | Sources |
| --- | --- |
| Enabled (Ethiopia) | EthioJobs, Ethio NGO Jobs, GeezJobs, ET Careers, Hagere Jobs, ReliefWeb (Ethiopia feed), configured Telegram channels |
| Disabled (`enabled: false`) | Remotive, Arbeitnow, Jobicy, RemoteOK, Landing.jobs |

The international adapters are **disabled, not deleted**, so they can be restored
by flipping the flag. Re-enabling one only widens collection; the eligibility
policy still keeps foreign postings out of the feed.

## Adding another Ethiopian source

1. Add an adapter implementing `JobSourceAdapter` in
   `backend/src/modules/sources/adapters/` (save a real response fixture and a
   spec, following `telegram-channel.spec.ts`).
2. Register it in `sources.module.ts` and in the adapter map in
   `sources.service.ts`.
3. Add a `source-configs.json` entry with the Ethiopian `priorityTier`,
   frequency and default tags. Leave `enabled` unset (defaults to enabled).
4. Run `npm test`. Ingestion tests prove non-Ethiopian rows cannot become
   `ELIGIBLE`; the persisted decision is what protects the feed.

## Running the tests

```bash
cd backend
npm test                                    # full suite, disposable SQLite
node scripts/run-tests.js src/modules/eligibility   # policy only
```

Policy tests: `src/modules/eligibility/ethiopia-eligibility.spec.ts`.
Ingestion tests (manual collection, refresh, disabled sources, scheduling):
`src/modules/sources/sources.service.spec.ts`.
