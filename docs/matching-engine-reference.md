# Matching Engine — Technical Reference

> Current implementation | Updated November 2026

## Overview

The matching engine scores every active job against each user's profile on a **0–100 scale**. Jobs scoring at or above the user's `matchThreshold` (default **65**) can trigger a notification via Telegram or the Web Inbox fallback.

The engine lives in `backend/src/modules/matching/matching-engine.ts` and uses a **v2 knowledge base** (`knowledge-base.json`) containing **153 skills**, **146 aliases**, **17 role profiles**, **31 role synonyms**, and **34 relationship edges**.

Four rules matter more than the weighted sum:

1. **Eligibility is separate from relevance.** Hard constraints produce `eligible = false`, `score = 0`, and an `ineligibleReasons` list. The score is only a ranking signal for eligible jobs.
2. **Missing data is not positive evidence.** A job with no extractable skills receives the conservative neutral `0.4`, not a bonus.
3. **Unknown is not satisfied.** A requirement the engine cannot judge (no structured skills, no verified experience) is reported as `UNKNOWN`; it never counts as met and never earns full credit.
4. **Everything is explained deterministically.** Each factor carries an `evidence` line, and each requirement carries a `MET` / `PARTIAL` / `MISSING` / `UNKNOWN` verdict with its source. No language model participates in scoring.

Verified profile data is first-class evidence. A skill can be proven by the skills list, a certification, a project, a degree/field, an experience title/description, or a language entry. The verdict records which section supplied the proof.

---

## Scoring Formula

```
if any hard eligibility filter fails:
    score = 0, eligible = false
else:
    pts = 25 × roleFrac
        + 30 × skillFrac
        + 15 × expFrac
        + 15 × locFrac
        +  5 × empFrac
        +  5 × freshFrac
        +  5 × salFrac
        − seniorityPenalty
        − onsitePenalty
        − negativeSignalPenalty
        − vacancyPenalty
        × lowConfidenceMultiplier

    score = clamp(round(pts), 0, 100), eligible = true
```

Eligibility is evaluated before the score is reported; it is not a penalty applied to an otherwise valid score.

### Factor Weights

| Factor | Weight | Description |
|--------|--------|-------------|
| **Role** | 25% | How well the job title matches the user's target roles |
| **Skills** | 30% | Skill overlap between job requirements and the user's skills |
| **Experience** | 15% | Whether the user's years match the job's level requirement |
| **Location** | 15% | Alignment between job location and the user's location preferences |
| **Employment** | 5% | Full-time, part-time, contract match |
| **Freshness** | 5% | Recency — newer jobs score higher (exponential decay) |
| **Salary** | 5% | Whether job salary meets the user's minimum |

---

## Factor Details

### 1. Role Alignment (25%)

Iterates over the user's `targetRoles` (each with a priority: HIGH/MEDIUM/LOW) and computes a similarity score against the job title.

**Priority weights:**
- HIGH → 1.0
- MEDIUM → 0.72
- LOW → 0.45

**Similarity detection** (`roleSimilarity()`) is **token-aware phrase matching**, not raw substring matching:

1. **Exact phrase match**: every token of the target role appears consecutively in the job title → **1.0**. `"accountant"` matches `"senior accountant"` but not `"accounting"`.
2. **Synonym phrase match**: the same check against `roleSynonyms` entries → **0.75**.
3. **Role profile keyword match**: if a title word longer than three characters overlaps a core skill of the role profile → **0.35**.

Tokenization lowercases the text and splits on anything except letters, digits, `+`, `#`, and `.`, so `c++`, `c#`, and `node.js` stay intact. Underscores in stored roles are converted to spaces and stray quotes are stripped, so `"backend_developer"` matches `"backend developer"`.

**Role profile bonus**: if `matchRoleProfile()` finds that the user's skills cover more than 50% of the role's **core skills**, the role score is boosted to at least `profileMatch × 0.8`.

### 2. Skills (30%)

Uses the v2 knowledge base's relationship graph to categorize each job skill:

