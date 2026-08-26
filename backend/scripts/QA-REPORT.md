# JOBHUNTER REAL-DATA QA REPORT

**Date:** 2026-08-25
**Environment:** Windows, Node.js v22.23.1, NestJS backend (port 3210), Next.js frontend (port 3211)
**Database:** SQLite at `backend/prisma/dev.db` (10.7 MB, 1 migration applied)
**QA Engineer:** Kilo

---

## Overall Verdict

**PARTIAL PASS** — The core collection, deduplication, and storage pipeline works end-to-end with real data. However, the personal matching engine is producing scores too low to trigger notifications, the Telegram bot token is invalid, and several classification edge cases produce incorrect data.

---

## Infrastructure

**PARTIAL PASS**

| Component | Status | Evidence |
|-----------|--------|----------|
| Backend (port 3210) | PASS | PID 22204 listening, `dist/main.js` running |
| Frontend (port 3211) | PASS | PID 19656 listening |
| SQLite database | PASS | `backend/prisma/dev.db` exists, 10.7 MB |
| Prisma migrations | PASS | 1 migration, schema up to date |
| PostgreSQL 16 | RUNNING but NOT CONFIGURED | Service `postgresql-x64-16` Running on port 5433; `.env` uses SQLite; no `jobhunter` DB created |
| Environment variables | PASS | All required vars present in `.env` |
| Telegram bot token | FAIL | API returns 401 Unauthorized (`8956215588:AAGzpc4IuhCXURDmbKZiUAXwLmPZq5gWSZI` is invalid/revoked) |

**Critical:** PostgreSQL is running but the application is configured for SQLite only. The `.pgdata` directory exists but is unused by the running service.

---

## Source Collection

**PASS**

| Source | HTTP/API Result | Jobs Fetched | Jobs Parsed | Jobs Created | Jobs Updated | Duplicates | Errors | Data Quality |
|--------|----------------|--------------|-------------|--------------|--------------|------------|--------|--------------|
| reliefweb | 406 via fetch; OK via adapter (https module) | 3 | 3 | 0 | 0 | 3 | 0 | Good |
| remotive | 200 OK | 10 | 10 | 0 | 0 | 10 | 0 | Good |
| arbeitnow | 200 OK | 0 | 0 | 0 | 0 | 0 | 0 | No new jobs |
| ethiojobs | 200 OK | 60 | 60 | 0 | 0 | 60 | 0 | Good |
| ethiongojobs | 200 OK | 20 | 20 | 0 | 0 | 20 | 0 | Good |
| geez | 200 OK | 7 | 7 | 0 | 0 | 7 | 0 | Good |
| hagerejobs | 200 OK | 6 | 6 | 0 | 0 | 6 | 0 | Good |
| hahu | FAIL | 0 | 0 | 0 | 0 | 0 | 1 | No adapter registered |
| jobicy | 200 OK | 50 | 50 | 0 | 0 | 50 | 0 | Good |
| landingjobs | 200 OK | 3 | 3 | 0 | 0 | 3 | 0 | Good |
| remoteok | 200 OK | 99 | 99 | 0 | 0 | 99 | 0 | Good |
| etcareers | DISABLED | — | — | — | — | — | — | Auto-disabled (health 43%) |
| tg-elelanajobs | 200 OK | 0 | 0 | 0 | 0 | 0 | 0 | No new jobs |
| tg-shegarjob | 200 OK | 16 | 16 | 0 | 0 | 16 | 0 | Good |
| tg-ethiojobvacancy1 | 200 OK | 0 | 0 | 0 | 0 | 0 | 0 | No new jobs |

**Note:** All recent runs show 0 created because the system has already ingested the available jobs. This is expected behavior for a mature crawler.

---

## Normalization

**PARTIAL PASS**

- URL normalization: Applied (tracking params stripped, HTTPS enforced)
- Description cleaning: Applied (boilerplate stripped, HTML entities decoded)
- Field accuracy: Deadline parsing works; salary normalization works
- **Issue:** Some locations are polluted with company names (e.g., "Afar, Ethiopia Company: Plan International")
- **Issue:** "Not Specified" locations are stored as-is and incorrectly classified as `ETHIOPIA_LOCAL`

