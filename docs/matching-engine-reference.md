# Matching Engine — Technical Reference

> SRS v2.3 | Updated August 2026

## Overview

The matching engine scores every active job against each user's profile on a **0–100 scale**. Jobs scoring at or above the user's `matchThreshold` (default **65**) trigger a notification via Telegram or the Web Inbox fallback.

The engine lives in `backend/src/modules/matching/matching-engine.ts` and uses a **v2 knowledge base** (`knowledge-base.json`) with 130+ skills, transferability graphs, role profiles, and negative signal detection.

---

## Scoring Formula

```
score = clamp(round(pts), 0, 100)

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
```

### Factor Weights

| Factor | Weight | Description |
|--------|--------|-------------|
| **Role** | 25% | How well the job title matches the user's target roles |
| **Skills** | 30% | Skill overlap between job requirements and user's skills |
| **Experience** | 15% | Whether the user's years match the job's level requirement |
| **Location** | 15% | Alignment between job location and user's location preferences |
| **Employment** | 5% | Full-time, part-time, contract match |
| **Freshness** | 5% | Recency — newer jobs score higher (exponential decay) |
| **Salary** | 5% | Whether job salary meets user's minimum |

---

## Factor Details

### 1. Role Alignment (25%)

Iterates over the user's `targetRoles` (each with a priority: HIGH/MEDIUM/LOW) and computes a similarity score against the job title.

**Priority weights:**
- HIGH → 1.0
- MEDIUM → 0.72
- LOW → 0.45

**Similarity detection** (`roleSimilarity()`):
1. **Exact substring match**: If the job title contains the target role string → **1.0**
2. **Synonym match**: Check against `roleSynonyms` in the knowledge base → **0.75**
3. **Role profile match**: If the job title contains a word that overlaps with the role's core skills → **0.35**

**Role profile bonus**: If `matchRoleProfile()` finds that the user's skills cover >50% of the role's **core skills**, the role score is boosted to at least `profileMatch × 0.8`.

**Normalization**: Underscores are converted to spaces and stray quotes are stripped, so `"backend_developer"` matches `"backend developer"` in the knowledge base.

### 2. Skills (30%)

Uses the v2 knowledge base's relationship graph to categorize each job skill:

| Category | Score contribution | Description |
|----------|-------------------|-------------|
| **Direct** | 1.0 | User has the exact skill (after normalization) |
| **Transferable** | 0.6–1.0 | User has a closely related skill (transferability ≥ 0.6) |
| **Related** | 0.3 | Connected via the relationship graph (1-hop) |
| **Missing** | 0 | No match found |

The final `skillFrac` is `earnedWeight / totalWeight`.

**Empty skill arrays**: When a job has no extractable skills (common with HTML-scraped Ethiopian job boards), `skillFrac` defaults to **0.65** — a generous neutral that allows role + location alignment to push scores above threshold.

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

**Known Ethiopian cities**: addis ababa, bahir dar, hawassa, dire dawa, jimma, mekelle, adama, dessie, gondar, harar, arba minch, debremarkos, hossana, shashamane.

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

## Penalties

### Seniority Penalty (-5)

Applied when **all** of the following are true:
1. Job title contains `senior`, `lead`, `principal`, or `head` (regex: `/\b(senior|lead|principal|head)\b/`)
2. **OR** the job title matches a role synonym that includes "senior" in the role profile
3. User has fewer than 4 years of experience

### On-site Penalty (-6)

Applied when the job is on-site (`workPlace === 'ONSITE'`), not locally available, and the user has `excludeOnsite: true`.

### Negative Signal Penalty (-20 max)

When a user's skills are weakly aligned with a job's domain (e.g., a frontend candidate applying for DevOps roles), a penalty of up to 20 points is applied. Detected via the `negativeSignals` map in the knowledge base.

### Low Confidence Multiplier (×0.9)

Applied when `parseConfidence < 40` — the job details may be incomplete or inaccurate.

---

## Knowledge Base Structure (`knowledge-base.json`)

| Section | Description |
|---------|-------------|
| `skills` | 130+ skills with category, aliases, related skills, prerequisites, roles, and transferability scores |
| `aliases` | Canonical name lookup (e.g., `"js"` → `"JavaScript"`) |
| `categories` | Skill groupings (languages, frontend, backend, devops, cloud, ai_ml, etc.) |
| `relationships` | Directional weighted edges between skills (e.g., `"JavaScript" → "TypeScript" = 0.85`) |
| `transferability` | Cross-skill similarity scores (e.g., React → Vue = 0.55) |
| `roleProfiles` | Core/common/advanced skill lists per role |
| `roleSynonyms` | Alternate names for roles (e.g., `"backend developer"` → `["software engineer", "web developer"]`) |
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
  locationTiers: Record<string, 'HIGH' | 'MEDIUM' | 'LOW'>;
  remote: boolean;
  employmentTypes: string[];                           // e.g., ["FULL_TIME", "PART_TIME"]
  years: number;                                       // Professional experience
  minSalary: number;
  excludeOnsite: boolean;
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
  workPlace: string;                                   // ONSITE, REMOTE, HYBRID
  parseConfidence: number;                             // 0-100
  postedAt: Date | number;
}
```

### `MatchResult` (Output)

```typescript
{
  score: number;                  // 0-100
  roleTarget: string | null;      // Best-matching target role name
  parts: ScoreBreakdown[];        // Per-factor breakdown
  matchedSkills: string[];        // Direct skill matches
  transferableSkills: string[];   // Skills matched via transferability
  relatedSkills: string[];        // Skills matched via graph relationship
  missingSkills: string[];        // Unmatched job skills
  reasons: string[];              // Human-readable explanation strings
  summary: string;                // One-line summary for notifications
}
```

---

## Service Layer (`matching.service.ts`)

### `matchUnmatchedJobs(limit?)`

FR-018 incremental matching. Runs on a cron schedule:

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

Loads a user's profile from the database and assembles a `ProfileInput`.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MATCH_THRESHOLD` | **65** | Default score threshold for notifications |
| `INCREMENTAL_MATCH_LIMIT` | 250 | Max unmatched jobs per incremental pass |
| `RECALC_JOB_LIMIT` | 1000 | Max jobs for a full recalculation |

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

1. **Empty skill arrays**: Many Ethiopian HTML-scraped jobs lack extractable skills. The engine defaults to 0.65 neutral, but this means skill differentiation is lost for these jobs.
2. **Single-pass matching**: Each job is scored independently — no cross-job optimization or diversity injection.
3. **No learning**: The engine doesn't learn from user behavior (saves, rejections, applications).
4. **Static knowledge base**: Skills and relationships must be manually updated in `knowledge-base.json`.

---

*See also: `docs/traceability.md` for requirement-to-test coverage (FR-018, FR-019, FR-020).*