| Category | Score contribution | Description |
|----------|-------------------|-------------|
| **Direct** | 1.0 | User has the exact skill (after normalization) |
| **Transferable** | best transferability ≥ 0.6 | User has a closely related skill |
| **Related** | 0.3 | Connected via the relationship graph (1-hop) |
| **Missing** | 0 | No match found |

The final `skillFrac` is `earnedWeight / totalWeight`. Skills outside the tech knowledge base are compared as plain text, case-insensitively (`"Accounting"` equals `"accounting"`).

**Verified evidence sources (Phase 6)**: before matching, the engine builds an evidence map from the candidate's verified sections. A skill is treated as present when it appears in:

- the skills list (`your profile skills`),
- a certification name or issuer (`certification: AWS Certified Cloud Practitioner`),
- a project name or description (`project: …`),
- an education degree or field (`education: BSc in Computer Science`),
- an experience title or description (`experience: … at …`),
- a language entry (`language: Amharic (NATIVE)`).

Matching is whole-word and ignores aliases shorter than three characters (`ts`, `go`, `r`) to avoid evidence from prose noise.

**Empty skill arrays**: When a job has no extractable skills (common with HTML-scraped Ethiopian job boards), `skillFrac` defaults to **0.4** and the required-skill verdict is `UNKNOWN`. This is deliberately conservative: missing employer data must not make an unrelated job look like a strong match. Role, location, and experience can still push a genuinely aligned job above threshold.

**Transferability** is looked up via:
1. Direct `transferability` map in the skill entry
2. Reverse lookup
3. Relationship weight × 0.8
4. 1-hop related skills → 0.4

### 3. Experience (15%)

| Scenario | `expFrac` | Verdict |
|----------|-----------|---------|
| Job is ENTRY or INTERN level | **1.0** | `MET` (no prior experience required) |
| Required years = 0 | **1.0** | `MET` |
| User has ≥ required years | **1.0** | `MET` |
| User has fewer years | `clamp(max(0.3, userYears / requiredYears), 0, 1)` | `MISSING` |
| Job level is not specific (`UNKNOWN`) | **0.5** | `UNKNOWN` |
| Profile has no verified experience | **0.5** | `UNKNOWN` |

The floor of **0.3** ensures 0-year profiles aren't severely punished for mid-level roles.

**Verified years**: the engine uses the user's stated years when present; otherwise it derives them from the earliest dated experience entry (`currentYear − earliest startYear`). A profile with neither is unknown, not zero.

**Experience years by level** (from `experienceYears` in the knowledge base):
- INTERN → 0
- ENTRY → 1
- ASSOCIATE → 2
- MID → 3
- SENIOR → 5
- LEAD → 7
- PRINCIPAL → 10

### 4. Location (15%)

**Tier priority mapping:**
- HIGH → 1.0
- MEDIUM → 0.62
- LOW → 0.38
- Not listed → 0.12

**Location class resolution:**

| Job `locationClass` | Resolved tier |
|---------------------|---------------|
| `ETHIOPIA_LOCAL` | User's Ethiopia tier (or Ethiopian city tier) |
| `ETHIOPIA_REMOTE` | max(Ethiopia tier, Remote tier) |
| `INTERNATIONAL_REMOTE` | User's Remote tier |
| Other (on-site) | User's tier for the job's country |

**Ethiopian city resolution**: If the user has `addis_ababa` at MEDIUM tier but no explicit `Ethiopia` entry, Ethiopian-local jobs resolve to the MEDIUM tier. Conversely, if the user has `Ethiopia` but not a specific city, city-tier lookups resolve to the Ethiopia tier.

**Known Ethiopian cities**: addis ababa, bahir dar, hawassa, dire dawa, jimma, mekelle, adama, dessie, gondar, harar, arba minch, debremarkos, hossana, shashamane, nazret, bolda.

### 5. Employment Type (5%)

Simple inclusion check:
- Match → 1.0
- No match → 0.35

### 6. Freshness (5%)

Exponential decay based on hours since posting:

```
freshFrac = max(0.05, exp(-hours / 72))
```

- Posted < 12h ago → ~0.84–1.0
- Posted 72h ago → ~0.37
- Posted 1 week ago → ~0.12
- Floor → 0.05