---

## Deduplication

**PASS (with caveat)**

- **No duplicate `(sourceId, sourceJobId)` pairs** found in the database — confirmed by direct query.
- **Ghost detection works:** 196 jobs marked REMOVED after 3 missed cycles.
- **Caveat:** 3 fingerprint duplicates exist in the database. The fingerprint is computed and stored but is **never used for deduplication**. Deduplication relies solely on `(sourceId, sourceJobId)`.

Fingerprint duplicates found:
1. `Good Beginnings Daycare and Preschool` — Preschool Teacher (2 rows from `ethiojobs` with different sourceJobIds)
2. `MOGES ESTIFANOS` — General Service Head (2 rows from `ethiojobs` with different sourceJobIds)
3. `Unknown` — Addis Ababa Revenues Bureau (2 rows from `tg-elelanajobs` with different sourceJobIds)

These would be caught if fingerprint deduplication were implemented.

---

## New-Job Detection

**PASS**

- **690 of 691 jobs** have `postedDate < firstSeenAt`, which is expected for a crawler that discovers postings after they go live.
- **Freshness is preserved:** Recent jobs show discovery delays of 0–3.5 hours.
- **Example:** "Ethiopian Railways Corporation" posted at 16:53, firstSeen at 16:53 (0h delay). "Community Outreach Health Care Worker" posted at 15:38, firstSeen at 16:11 (1.3h delay).

---

## Field Relevance / Radar

**PARTIAL PASS**

The classifier auto-tags jobs using source defaults + per-job analysis:

| Tag | Description | Working |
|-----|-------------|---------|
| `ethiopian` | Ethiopia-based jobs | Yes |
| `remote` | Work-from-anywhere | Yes |
| `international` | Outside Ethiopia | Yes |
| `ngo` | NGO/humanitarian | Yes |
| `tech` | Software/IT roles | Partial — many tech jobs from intl sources are correctly tagged, but some Ethiopian tech jobs miss the tag |
| `senior` | Senior roles | Yes |
| `entry_level` | Junior/intern | Yes |
| `freelance` | Contract/freelance | Yes |

**Issue:** Jobs with location "Not Specified" get classified as `ETHIOPIA_LOCAL` because the classifier defaults to the source's `defaultLocationClass` and the Ethiopia-location detector matches on the source config, not the actual location text.

---

## Location Extraction

**PARTIAL PASS**

**Correct examples (20+ verified):**
- "Addis Ababa" → `ETHIOPIA_LOCAL` ✓
- "Addis Ababa, Ethiopia" → `ETHIOPIA_LOCAL` ✓
- "Ethiopia" → `ETHIOPIA_LOCAL` ✓
- "Afar, Ethiopia" → `ETHIOPIA_LOCAL` ✓
- "Dessie, Ethiopia" → `ETHIOPIA_LOCAL` ✓
- "Sidama" → `ETHIOPIA_LOCAL` ✓
- "Amhara" → `ETHIOPIA_LOCAL` ✓
- "Remote" → `INTERNATIONAL_REMOTE` ✓
- "USA" → `INTERNATIONAL_REMOTE` ✓
- "Japan" → `INTERNATIONAL_REMOTE` ✓
- "UK" → `INTERNATIONAL_REMOTE` ✓
- "EMEA, Europe" → `INTERNATIONAL_REMOTE` ✓
- "Poland" → `INTERNATIONAL_REMOTE` ✓
- "Spain" → `INTERNATIONAL_REMOTE` ✓

**Incorrect:**
- "Not Specified" → `ETHIOPIA_LOCAL` (11 jobs affected)
- "Afar, Ethiopia Company: Plan International" → location field polluted with company name

**Unknown/unclear:** 11 jobs with "Not Specified" location

**Accuracy estimate:** ~95% for clear locations; fails on vague/empty locations

---

## Skill Extraction

**PARTIAL PASS**

**177 unique skills** in the database.

