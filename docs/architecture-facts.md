# Architecture Facts (generated)

> Generated from source by `scripts/generate-architecture-facts.js`. Do not edit by hand.
> Regenerate with `npm run facts:generate`; verify with `npm run facts:check`.

## Stack
| Component | Version |
|---|---|
| Next.js | 15.5 |
| React | 19.2 |
| NestJS | 10.4 |
| Prisma | 5.20 |
| TypeScript | 5.5 |

## Database

- Authoritative production database: **sqlite**.
- Prisma provider in `schema.prisma`: `sqlite`.
- Docker `DATABASE_URL`: `file:/app/data/prod.db`.
- PostgreSQL: optional / not the current production target.

## Inventory
| Fact | Value |
|---|---|
| Prisma models | 22 |
| NestJS feature modules | 18 |
| Frontend page routes | 19 |
| Web job sources | 11 |
| Telegram channels | 3 |
| Collection endpoints | 14 |
| Adapter classes | 12 |
| Test spec files | 32 |
| Test declarations | 369 |
| CI jobs | 6 |

## Prisma models

- `User`
- `CandidateProfile`
- `CvFile`
- `TelegramLink`
- `Skill`
- `CandidateSkill`
- `TargetRole`
- `LocationPreference`
- `JobSource`
- `SourceRun`
- `SourceRunCategory`
- `Job`
- `JobSkill`
- `JobMatch`
- `Application`
- `ApplicationTransition`
- `Notification`
- `SearchProfile`
- `Digest`
- `MatchCycle`
- `SystemLog`
- `BotState`

## Sources and adapters

| Source | Adapter | Frequency (min) |
|---|---|---:|
| ReliefWeb (Ethiopia) (`reliefweb`) | `reliefweb` | 30 |
| Remotive (`remotive`) | `remotive` | 60 |
| Arbeitnow (`arbeitnow`) | `arbeitnow` | 60 |
| EthioJobs (`ethiojobs`) | `ethiojobs` | 30 |
| Ethio NGO Jobs (`ethiongojobs`) | `ethiongojobs` | 30 |
| GeezJobs (`geez`) | `geezjobs` | 60 |
| ET Careers (`etcareers`) | `etcareers` | 30 |
| Jobicy (`jobicy`) | `jobicy` | 120 |
| RemoteOK (`remoteok`) | `remoteok` | 120 |
| Landing.jobs (`landingjobs`) | `landingjobs` | 120 |
| Hagere Jobs (`hagerejobs`) | `hagerejobs` | 60 |

Telegram channels: `tg-elelanajobs` (ElelanaJobs (Telegram)), `tg-shegarjob` (ShegerJobs (Telegram)), `tg-ethiojobvacancy1` (EthioJobVacancy (Telegram)).

Adapter classes (12): `arbeitnow.adapter.ts`, `etcareers.adapter.ts`, `ethiojobs.adapter.ts`, `ethiongojobs.adapter.ts`, `geezjobs.adapter.ts`, `hagerejobs.adapter.ts`, `jobicy.adapter.ts`, `landingjobs.adapter.ts`, `reliefweb.adapter.ts`, `remoteok.adapter.ts`, `remotive.adapter.ts`, `telegram-channel.adapter.ts`.

## Backend feature modules

- `account`
- `admin`
- `applications`
- `auth`
- `dashboard`
- `digest`
- `events`
- `jobs`
- `lifecycle`
- `matches`
- `matching`
- `notifications`
- `profile`
- `salary`
- `saved-jobs`
- `searches`
- `sources`
- `telegram`

## Frontend routes

- `/`
- `/admin/dashboard`
- `/admin/users`
- `/applications`
- `/dashboard`
- `/error`
- `/forbidden`
- `/inbox`
- `/jobs`
- `/jobs/[id]`
- `/login`
- `/matches`
- `/onboarding`
- `/profile`
- `/register`
- `/saved`
- `/searches`
- `/settings`
- `/sources`

## Matching weights

| Factor | Weight |
|---|---:|
| Role | 25 |
| Skills | 30 |
| Experience | 15 |
| Location | 15 |
| Employment | 5 |
| Freshness | 5 |
| Salary | 5 |

Match cycle default: `10m` (override with `MATCH_CYCLE_INTERVAL`).

## Test inventory

| File | Declarations |
|---|---:|
| `account.service.spec.ts` | 7 |
| `adapters.spec.ts` | 55 |
| `admin.service.spec.ts` | 8 |
| `applications.service.spec.ts` | 6 |
| `auth.controller.spec.ts` | 4 |
| `auth.service.spec.ts` | 9 |
| `backup.service.spec.ts` | 5 |
| `category-mapper.spec.ts` | 9 |
| `digest.service.spec.ts` | 8 |
| `ethiopia-eligibility.spec.ts` | 13 |
| `events.controller.spec.ts` | 6 |
| `exclusive.spec.ts` | 4 |
| `fetch-timeout.spec.ts` | 3 |
| `integration.spec.ts` | 10 |
| `job-fidelity.spec.ts` | 31 |
| `jobs.service.spec.ts` | 4 |
| `keyset.spec.ts` | 10 |
| `lifecycle.service.spec.ts` | 13 |
| `lifecycle.tasks.spec.ts` | 9 |
| `matching-engine.spec.ts` | 34 |
| `matching.service.spec.ts` | 4 |
| `notifications.service.spec.ts` | 7 |
| `parse-port.spec.ts` | 3 |
| `prisma.service.spec.ts` | 6 |
| `profile.service.spec.ts` | 4 |
| `rate-limiter.spec.ts` | 5 |
| `security.spec.ts` | 14 |
| `sources.controller.spec.ts` | 4 |
| `sources.service.spec.ts` | 36 |
| `telegram-channel.spec.ts` | 11 |
| `telegram.service.spec.ts` | 16 |
| `url-safety.spec.ts` | 11 |
| **Total** | **369** |