### 7. Salary (5%)

- If job has no salary data → 0.55 (neutral)
- If job salary ≥ user's minimum → 1.0
- Otherwise → `max(0.2, jobSalary / userMinSalary)`

---

## Requirement Verdicts (Phase 6)

Every match returns two lists of `RequirementVerdict` objects:

```typescript
{
  name: string;
  kind: 'SKILL' | 'EXPERIENCE';
  importance: 'REQUIRED' | 'PREFERRED';
  status: 'MET' | 'PARTIAL' | 'MISSING' | 'UNKNOWN';
  evidence: string;   // the verified profile source, or why it is unknown
}
```

- **Required** — the posting's extracted skills, plus its experience requirement. Job skills are `MET` (direct), `PARTIAL` (transferable), or `MISSING` (not verified). A posting with no structured skills yields one `UNKNOWN` requirement instead of a free pass.
- **Preferred** — role-profile `common` and `advanced` skills that the posting does not list as required. Boards rarely label preferences structurally, so the role profile is the deterministic fallback. Preferred verdicts are explanatory only; they do not change the score.

`missingRequirements` and `unknownRequirements` are flat name lists on the result for quick display. `preferredRequirements` keeps the full verdicts so the UI can show both "preferred you already have" (`MET`) and "preferred, not verified" (`MISSING`).

---

## Hard Eligibility Filters

These run before the score is reported. A failure produces `score = 0`, `eligible = false`, and at least one entry in `ineligibleReasons`.

| ID | Condition | Reason |
|----|-----------|--------|
| `remote-only` | `profile.remote` is true and the job declares `workPlace = ONSITE` | On-site role — you only want remote work |
| `exclude-onsite` | `profile.excludeOnsite` is true, the job is `ONSITE`, and `locationClass` is not `*LOCAL` | International on-site role — you excluded on-site work |
| `exclude-entry` | `profile.excludeEntryLevel` is true and the job is `ENTRY` or `INTERN` | Entry-level role — you hide entry-level jobs |
| `relevance-gate` | Fewer than 2 skill signals (direct + transferable + related) **and** role alignment < 0.5 | No role or skill alignment with your target roles |
| `inactive` | `job.status` is supplied and is not `ACTIVE` | Posting is no longer active |
| `expired` | `job.deadline` is in the past | Vacancy deadline has passed |

Unknown `workPlace` values are treated as non-strict, so a missing field does not silently exclude a job. The relevance gate prevents generic bonuses (location, freshness, neutral salary) from lifting an unrelated job above the notification threshold based on a single incidental tag.

---

## Penalties

### Seniority Penalty (−5)

Applied when the job title matches `/\b(senior|lead|principal|head)\b/` **and** the user has fewer than 4 years of experience. The code does not consult role synonyms for this penalty; a generic "Software Engineer" title does not trigger it.

### On-site Soft Penalty (−6)

Applied when the job is `ONSITE`, not locally available, and the user has `excludeOnsite: true`. In practice the same condition is also a hard filter, so an ineligible job never reaches a meaningful score; the penalty is retained defensively.

### Negative Signal Penalty (−20 max)

When a job's role matches a `negativeSignals` entry and the user's skills contain more than two weak-evidence skills but fewer than two core skills, the engine subtracts `min(20, weakMatches × 4)`. Example: a frontend candidate applying for a DevOps role.

### Stale Vacancy Penalty (−6)

Applied when the posting has a `lastSeenAt` older than **7 days** and has not expired. The result carries `vacancy.risk = 'STALE'`. Staleness is measured on `lastSeenAt`, not `postedDate`, so an actively re-listed older role is not punished.

### Unverifiable Vacancy Penalty (−4)

Applied when `urlStatus` is present and is not `OK` (for example `ERROR`: the board blocked the re-check). The result carries `vacancy.risk = 'UNVERIFIED'`. This is a confidence penalty, not proof that the job is gone; expired postings are rejected outright.

### Low Confidence Multiplier (×0.9)

Applied when `parseConfidence < 40` — the job details may be incomplete or inaccurate.

---

## Knowledge Base Structure (`knowledge-base.json`)

