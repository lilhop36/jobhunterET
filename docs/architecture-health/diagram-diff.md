# Diagram / Model Diff — Documented View vs Evidence

**Audit date:** 2026-10-27  
**Compared artifacts:** ASCII diagrams and tables in `docs/architecture-overview.md`, `README.md`, and `docs/ops-runbook.md`.  
**Controlling evidence:** `backend/prisma/schema.prisma`, `backend/src/app.module.ts`, backend module source, `frontend/app/**/page.tsx`, Docker files, and CI.  
**Limitation:** there is no prior machine-readable model (`.dsl`, `.dot`, `.mmd`, `.puml`) to patch. This is a **claim-level semantic diff**, not a source diff. The proposed corrections below are inputs for a future canonical model.

---

## 1. Node diff

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

## 2. Edge diff

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

## 3. Semantic diff summary

- **Confirmed:** high-level topology, port mapping, Prisma usage, source collection, matching trigger, Telegram/web-inbox delivery, SSE, lifecycle crons, CI gates.
- **Stale:** Prisma model count, adapter/source inventory, matching cadence, source auto-disable rule, role matching and seniority semantics, traceability counts.
- **Missing:** `matches` module, cross-source fingerprint dedup, inbound Telegram polling edge, CV storage edge, machine-readable model.
- **Conflicting:** PostgreSQL production vs SQLite Docker path; `prisma migrate deploy` vs `prisma db push`.
- **Unknown:** actual runtime topology and health; executed test count; requirement coverage; fingerprint dedup intent; HagereJobs parser coverage.

The main correction is not cosmetic: the documented architecture currently claims a deduplication layer and a matching behaviour that the code does not implement. A regenerated model should mark those as **unknown** or **not implemented**, not as confirmed paths.

---

## 4. Proposed model patch order

1. Add stable IDs and `sourceRefs` for the confirmed nodes and edges above.
2. Replace counts and adapter lists with generated values from schema/config.
3. Split `current` (SQLite) from `target` (PostgreSQL) database nodes.
4. Add `matches`, `health`, and CV storage nodes.
5. Add the inbound Telegram polling edge.
6. Mark fingerprint dedup as `not implemented` until a product decision and test exist.
7. Regenerate the matching section from `matching-engine.ts`, not from the previous prose.