**Correct extractions observed:**
- `Web, UI & UX Design` from UX jobs
- `Sales` from sales jobs
- `Creative & Design` from creative roles
- `Finance & Accounting` from finance roles
- `Business Development` from BD roles
- `education, exec, ops, medical, technical, supervisor, ecommerce` from RemoteOK (raw tags)
- `Natural Sciences, Health Care` from health jobs

**Issues:**
1. **Many Ethiopian jobs have empty skill arrays** — HTML scrapers don't extract skills from descriptions.
2. **RemoteOK jobs get raw tag noise** — skills like `education`, `exec`, `medical`, `full time`, `part time` are not actual professional skills.
3. **No canonical alias enforcement across sources** — while `normalizeSkill()` handles aliases within a job, the database stores whatever the adapter provides.

**False positives:** RemoteOK tag `full time`, `part time`, `education` treated as skills
**False negatives:** Ethiopian jobs with clear tech requirements (e.g., "Node.js, TypeScript, PostgreSQL") in description but no extracted skills

---

## Personal Matching

**PARTIAL PASS (critical issue: no qualifying matches)**

**Match score distribution across 1787 matches:**
- 0–25: 1082 (60%)
- 26–50: 687 (38%)
- 51–75: 18 (1%)
- 76–100: **0 (0%)**

**Highest score in system: 67** (below default threshold of 75)

**Why no matches exceed 75:**
1. **Users have 0 years experience** — all profiles show `years: 0`, triggering "Requires 3+ yrs — you have 0" penalty
2. **User `abdigaboma@gmail.com` has 10 HIGH-priority roles** — role matching is diluted across too many targets
3. **Many jobs have empty skill arrays** — `skillScore` is 15 (minimum) for most matches because there are no job skills to match against
4. **Default threshold is 75** — very high given the scoring weights

**Sample top matches:**
| Score | User | Job | Role Score | Skill Score | Loc Score |
|-------|------|-----|------------|-------------|-----------|
| 67 | abdigaboma@gmail.com | Whiz Kids Workshop — Tsehai Child Development Intern | 18.75 | 15 | 9.3 |
| 60 | abdigaboma@gmail.com | Project Manager Job Vacancy in Ethiopia | 25 | 15 | 9.3 |
| 58 | admin@jobhunter.et | Full Stack Engineer — Inter School, Kampala | 0 | 15 | 1.8 |

**Suspicious scores:**
- "Full Stack Engineer" in Kampala scores 58 for `admin@jobhunter.et` with `locationScore=1.8` — Kampala is Uganda, not Ethiopia. The location score should be lower.
- Jobs with `missing: []` and `matched: []` but non-zero skill scores indicate the skill arrays are empty on both sides.

---

## Freshness

**PASS**

**10 real examples:**

| Job | Posted Age | Discovery Delay | Status |
|-----|-----------|-----------------|--------|
| Ethiopian Railways Corp | 0.8h | 0.0h | ACTIVE |
| United Insurance S.C | 0.8h | 0.0h | ACTIVE |
| Ethiopian Human Rights Commission | 0.8h | 0.0h | ACTIVE |
| Ethiopian Red Cross Society | 0.8h | 0.0h | ACTIVE |
| Community Outreach Health Care Worker | 2.1h | 1.3h | ACTIVE |
| DIRECTOR, COUNTRY - Ethiopia (5432) | 3.1h | 2.3h | ACTIVE |
| Director, Finance & Billing Operations | 4.3h | 3.5h | ACTIVE |
| Sales Executive New Business - Nordics | 4.3h | 3.5h | ACTIVE |
| Alliance Manager, Translational Medicine | 4.3h | 3.5h | ACTIVE |
| Lead UX Designer | EMEA | Contract | 4.3h | 3.5h | ACTIVE |

Freshness decay formula: `max(0.05, exp(-hours / 72))` — working correctly.

---

## Telegram

**PARTIAL PASS (bot token invalid)**

