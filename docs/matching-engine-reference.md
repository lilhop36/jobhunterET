# Matching Engine — Technical Reference

> Current implementation | Updated October 2026

## Overview

The matching engine scores every active job against each user's profile on a **0–100 scale**. Jobs scoring at or above the user's `matchThreshold` (default **65**) can trigger a notification via Telegram or the Web Inbox fallback.

The engine lives in `backend/src/modules/matching/matching-engine.ts` and uses a **v2 knowledge base** (`knowledge-base.json`) containing **153 skills**, **146 aliases**, **17 role profiles**, **31 role synonyms**, and **34 relationship edges**.

Two rules matter more than the weighted sum:

1. **Hard eligibility runs first.** Some constraints are not preferences: an ineligible job is returned with `score = 0`, `eligible = false`, and an `ineligibleReasons` list.
2. **Missing data is not positive evidence.** A job with no extractable skills receives the conservative neutral `0.4`, not a bonus.

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

**Empty skill arrays**: When a job has no extractable skills (common with HTML-scraped Ethiopian job boards), `skillFrac` defaults to **0.4**. This is deliberately conservative: missing employer data must not make an unrelated job look like a strong match. Role, location, and experience can still push a genuinely aligned job above threshold.

**Transferability** is looked up via:
1. Direct `transferability` map in the skill entry
2. Reverse lookup
3. Relationship weight × 0.8
4. 1-hop related skills → 0.4

### 3. Experience (15%)

| Scenario | `expFrac` |
|----------|-----------|
| Job is ENTRY or INTERN level | **1.0** (full credit — these jobs are for people with little experience) |
| Required years = 0 | **1.0** |
| User has ≥ required years | **1.0** |
| Otherwise | `clamp(max(0.3, userYears / requiredYears), 0, 1)` |

The floor of **0.3** ensures 0-year profiles aren't severely punished for mid-level roles.

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

## Hard Eligibility Filters

These run before the score is reported. A failure produces `score = 0`, `eligible = false`, and at least one entry in `ineligibleReasons`.

| ID | Condition | Reason |
|----|-----------|--------|
| `remote-only` | `profile.remote` is true and the job declares `workPlace = ONSITE` | On-site role — you only want remote work |
| `exclude-onsite` | `profile.excludeOnsite` is true, the job is `ONSITE`, and `locationClass` is not `*LOCAL` | International on-site role — you excluded on-site work |
| `exclude-entry` | `profile.excludeEntryLevel` is true and the job is `ENTRY` or `INTERN` | Entry-level role — you hide entry-level jobs |
| `relevance-gate` | Fewer than 2 skill signals (direct + transferable + related) **and** role alignment < 0.5 | No role or skill alignment with your target roles |

Unknown `workPlace` values are treated as non-strict, so a missing field does not silently exclude a job. The relevance gate prevents generic bonuses (location, freshness, neutral salary) from lifting an unrelated job above the notification threshold based on a single incidental tag.

---

## Penalties

### Seniority Penalty (−5)

Applied when the job title matches `/\b(senior|lead|principal|head)\b/` **and** the user has fewer than 4 years of experience. The code does not consult role synonyms for this penalty; a generic "Software Engineer" title does not trigger it.

### On-site Soft Penalty (−6)

Applied when the job is `ONSITE`, not locally available, and the user has `excludeOnsite: true`. In practice the same condition is also a hard filter, so an ineligible job never reaches a meaningful score; the penalty is retained defensively.

### Negative Signal Penalty (−20 max)

When a job's role matches a `negativeSignals` entry and the user's skills contain more than two weak-evidence skills but fewer than two core skills, the engine subtracts `min(20, weakMatches × 4)`. Example: a frontend candidate applying for a DevOps role.

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
}
```

### `MatchResult` (Output)

```typescript
{
  score: number;                  // 0-100; 0 when ineligible
  roleTarget: string | null;      // Best-matching target role name
  eligible: boolean;              // False when a hard filter failed
  ineligibleReasons: string[];    // Human-readable hard-filter reasons
  parts: ScoreBreakdown[];        // Per-factor breakdown
  matchedSkills: string[];        // Direct skill matches
  transferableSkills: string[];   // Skills matched via transferability
  relatedSkills: string[];        // transferable + related (as returned by the engine)
  missingSkills: string[];        // Unmatched job skills
  reasons: string[];              // Human-readable explanation strings
  summary: string;                // One-line summary for notifications
}
```

---

## Service Layer (`matching.service.ts`)

### `matchUnmatchedJobs(limit?)`

FR-018 incremental matching. Runs on a cron schedule (default every 10 minutes, `MATCH_CYCLE_INTERVAL`):

1. Fetches ACTIVE jobs where `matchedAt IS NULL`
2. Fetches all users with at least one skill or target role
3. Builds profiles in batch (4 parallel queries)
4. Scores every (user, job) pair
5. Persists `JobMatch` records via bulk upsert
6. Sends notifications for scores ≥ user's threshold
7. Yields to the event loop every 50 users to prevent blocking

**Returns**: `{ jobsEvaluated, usersProcessed, matchesCreated, aboveThreshold, sent, toInbox, skipped }`

### `recalculate(userId, limit?)`

Full re-score of all ACTIVE jobs against a single user. Used when:
- User updates their profile (skills, roles, locations)
- Admin triggers manual recalculation
- Threshold changes

### `buildProfileInput(userId)`

Loads a user's profile from the database and assembles a `ProfileInput`, including `excludeEntryLevel`.

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
| Batch profile loading | 4 parallel Prisma queries (profiles, skills, roles, locations) |
| Event loop yielding | Every 50 users during incremental matching |

---

## Known Limitations

1. **Empty skill arrays**: Many Ethiopian HTML-scraped jobs lack extractable skills. The engine uses a 0.4 neutral, so skill differentiation is lost for these jobs; the relevance gate prevents unrelated jobs from benefiting.
2. **Single-pass matching**: Each job is scored independently — no cross-job optimization or diversity injection.
3. **No learning**: The engine doesn't learn from user behavior (saves, rejections, applications).
4. **Static knowledge base**: Skills and relationships must be manually updated in `knowledge-base.json`.
5. **No cross-source deduplication**: identical postings from two sources are scored twice. Within one source, ingestion refreshes the existing row when `(sourceId, fingerprint)` matches; see the architecture overview's dedup stage.

---

*See also: `docs/traceability.md` for requirement-to-test coverage (FR-018, FR-019, FR-020), and `docs/architecture-facts.md` for generated counts.*
