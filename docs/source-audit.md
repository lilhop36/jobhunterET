# Ethiopian source audit (Phase 3)

Audited 2026-11-01 against the live sites. A source only gets an adapter when it
exposes a public, permitted feed or server-rendered listing — no logins, no
CAPTCHA bypass, no undocumented private APIs.

## Implemented

| Source | Access | Adapter | Notes |
| --- | --- | --- | --- |
| EthioJobs | HTML listing | `ethiojobs.adapter.ts` | existing |
| Ethio NGO Jobs | HTML listing | `ethiongojobs.adapter.ts` | existing |
| GeezJobs | HTML listing | `geezjobs.adapter.ts` | existing |
| ET Careers | HTML listing | `etcareers.adapter.ts` | existing |
| Hagere Jobs | HTML listing | `hagerejobs.adapter.ts` | existing |
| ReliefWeb (Ethiopia) | Public RSS, `C87` filter | `reliefweb.adapter.ts` | existing |
| **ElelanaJobs** | **Public WordPress RSS** | `elelanajobs.adapter.ts` | **added**: one job per advertised position; location and deadline read from labelled fields |
| Telegram channels | Public channel pages | `telegram-channel.adapter.ts` | existing, now policy-safe |

ElelanaJobs details: feed `https://elelanajobs.com/feed/`, 60-minute cadence,
21-day freshness window, `sourceJobId = <postId>-p<n>`. A post advertising three
positions yields three jobs that share the post URL. Live run on 2026-11-01:
18 jobs, all `ELIGIBLE`.

## Audited, not implemented (with the reason)

| Source | Finding | What would unlock it |
| --- | --- | --- |
| HaHuJobs | Nuxt SPA; the HTML shell carries no postings | Browser rendering (Playwright) or a published API; both unverified and out of scope for a $0 local-first build |
| Ethiopian Reporter Jobs | WordPress, but job posts are not exposed as a post type in `/wp-json/wp/v2/types`; `/jobs/feed/` is empty. The public `/feed/` carries career articles only | A job-specific feed or a documented REST route; re-check before building an HTML scraper |
| HarmeeJobs | RSS exists but returns zero items (site effectively inactive at audit time) | Re-check the feed; adapter would be identical to ElelanaJobs |
| KebenaJobs | Connection refused / no response from the AU and local network | Re-check later |
| Afriwork | `/feed/` redirects to a lander page; no public listing endpoint | Account-gated platform; manual applications only |
| PalmJobs | DNS does not resolve | Dead |
| Employer career pages (banks, telecom, universities) | Each is bespoke; several render through JavaScript | One adapter per employer, built only when that employer's page is stable and server-rendered |

Adding a source: see [ethiopia-only-policy.md](ethiopia-only-policy.md#adding-another-ethiopian-source).

## Monitoring

Every configured source gets a `JobSource` row at boot (`ensureConfigDrivenSources`),
health scoring over its last runs, automatic backoff after failures, and a
`SourceRun` record per collection with jobs fetched/created/duplicates/errors.
The Source Health page reads those. A new adapter needs no extra monitoring code —
registering it in `sources.service.ts` is enough.
