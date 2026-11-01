# Regeneration Summary

**Purpose:** instructions for refreshing the JobHunter architecture artifacts after this audit. Regenerate from evidence, not from the previous prose.

**Evidence precedence:** code, schema, config, and tests > operational intent recorded in the runbook > previous architecture prose.

**Do not** mark an artifact current until the controlling evidence has been inspected again. Use `scripts/check-architecture-health.js` as the minimum gate.

> **Status (2026-10-30):** steps 1–6 of the refresh sequence below are done, and most of them are no
> longer manual — `generate-architecture-facts.js` owns the structural counts and writes them into the
> overview, README, and traceability marker blocks, while `generate-traceability.js` owns the
> requirement→test matrix. Every item in the definition of done at the end of this file is met: the
> checker exits 0 in `--strict` mode (25 passed, 0 failed), the counts are generated, the runbook names
> SQLite as authoritative with a guarded migration and verified-backup path, and the stack was started
> and verified in a real browser — which is now CI Gate 6. The manual instructions stay because they
> record which evidence each claim rests on, and remain the fallback when a generator needs extending.

---

## 1. Refresh sequence

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

## 2. Per-artifact instructions

### `docs/architecture-overview.md`

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

### `docs/matching-engine-reference.md`

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

### `docs/traceability.md`

- Run the backend suite in the supported Node 22 environment.
- Export the jest summary (test count and pass/fail) and archive it with the CI run.
- Replace the file index with every `*.spec.ts` file. The current tree has 23 files; the index omits at least `url-safety.spec.ts`, `jobs.service.spec.ts`, `lifecycle.service.spec.ts`, and `category-mapper.spec.ts`.
- Recompute per-file counts from the run, not from memory.
- Add the HagereJobs parser gap explicitly, or add a fixture test before claiming “each adapter”.
- Do not reuse the 41/53 and 77% figures until the mapping is regenerated. If the requirement inventory is still useful, keep it but label the coverage column as “last verified on <date/commit>”.

### `docs/ops-runbook.md`

- **Decision required:** which production topology is authoritative?
  - **Single-container SQLite:** `docker-compose.yml` + `docker-entrypoint.sh`, `prisma db push`, SQLite backup of `/app/data/prod.db`.
  - **Managed PostgreSQL:** `schema.postgresql.prisma`, `prisma migrate deploy`, `pg_dump` backup and restore drill.
- Split the runbook into two explicit paths if both are supported.
- Align the backup script with the chosen database. `lifecycle.service.ts` invokes `scripts/backup.sh`; verify that script matches the production path.
- Add a smoke test that checks `/api/health`, the frontend, and one authenticated API call.
- Record the actual host/process manager (Docker, PM2, systemd, Vercel/Railway split) rather than describing a manual `node dist/main.js` path as current.

### `docs/plans/category-aware-collection.md`

- Change `Status: plan (not yet implemented)` to `implemented` or `partially implemented`.
- Record what shipped: `category-mapper.ts`, taxonomy JSON, `SourceRunCategory`, FAST/DEEP modes, `pagesFetched`, `categoriesSearched`, `crossCategoryDuplicates`, `unmappedCategories`.
- List remaining gaps separately (for example, any source without category support, any unmapped taxonomy entries).
- Link the implementation files and tests.

### `README.md`

- Test count: use the CI-executed count, not “255+” unless that is still true.
- Routes: “19 page routes” or qualify as feature routes.
- Database: match the authoritative production topology.
- Adapter count: state “11 web sources + 3 Telegram channels” or “12 adapter classes”.
- Add a link to `docs/architecture-health/architecture-health-report.md` and the check script.
- Keep the high-level architecture diagram but label it “illustrative; canonical model at <path>” once a machine-readable model exists.

---

## 3. Manual review points

These cannot be resolved by a mechanical refresh:

1. **Fingerprint deduplication:** implement a cross-source lookup or remove the claim. This affects duplicate jobs and notification quality.
2. **Production database:** choose SQLite or PostgreSQL for the supported deployment. The backup/migration path depends on it.
3. **Source inventory:** confirm whether the 11 web sources + 3 Telegram channels are the intended set, and whether any disabled or removed sources should remain documented.
4. **Matching eligibility:** confirm the hard filters are product intent, especially the “fewer than two skill signals” relevance gate. It can suppress useful jobs with sparse skill extraction.
5. **Requirement coverage:** decide whether the 53-requirement inventory is still the planning unit. If not, replace it with a test-to-requirement mapping generated from test names.
6. **Architecture model ownership:** assign an owner for the future `.dsl`/`.dot` source and the CI check.

---

## 4. Verification after regeneration

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