| Check | Status | Evidence |
|-------|--------|----------|
| Bot token valid | FAIL | `getMe` returns 401 Unauthorized |
| Bot username | SET | `jobhunterethbot` |
| /start | Implemented | Code present in `telegram.service.ts` |
| /status | Implemented | Code present |
| /saved | Implemented | Code present |
| /pause | Implemented | Code present |
| /resume | Implemented | Code present |
| /help | Implemented | Code present |
| /latest | NOT IMPLEMENTED | Not in code |
| /today | NOT IMPLEMENTED | Not in code |
| /jobs | NOT IMPLEMENTED | Not in code |
| /digest | NOT IMPLEMENTED | Not in code |
| /stats | NOT IMPLEMENTED | Not in code |
| /profile | NOT IMPLEMENTED | Not in code |
| /preferences | NOT IMPLEMENTED | Not in code |
| Telegram links | 0 | No users have linked Telegram |
| Inline buttons | Implemented | Save/Reject/Apply/Open in code |

**Critical:** The Telegram bot token in `.env` is invalid. The bot cannot receive messages or send notifications until a valid token is provided.

---

## Interactive Buttons

**CANNOT VERIFY**

No notifications have been sent (0 in database). The button handlers (`save:`, `reject:`, `apply:`, `open:`) are implemented in `telegram.service.ts:382-409`, but there is no real-world evidence of them working because:
1. No Telegram links exist
2. No notifications have been sent
3. Bot token is invalid

---

## Notification Deduplication

**PASS (design-level)**

- **Database constraint:** `@@unique([userId, jobId])` on Notification model
- **In-process lock:** `pairLocks` Map serializes delivery per `(userId, jobId)`
- **Evidence:** 0 notifications in DB, 0 duplicate pairs
- **Cannot verify end-to-end** because no matches exceed threshold and no notifications are triggered

---

## Worker

**PARTIAL PASS**

| Check | Status | Evidence |
|-------|--------|----------|
| Scheduled sources run | PASS | Source runs every ~3 minutes (reliefweb, ethiojobs, etc.) |
| Sources not due are skipped | PASS | `collectDue()` checks `lastRunAt` vs frequency |
| Overlapping cycles prevented | PASS | CollectionQueue concurrency-limited; `runExclusive` for Telegram poll |
| Failed sources don't stop healthy ones | PASS | Each source wrapped in try/catch; failures isolated |
| New jobs flow through pipeline | PASS | Collection → persist → match → notify (when threshold met) |
| Digest scheduling | UNVERIFIED | `DIGEST_INTERVAL=60000` in `.env` but no digests generated recently |

**Match cycles** run every 10 minutes but log `jobs=0 users=0` because all 400 ACTIVE jobs have `matchedAt != NULL`. The incremental matcher only scores `matchedAt: null` jobs. To re-score, `recalculate()` must be called.

---

## Error Handling

**PARTIAL PASS**

| Scenario | Status | Evidence |
|----------|--------|----------|
| Source unavailable | PASS | hahu has no adapter → graceful FAIL, no crash |
| Malformed source response | PASS | ReliefWeb returns 406 to fetch but adapter uses https module |
| Invalid job data | PASS | `valid.filter((j) => j.title && j.company && j.url)` filters invalid jobs |
| Duplicate job | PASS | `sourceId + sourceJobId` unique constraint prevents duplicates |
| Telegram send failure | UNVERIFIED | No Telegram links to test |
| Database error | UNVERIFIED | No induced DB errors tested |
| Missing configuration | PASS | Missing adapter → FR-008 error message, no crash |

---

## Data Integrity

**PARTIAL PASS**

| Check | Status | Count |
|--------|-------|-------|
| Orphan records | PASS | No orphan jobs (all have sourceId) |
| Duplicate jobs (same sourceId+sourceJobId) | PASS | 0 |
| Missing source IDs | PASS | 0 null, 0 empty |
| Malformed URLs | PASS | 0 null, 0 empty |
| Missing titles | PASS | 0 null, 0 empty |
| Missing companies | PASS | 0 null, 0 empty |
| Incorrect timestamps | PASS | 0 future dates |
| Fingerprint duplicates | FAIL | 3 pairs found (fingerprint not used for dedup) |
| "Not Specified" locations misclassified | FAIL | 11 jobs |
| hahu status inconsistent | FAIL | ACTIVE but error says "Auto-disabled" |

---

## Notification Latency