| Section | Description |
|---------|-------------|
| `skills` | **153** skills with category, aliases, related skills, prerequisites, roles, and transferability scores |
| `aliases` | Canonical name lookup (**146** entries, e.g. `"js"` → `"JavaScript"`) |
| `categories` | Skill groupings (languages, frontend, backend, devops, cloud, ai_ml, etc.) |
| `relationships` | **34** directional weighted edges between skills |
| `transferability` | Cross-skill similarity scores (e.g., React → Vue = 0.55) |
| `roleProfiles` | **17** core/common/advanced skill profiles |
| `roleSynonyms` | **31** alternate names for roles |
| `seniority` | Level definitions with min/max years and responsibilities |
| `experienceYears` | Years required per experience level |
| `requirementWeights` | Importance weights for different requirement types |
| `negativeSignals` | Skills that signal a domain mismatch |

---

## Input Types

### `ProfileInput` (User)

```typescript
{
  skills: string[];                                    // User's skill names
  targetRoles: { role: string; priority: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  locationTiers: Record<string, 'HIGH' | 'MEDIUM' | 'LOW' | ''>;
  remote: boolean;
  employmentTypes: string[];                           // e.g., ["FULL_TIME", "PART_TIME"]
  years: number;                                       // Professional experience
  minSalary: number;
  excludeOnsite: boolean;
  excludeEntryLevel: boolean;                          // Hide ENTRY/INTERN postings
  // Phase 6 verified sections (optional for backward compatibility)
  education?: { institution: string; degree?: string | null; field?: string | null; endYear?: number | null }[];
  experience?: { title: string; company: string; startYear?: number | null; endYear?: number | null; current?: boolean; description?: string | null }[];
  projects?: { name: string; description?: string | null; year?: number | null }[];
  certifications?: { name: string; issuer?: string | null; year?: number | null }[];
  languages?: { language: string; proficiency?: string | null }[];
}
```

### `JobInput` (Job)

```typescript
{
  title: string;
  skills: string[];                                    // Extracted from description
  locationClass: 'ETHIOPIA_LOCAL' | 'ETHIOPIA_REMOTE' | 'INTERNATIONAL_REMOTE' | string;
  location: string;                                    // Raw location string
  country?: string;
  employmentType: string;
  experienceLevel: string;                             // INTERN, ENTRY, MID, SENIOR, etc.
  salary?: number | null;
  workPlace?: string;                                  // ONSITE, REMOTE, HYBRID
  parseConfidence: number;                             // 0-100
  postedAt: Date | number;
  // Phase 6 vacancy signals (optional)
  status?: string;                                     // ACTIVE, EXPIRED, ...
  deadline?: Date | number | null;
  lastSeenAt?: Date | number | null;
  urlStatus?: string | null;                           // OK, ERROR, ...
}
```

### `MatchResult` (Output)

```typescript
{
  score: number;                  // 0-100; 0 when ineligible
  roleTarget: string | null;      // Best-matching target role name
  eligible: boolean;              // False when a hard filter failed
  ineligibleReasons: string[];    // Human-readable hard-filter reasons
  parts: ScoreBreakdown[];        // Per-factor breakdown, each with `evidence`
  matchedSkills: string[];        // Direct skill matches
  transferableSkills: string[];   // Skills matched via transferability
  relatedSkills: string[];        // transferable + related (as returned by the engine)
  missingSkills: string[];        // Unmatched job skills
  reasons: string[];              // Human-readable explanation strings
  summary: string;                // One-line summary for notifications
  // Phase 6 explainability
  eligibility: { status: 'ELIGIBLE' | 'REJECTED'; reasons: string[] };
  requiredRequirements: RequirementVerdict[];
  preferredRequirements: RequirementVerdict[];
  missingRequirements: string[];
  unknownRequirements: string[];
  vacancy: { risk: 'OK' | 'EXPIRED' | 'STALE' | 'UNVERIFIED'; reasons: string[] };
  evidence: string[];              // One line per score factor
}
```

---

## Service Layer (`matching.service.ts`)

### `matchUnmatchedJobs(limit?)`

