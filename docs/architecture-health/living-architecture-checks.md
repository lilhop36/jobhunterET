# Living Architecture Checks

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

The current run reports **25 passed, 0 failed, 0 warnings** (2026-10-30). The findings that produced the
FAILs below are preserved in `architecture-health-full-report.md` as the audit record; each check stays
in the catalogue so a future regression fails the same gate that caught it the first time.

---

## 1. Check catalogue

| ID | Signal | What it compares | Result (2026-10-30) |
|---|---|---|---|
| `models.count` | Prisma model drift | `schema.prisma` model declarations vs “N Prisma Models” in `architecture-overview.md` | PASS: 22 models |
| `modules.coverage` | Module map drift | every backend directory with a `.module.ts` vs the overview module table | PASS: 18 modules |
| `sources.inventory` | Adapter inventory drift | source configs + Telegram channels vs listed adapter names | PASS: 11 web + 3 Telegram |
| `dedup.fingerprint` | Behaviour drift | “cross-source fingerprint” claim vs `sources.service.ts` queries | PASS: documented as not implemented |
| `dedup.sameSource` | Behaviour drift | ingestion refreshes an existing row when `(sourceId, fingerprint)` matches | PASS |
| `matching.neutral` | Scoring drift | empty-skill neutral in reference vs engine | PASS: 0.4 both sides |
| `matching.eligibility` | Contract drift | hard eligibility fields in engine vs reference | PASS |
| `matching.inputs` | Input drift | `ProfileInput` fields in engine vs reference | PASS |
| `matching.schedule` | Cadence drift | matching interval in overview vs lifecycle task | PASS: 10m both sides |
| `matching.role` | Semantics drift | “exact substring” claim vs token-aware matching | PASS |
| `traceability.specs` | Test index drift | every `*.spec.ts` vs `traceability.md` | PASS: 28 spec files |
| `traceability.total` | Total drift | claimed declaration count vs the spec tree | PASS: 325 |
| `traceability.proseCounts` | Prose drift | hand-written “N declarations across M spec files” anywhere in the tracked docs | PASS: the generator owns that sentence |
| `traceability.counts` | Per-file drift | claimed counts vs declarations | PASS |
| `traceability.matrix` | Generated matrix drift | re-runs `generate-traceability.js --check` | PASS |
| `traceability.proseCoverage` | Hand-typed coverage | a coverage percentage outside a generated block | PASS |
| `plan.status` | Status drift | “not yet implemented” vs category collection code | PASS |
| `deployment.db` | Topology conflict | README PostgreSQL claim vs Docker SQLite URL | PASS: SQLite authoritative |
| `deployment.migrations` | Migration conflict | entrypoint, Dockerfile, and runbook vs the guarded script | PASS |
| `deployment.devlauncher` | Launcher drift | `dev.sh` provider handling, migrations, and health probes | PASS |
| `db.migrations` | Migration history | migrations available to deploy | PASS: 2 |
| `model.source` | Model maintainability | machine-readable diagram files present | PASS (waived): `docs/architecture-facts.json` is the machine-readable inventory |
| `docs.freshness` | Staleness | latest doc commit vs latest code commit | PASS |
| `routes.count` | Route count | README route count vs `page.tsx` files | PASS: 19 |
| `facts.current` | Generated facts drift | re-runs `generate-architecture-facts.js --check` | PASS |

---

## 2. CI integration

Implemented. Gate 5 of `.github/workflows/ci.yml` runs both generators and the checker on every PR:

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

Gate 6 (`runtime-verification`) is the runtime half of the same idea: it provisions a disposable
database, builds and boots both apps, and runs the browser specs, so a claim that only holds in a
mocked unit test cannot pass CI on its own.

The local equivalent is `npm run arch:verify` (facts + traceability + checker). A PR that changes
schema, modules, routes, adapters, or matching behaviour is expected to update the affected document in
the same change; the checks fail otherwise, so the rollout step "make the job required" is already done.

---

## 3. Change-triggered review policy

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

## 4. Artifact metadata convention

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

## 5. Periodic checks

| Cadence | Check |
|---|---|
| Every PR touching architecture paths | `node scripts/check-architecture-health.js` |
| Nightly | Full backend test suite plus the architecture check; archive the output |
| Weekly | Review `docs.freshness` warning and untriaged “unknown” items in `traceability-index.json` |
| Quarterly | Restore drill for the authoritative database; update `docs/ops-runbook.md` |
| On incident | Add the incident’s architecture-relevant discovery to the report and, if needed, a new check |

---

## 6. Adding a new check

1. Add a small, deterministic check to `scripts/check-architecture-health.js`.
2. Use a stable ID (`area.signal`) and a detail string that tells the reader what to change.
3. Prefer evidence that exists in the repository (code, config, schema, tests) over runtime state.
4. Add the check to the catalogue above.
5. If the check is noisy, make it a warning until the underlying artifact is stable.
6. Do not make a check pass by weakening its evidence; change the documentation or the code instead.