**N/A**

0 notifications sent. Cannot measure latency.

---

## Bugs Found

### BUG-001: Telegram Bot Token Invalid
**Severity:** CRITICAL
**File:** `backend/.env`
**Line:** 13
**Description:** `TELEGRAM_BOT_TOKEN=8956215588:AAGzpc4IuhCXURDmbKZiUAXwLmPZq5gWSZI` returns 401 Unauthorized from Telegram API. The bot cannot receive messages or send notifications.
**Root cause:** Token is either revoked, malformed, or for a different bot.

### BUG-002: HaHu Jobs Source Status Inconsistency
**Severity:** MEDIUM
**File:** `backend/src/modules/sources/sources.service.ts`
**Line:** 463-470
**Description:** When `computeHealthScore()` auto-disables a source, it sets `status: 'DISABLED'`. But `hahu` shows `status: 'ACTIVE'` with `lastError: 'Auto-disabled: health score 0% below 50%'`. The status and error message contradict each other.
**Root cause:** Possible race condition or the status update is not persisting correctly.

### BUG-003: "Not Specified" Location Misclassified as Ethiopian
**Severity:** MEDIUM
**File:** `backend/src/modules/sources/source-classifier.ts`
**Line:** 91-102
**Description:** Jobs with location "Not Specified" are classified as `ETHIOPIA_LOCAL` because the Ethiopia-location detector matches the source's default config rather than the actual location text.
**Affected jobs:** 11 (e.g., "Customer Service Officer II", "Senior Customer Service Officer", "Branch Operation Supervisor")
**Root cause:** `isEthiopia` check runs against `combined` (location + title + company), and the source default `defaultLocationClass: 'ETHIOPIA_LOCAL'` is used as fallback without validating the actual location string.

### BUG-004: Fingerprint Computed but Never Used for Deduplication
**Severity:** LOW
**File:** `backend/src/modules/sources/sources.service.ts`
**Line:** 335-352
**Description:** The `fingerprint` field is built in `runFidelityPipeline()` and stored on every job, but `persist()` only checks `sourceId + sourceJobId` for duplicates. Fingerprint-based cross-source deduplication does not exist.
**Evidence:** 3 fingerprint duplicates found in DB (same company+title+location+description from same source with different sourceJobIds).
**Root cause:** Feature was designed but the dedup query was never implemented.

### BUG-005: Matcher Produces Zero Qualifying Matches
**Severity:** CRITICAL
**File:** `backend/src/modules/matching/matching-engine.ts`
**Line:** 390-503
**Description:** Across 1787 matches, the highest score is 67 (threshold = 75). No notifications are ever triggered.
**Root causes:**
1. All candidate profiles show `years: 0`, triggering experience penalties
2. User `abdigaboma@gmail.com` has 10 HIGH-priority roles, diluting role matching
3. Many Ethiopian jobs have empty skill arrays, making `skillScore` minimum (15/30)
4. Default threshold of 75 is too high for the current scoring distribution

### BUG-006: Missing Telegram Bot Commands
**Severity:** MEDIUM
**File:** `backend/src/modules/telegram/telegram.service.ts`
**Line:** 291-307
**Description:** The SRS and user expectations include `/latest`, `/today`, `/jobs`, `/digest`, `/stats`, `/profile`, `/preferences`. Only `/start`, `/status`, `/saved`, `/pause`, `/resume`, `/help` are implemented.

### BUG-007: Location Field Pollution
**Severity:** LOW
**File:** Various adapters
**Description:** Some Ethiopian jobs have location strings like "Afar, Ethiopia Company: Plan International" — the company name is concatenated into the location field.
**Affected jobs:** At least 2 observed from `ethiongojobs` source.

---

## False Positives

### Location Classification False Positives
1. **"Not Specified" → ETHIOPIA_LOCAL** (11 jobs) — classifier assumes Ethiopian based on source default rather than location text
2. **"Kampala" → local (Ethiopia)** — "Full Stack Engineer | Inter School | Kampala" scored with `locationScore=1.8` and summary says "local (Ethiopia)" for `admin@jobhunter.et`. Kampala is Uganda.