FR-018 incremental matching. Runs on a cron schedule (default every 10 minutes, `MATCH_CYCLE_INTERVAL`):

1. Fetches ACTIVE, `eligibility = ELIGIBLE` jobs where `matchedAt IS NULL`
2. Fetches all users with at least one skill or target role
3. Builds profiles in batch (9 parallel queries: profile, skills, roles, locations, education, experience, projects, certifications, languages)
4. Scores every (user, job) pair
5. Persists `JobMatch` records via bulk upsert
6. Sends notifications for scores ≥ user's threshold
7. Yields to the event loop every 50 users to prevent blocking

**Returns**: `{ jobsEvaluated, usersProcessed, matchesCreated, aboveThreshold, sent, toInbox, skipped }`

### Persisted explanation (Phase 6)

Each `JobMatch` stores the deterministic explanation, not just the score:

| Column | Content |
|--------|---------|
| `requiredRequirements` | JSON array of required `RequirementVerdict`s |
| `preferredRequirements` | JSON array of preferred `RequirementVerdict`s |
| `missingRequirements` / `unknownRequirements` | Flat name arrays |
| `evidence` | One line per score factor |
| `vacancyRisk` | `OK`, `EXPIRED`, `STALE`, or `UNVERIFIED` |
| `matcherVersion` | `v3.0-requirements` for new rows; older rows keep `v2.2-rules` |

### `recalculate(userId, limit?)`

Full re-score of all ACTIVE jobs against a single user. Used when:
- User updates their profile (skills, roles, locations)
- Admin triggers manual recalculation
- Threshold changes

### `buildProfileInput(userId)`

Loads a user's profile from the database and assembles a `ProfileInput`, including `excludeEntryLevel` and all verified profile sections used as skill evidence.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MATCH_THRESHOLD` | **65** | Default score threshold for notifications |
| `INCREMENTAL_MATCH_LIMIT` | 250 | Max unmatched jobs per incremental pass |
| `RECALC_JOB_LIMIT` | 1000 | Max jobs for a full recalculation |
| `MATCH_CYCLE_INTERVAL` | **10m** | Match-cycle interval (sample `.env.example` uses 35m) |

Each user stores their own `matchThreshold` in the `User` table. The `MATCH_THRESHOLD` env var is the fallback when the user's value is null.

---

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Skill normalization | O(1) via pre-computed lowercase map + memoization cache |
| Role similarity | O(synonyms × title length) — typically < 10 iterations |
| Transferability lookup | O(userSkills × jobSkills) per job |
| Evidence scan | Whole-word skill scan of verified certifications, projects, education, experience, and languages per profile |
| Batch profile loading | 9 parallel Prisma queries (profile, skills, roles, locations, education, experience, projects, certifications, languages) |
| Event loop yielding | Every 50 users during incremental matching |

---

## Known Limitations

1. **Empty skill arrays**: Many Ethiopian HTML-scraped jobs lack extractable skills. The engine uses a 0.4 neutral and marks the requirement `UNKNOWN`; skill differentiation is lost for these jobs, and the relevance gate prevents unrelated jobs from benefiting.
2. **Requirement extraction is structured-first**: required qualifications come from the extractor's skill list and experience level. The engine does not parse free-text "Requirements" sections, so a requirement that the extractor missed is invisible to matching.
3. **Preferred qualifications are role-based**: the engine uses the role profile's common/advanced skills as the deterministic fallback when a posting does not label preferences. A board that does label preferences structurally is not yet read separately.
4. **Single-pass matching**: Each job is scored independently — no cross-job optimization or diversity injection.
5. **No learning**: The engine doesn't learn from user behavior (saves, rejections, applications). AI is not used for scoring; it may only be used later for prose explanations.
6. **Static knowledge base**: Skills and relationships must be manually updated in `knowledge-base.json`.
7. **Cross-source duplicates**: Phase 4 groups the same opening across boards into one canonical `Job`, so the match feed scores the canonical row once. Historical duplicate rows created before Phase 4 are grouped on backfill.

---

*See also: `docs/traceability.md` for requirement-to-test coverage (FR-018, FR-019, FR-020), and `docs/architecture-facts.md` for generated counts.*