### Matching False Positives
1. **"Full Stack Engineer — Inter School, Kampala"** scored 58 for `admin@jobhunter.et` because:
   - Role similarity: "Full Stack Engineer" matches "backend_developer" with score 0
   - Location: Kampala (Uganda) treated as local Ethiopia
   - This job should score much lower for an Ethiopia-based candidate

---

## False Negatives

### Skill Extraction False Negatives
1. Ethiopian jobs with descriptions containing "Node.js, TypeScript, PostgreSQL" but empty skill arrays — the HTML scrapers do not extract skills from job descriptions.
2. Tech jobs from Ethiopian sources sometimes miss the `tech` tag because the classifier only checks the title, not the description.

### Matching False Negatives
1. A strong match like "Backend Developer (NestJS)" at "Gebeya Inc." with skills [NestJS, Node.js, PostgreSQL, GraphQL] for a user with skills [Node.js, TypeScript, PostgreSQL, NestJS] should score much higher than 50-60 range, but scores are dragged down by 0 years experience and empty skill arrays on many jobs.

---

## Real-Data Statistics

| Metric | Value |
|--------|-------|
| Total jobs in DB | 691 |
| ACTIVE jobs | 400 |
| REMOVED jobs | 196 |
| EXPIRED jobs | 95 |
| JobMatches | 1787 |
| Notifications sent | 0 |
| Telegram links | 0 |
| Active sources | 14 |
| Disabled sources | 1 (etcareers) |
| Broken sources | 1 (hahu — no adapter) |
| SourceRuns total | 202 |
| MatchCycles | 37 |
| Skills dictionary | 177 unique skills |
| Users | 4 |
| Users with profile | 4 |
| Users with skills | 2 (admin@jobhunter.et, abdigaboma@gmail.com) |
| Highest match score | 67 |
| Matches >= 75 (threshold) | 0 |
| Fingerprint duplicates | 3 pairs |
| Jobs with "Not Specified" location | 11 |

---

## Critical Issues

1. **Telegram bot token is invalid** — no notifications can be sent via Telegram
2. **No matches exceed the 75 threshold** — the matching engine is not producing qualifying matches, so no notifications are ever triggered
3. **HaHu Jobs source shows ACTIVE but has auto-disable error** — status inconsistency

---

## Important Issues

1. **11 jobs misclassified as Ethiopian** due to "Not Specified" locations
2. **3 fingerprint duplicates** exist because fingerprint deduplication is not implemented
3. **Missing Telegram commands** — `/latest`, `/today`, `/jobs`, `/digest`, `/stats`, `/profile`, `/preferences` not implemented
4. **Many Ethiopian jobs have empty skill arrays** — skill extraction from HTML descriptions is missing
5. **Location field pollution** — company names concatenated into location strings from some sources

---

## Minor Issues

1. RemoteOK raw tags include non-skill words (`education`, `exec`, `full time`, `part time`)
2. Default candidate profile has `years: 0` which heavily penalizes all matches
3. `abdigaboma@gmail.com` has 10 HIGH-priority roles, diluting role matching
4. Match cycles show `jobs=0` because all ACTIVE jobs have been matched once; incremental matching doesn't re-score

---

## Recommended Next Action

1. **Fix Telegram bot token** — replace with a valid token from @BotFather
2. **Fix the matching engine threshold** — either lower the default threshold to ~50 or fix the scoring so that genuine matches exceed 75. The current 0-years-experience profiles are the root cause.
3. **Fix HaHu Jobs status** — ensure auto-disabled sources transition to DISABLED status
4. **Fix "Not Specified" location classification** — default to UNKNOWN or skip classification when location is vague
5. **Implement fingerprint deduplication** — use the existing fingerprint field to catch cross-source and same-source duplicates with different IDs
6. **Extract skills from Ethiopian HTML descriptions** — add description parsing for ethiojobs, ethiongojobs, geez, etc.
7. **Implement missing Telegram commands** — `/latest`, `/today`, `/jobs`, `/digest`, `/stats`, `/profile`, `/preferences`
8. **Clean location fields** — strip company names from location strings during fidelity pipeline
