/* Matching engine v2 — uses the v2 knowledge base for intelligent skill matching.
 *
 * Improvements over v1:
 * - Transferable skill scoring (Node.js + TypeScript → NestJS = 0.90)
 * - Prerequisite-aware matching
 * - Role profile matching (core vs common vs advanced skills)
 * - Negative signal detection (DevOps job vs frontend candidate)
 * - Directional relationships with weights
 * - Skill categories for domain understanding
 * - Seniority with responsibility modeling
 */

import * as kb from './knowledge-base.json';

// ── Load v2 knowledge base ──────────────────────────────────────────
// Load skill synonym map at startup
//   resolveJsonModule: true in tsconfig + copy-assets ensures this works.

const raw: any = kb;

interface SkillEntry {
  category: string;
  aliases: string[];
  related: string[];
  prerequisites: string[];
  roles: string[];
  transferability: Record<string, number>;
}

interface Relationship {
  from: string;
  to: string;
  type: string;
  weight: number;
}

interface RoleProfile {
  core: string[];
  common: string[];
  advanced: string[];
}

interface SeniorityLevel {
  minYears: number;
  maxYears: number | null;
  responsibilities: string[];
}

interface NegativeSignal {
  coreSkills: string[];
  weakEvidence: string[];
}

// Build fast lookup maps from v2 data
const SKILLS: Record<string, SkillEntry> = raw.skills;
const ALIASES: Record<string, string> = raw.aliases;
const CATEGORIES: Record<string, string[]> = raw.categories;
const RELATIONSHIPS: Relationship[] = raw.relationships;
const TRANSFERABILITY: Record<string, Record<string, number>> = raw.transferability;
const PREREQUISITES: Record<string, string[]> = raw.prerequisites;
const ROLE_PROFILES: Record<string, RoleProfile> = raw.roleProfiles;
const ROLE_SYNONYMS: Record<string, string[]> = raw.roleSynonyms;
const SENIORITY: Record<string, SeniorityLevel> = raw.seniority;
const EXP_YEARS: Record<string, number> = raw.experienceYears;
const REQUIREMENT_WEIGHTS: Record<string, number> = raw.requirementWeights;
const NEGATIVE_SIGNALS: Record<string, NegativeSignal> = raw.negativeSignals;

// Build reverse alias map: canonical → [aliases]
const CANONICAL_TO_ALIASES = new Map<string, string[]>();
for (const [alias, canonical] of Object.entries(ALIASES)) {
  const existing = CANONICAL_TO_ALIASES.get(canonical) || [];
  existing.push(alias);
  CANONICAL_TO_ALIASES.set(canonical, existing);
}

// Build relationship lookup: "A->B" → weight
const REL_WEIGHT = new Map<string, number>();
for (const r of RELATIONSHIPS) {
  REL_WEIGHT.set(`${r.from}->${r.to}`, r.weight);
}

// Memoization cache for normalizeSkill
const NORM_CACHE = new Map<string, string>();

// Pre-computed lowercase skill lookup
const SKILLS_LOWERCASE = new Map<string, string>();
for (const name of Object.keys(SKILLS)) {
  SKILLS_LOWERCASE.set(name.toLowerCase(), name);
}

// ── Export for external use (e.g. Prisma seed) ─────────────────────
export const SKILL_DICT: string[] = Object.keys(SKILLS);
export const SKILL_ALIAS: Record<string, string> = ALIASES;
export const SKILL_GRAPH: Record<string, string[]> = Object.fromEntries(
  Object.entries(SKILLS).map(([name, s]) => [name, s.related])
);
export const EXP_YEARS_EXPORT = EXP_YEARS;

/**
 * Normalize a raw skill string to its canonical name using the v2 alias map.
 * Falls back to exact match, then O(1) case-insensitive match via pre-computed map.
 */
export function normalizeSkill(raw: string): string {
  const t = String(raw).trim();
  const low = t.toLowerCase();
  const cached = NORM_CACHE.get(low);
  if (cached) return cached;

  let result: string;
  // 1. Direct alias lookup
  if (ALIASES[low]) result = ALIASES[low];
  // 2. Skills dict exact match
  else if (SKILLS[t]) result = t;
  // 3. Case-insensitive scan
  else {
    result = t;
    for (const name of Object.keys(SKILLS)) {
      if (name.toLowerCase() === low) { result = name; break; }
    }
  }

  NORM_CACHE.set(low, result);
  return result;
}

/**
 * Check if two skills are related via the v2 relationship graph.
 * Uses directional relationships with weights.
 */
export function areSkillsRelated(a: string, b: string): boolean {
  if (a === b) return false;
  // Check direct relationships
  if (REL_WEIGHT.has(`${a}->${b}`) || REL_WEIGHT.has(`${b}->${a}`)) return true;
  // Check via skill entry related list
  const sa = SKILLS[a];
  const sb = SKILLS[b];
  if (sa?.related.includes(b) || sb?.related.includes(a)) return true;
  return false;
}

/**
 * Get the transferability score from skill A to skill B.
 * Returns 0 if not transferable, 0-1 otherwise.
 */
export function getTransferability(from: string, to: string): number {
  // Direct transferability lookup
  if (TRANSFERABILITY[from]?.[to]) return TRANSFERABILITY[from][to];
  // Reverse lookup
  if (TRANSFERABILITY[to]?.[from]) return TRANSFERABILITY[to][from];
  // Via relationship weight
  const fwd = REL_WEIGHT.get(`${from}->${to}`);
  if (fwd) return fwd * 0.8;
  const rev = REL_WEIGHT.get(`${to}->${from}`);
  if (rev) return rev * 0.8;
  // Via related skills (1-hop)
  const sa = SKILLS[from];
  if (sa?.related.includes(to)) return 0.4;
  const sb = SKILLS[to];
  if (sb?.related.includes(from)) return 0.4;
  return 0;
}

/**
 * Check if a skill meets the prerequisites for a target skill.
 */
export function satisfiesPrerequisites(targetSkill: string, userSkills: string[]): boolean {
  const prereqs = PREREQUISITES[targetSkill];
  if (!prereqs || prereqs.length === 0) return true;
  return prereqs.every((p) => userSkills.includes(normalizeSkill(p)));
}

// Words that are too generic to establish role relevance on their own.
// A synonym hit must be qualified by one of these context words elsewhere
// in the title (e.g. "Software Developer", "Senior Web Engineer").
const GENERIC_ROLE_WORDS = new Set(['developer', 'engineer', 'programmer', 'coder']);
const TECH_QUALIFIERS = new Set([
  'software', 'web', 'backend', 'back-end', 'frontend', 'front-end',
  'fullstack', 'full-stack', 'mobile', 'app', 'api', 'data', 'ai',
  'ml', 'machine', 'devops', 'cloud', 'qa', 'security', 'embedded',
  'games', 'game', 'ios', 'android', '.net', 'java', 'python',
]);

/** True when every token of `phrase` appears as a whole word in `tokens`. */
function containsPhrase(tokens: string[], phrase: string): boolean {
  const pt = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!pt.length) return false;
  for (let i = 0; i + pt.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < pt.length; j++) {
      if (tokens[i + j] !== pt[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/** Tokenize a title into lowercase word tokens (non-alphanumerics split). */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean);
}

/**
 * Get the role similarity score between a job title and a target role.
 * Uses normalized, token-aware matching: synonyms must appear as whole
 * phrases, and bare generic words ("developer", "engineer") only count
 * when the title also contains a technical qualifier. This prevents
 * unrelated titles like "Learning Designer and Developer" from earning
 * software-engineering role credit through substring luck.
 */
export function roleSimilarity(jobTitle: string, targetRole: string): number {
  const t = jobTitle.toLowerCase();
  const tokens = tokenize(jobTitle);
  // Normalize underscores to spaces and strip stray quotes so that
  // user-stored roles like '"backend_developer"' or 'backend_developer'
  // match knowledge-base keys like 'backend developer'.
  const tr = targetRole.toLowerCase().replace(/["']/g, '').replace(/_/g, ' ').trim();

  // If the target role itself is a bare generic word ("developer",
  // "engineer"), it still needs technical context in the title.
  const qualifierPresent = tokens.some((w) => TECH_QUALIFIERS.has(w));
  if (containsPhrase(tokens, tr)) {
    if (!(GENERIC_ROLE_WORDS.has(tr) && !qualifierPresent)) return 1;
  }

  const words = ROLE_SYNONYMS[tr] || [tr];
  let best = 0;
  for (const w of [...words, tr]) {
    // Single generic words use token-aware matching (needs technical
    // context); multi-word phrases keep substring matching so that
    // hyphenated titles like "Senior Fullstack Engineer" still match
    // the "full-stack" synonym.
    const single = w.trim().split(/\s+/).length === 1;
    if (single ? !containsPhrase(tokens, w) : !t.includes(w)) continue;
    // Generic single-word synonyms need technical context to count.
    if (single && GENERIC_ROLE_WORDS.has(w.trim()) && !qualifierPresent) continue;
    best = Math.max(best, 0.75);
  }

  if (best === 0) {
    const profile = ROLE_PROFILES[tr];
    if (profile) {
      const titleWords = t.split(/\s+/);
      for (const word of titleWords) {
        if (word.length > 3) {
          for (const coreSkill of profile.core) {
            const coreNorm = normalizeSkill(coreSkill);
            if (coreNorm.toLowerCase().includes(word) || word.includes(coreNorm.toLowerCase())) {
              best = Math.max(best, 0.35);
            }
          }
        }
      }
    }
  }

  return best;
}

/**
 * Detect negative signals: when the job domain is very different from
 * the candidate's core skills.
 */
function detectNegativeSignals(
  jobTitle: string,
  jobSkills: string[],
  userSkills: string[],
): { isNegative: boolean; penalty: number; reason: string } {
  const titleLower = jobTitle.toLowerCase();

  for (const [role, signals] of Object.entries(NEGATIVE_SIGNALS)) {
    const roleWords = ROLE_SYNONYMS[role] || [role];
    const isJobRole = roleWords.some((w) => titleLower.includes(w));
    if (!isJobRole) continue;

    const userNorm = userSkills.map(normalizeSkill);
    const weakMatches = signals.weakEvidence.filter((w) => userNorm.includes(normalizeSkill(w)));
    const coreMatches = signals.coreSkills.filter((c) => userNorm.includes(normalizeSkill(c)));

    if (weakMatches.length > 2 && coreMatches.length < 2) {
      return {
        isNegative: true,
        penalty: Math.min(20, weakMatches.length * 4),
        reason: `Your skills (${weakMatches.slice(0, 3).join(', ')}) are weakly aligned with ${role} roles`,
      };
    }
  }

  return { isNegative: false, penalty: 0, reason: '' };
}

/**
 * Match user skills against job skills using v2 knowledge graph.
 */
function matchSkills(
  jobSkills: string[],
  userSkills: string[],
): { direct: string[]; transferable: string[]; related: string[]; missing: string[]; skillFrac: number } {
  const userNorm = [...new Set(userSkills.map(normalizeSkill))];
  const jobNorm = [...new Set(jobSkills.map(normalizeSkill))];

  const direct: string[] = [];
  const transferable: string[] = [];
  const related: string[] = [];
  const missing: string[] = [];

  for (const js of jobNorm) {
    if (userNorm.includes(js)) {
      direct.push(js);
    } else {
      let bestTransfer = 0;
      for (const us of userNorm) {
        const t = getTransferability(us, js);
        if (t > bestTransfer) bestTransfer = t;
      }

      if (bestTransfer >= 0.6) {
        transferable.push(js);
      } else if (userNorm.some((us) => areSkillsRelated(us, js))) {
        related.push(js);
      } else {
        missing.push(js);
      }
    }
  }

  let totalWeight = 0;
  let earnedWeight = 0;
  for (const js of jobNorm) {
    totalWeight += 1;
    if (direct.includes(js)) {
      earnedWeight += 1.0;
    } else if (transferable.includes(js)) {
      let bestT = 0;
      for (const us of userNorm) {
        bestT = Math.max(bestT, getTransferability(us, js));
      }
      earnedWeight += bestT;
    } else if (related.includes(js)) {
      earnedWeight += 0.3;
    }
  }

  // A job with no extractable skills carries NO evidence about skill fit.
  // Missing employer data must not be treated as positive evidence, so we
  // use a conservative neutral (0.4) instead of the old generous 0.65.
  // The relevance gate below still lets genuinely role-aligned jobs with
  // empty skill arrays reach useful scores via their other dimensions.
  const skillFrac = totalWeight > 0 ? earnedWeight / totalWeight : 0.4;

  return { direct, transferable, related, missing, skillFrac };
}

/**
 * Match job against role profile (core/common/advanced).
 */
function matchRoleProfile(
  jobTitle: string,
  userSkills: string[],
): { roleMatch: number; roleProfile: string | null } {
  const tokens = tokenize(jobTitle);
  const userNorm = [...new Set(userSkills.map(normalizeSkill))];

  for (const [role, profile] of Object.entries(ROLE_PROFILES)) {
    const roleWords = ROLE_SYNONYMS[role] || [role];
    // Token-aware phrase matching (same rules as roleSimilarity) so that
    // generic words alone cannot activate a role profile.
    const qualifierPresent = tokens.some((w) => TECH_QUALIFIERS.has(w));
    const isMatch = roleWords.some((w) => {
      const single = w.trim().split(/\s+/).length === 1;
      if (single && GENERIC_ROLE_WORDS.has(w.trim()) && !qualifierPresent) return false;
      return single ? containsPhrase(tokens, w) : jobTitle.toLowerCase().includes(w);
    });
    if (!isMatch) continue;

    let coreHits = 0;
    for (const s of profile.core) {
      const sn = normalizeSkill(s);
      if (userNorm.includes(sn) || userNorm.some((u) => areSkillsRelated(u, sn))) {
        coreHits++;
      }
    }

    const coreFrac = profile.core.length > 0 ? coreHits / profile.core.length : 0.5;
    return { roleMatch: coreFrac, roleProfile: role };
  }

  return { roleMatch: 0, roleProfile: null };
}

export type TierPriority = 'HIGH' | 'MEDIUM' | 'LOW' | '';

export interface ProfileInput {
  skills: string[];
  targetRoles: { role: string; priority: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  locationTiers: Record<string, TierPriority>;
  remote: boolean;
  employmentTypes: string[];
  years: number;
  minSalary: number;
  excludeOnsite: boolean;
}

export interface JobInput {
  title: string;
  skills: string[];
  locationClass: string;
  location: string;
  country?: string;
  employmentType: string;
  experienceLevel: string;
  salary?: number | null;
  workPlace?: string;
  parseConfidence: number;
  postedAt: Date | number;
}

export interface ScoreBreakdown {
  label: string;
  weight: number;
  fraction: number;
}

export interface MatchResult {
  score: number;
  roleTarget: string | null;
  eligible: boolean;
  ineligibleReasons: string[];
  parts: ScoreBreakdown[];
  matchedSkills: string[];
  transferableSkills: string[];
  relatedSkills: string[];
  missingSkills: string[];
  reasons: string[];
  summary: string;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Hoist regex to module-level constant
const SENIORITY_RE = /\b(senior|lead|principal|head)\b/;

/**
 * Score a job against a candidate profile using v2 knowledge base.
 *
 * Weights:
 * - Skills:          30% (with transferability)
 * - Role alignment:  25% (title + role profile)
 * - Experience:      15%
 * - Location:        15%
 * - Employment:       5%
 * - Freshness:        5%
 * - Salary:           5%
 */
export function scoreJob(job: JobInput, prof: ProfileInput): MatchResult {
  const reasons: string[] = [];
  let roleBest = 0;
  let roleTarget: string | null = null;
  let rolePrio = '';

  // ── 1. Role alignment (25%) ────────────────────────────────────────
  for (const tr of prof.targetRoles) {
    const w = tr.priority === 'HIGH' ? 1 : tr.priority === 'MEDIUM' ? 0.72 : 0.45;
    const s = roleSimilarity(job.title, tr.role) * w;
    if (s > roleBest) {
      roleBest = s;
      // Store a display-friendly role name (strip quotes, convert underscores to spaces)
      roleTarget = tr.role.replace(/["']/g, '').replace(/_/g, ' ');
      rolePrio = tr.priority;
    }
  }

  const { roleMatch: profileMatch } = matchRoleProfile(job.title, prof.skills);
  if (profileMatch > 0.5) {
    roleBest = Math.max(roleBest, profileMatch * 0.8);
    reasons.push(`Strong role profile match (${Math.round(profileMatch * 100)}% of core skills)`);
  }

  if (roleBest >= 0.9) reasons.push(`Matches your "${roleTarget}" goal (${rolePrio} priority)`);
  else if (roleBest >= 0.6) reasons.push(`Closely related to your "${roleTarget}" goal`);

  // ── 2. Skills (30%) — with transferability ────────────────────────

  const { direct, transferable, related, missing, skillFrac } = matchSkills(
    job.skills || [],
    prof.skills,
  );

  if (direct.length) reasons.push(`${direct.length} direct skill matches`);
  if (transferable.length) reasons.push(`Transferable: ${transferable.join(', ')}`);
  if (related.length) reasons.push(`Related via graph: ${related.join(', ')}`);
  if (missing.length) reasons.push(`Missing: ${missing.join(', ')}`);

  // ── Hard eligibility filters (checked before any scoring) ─────────
  // These are constraints, not preferences: excluded jobs get score 0
  // and eligible=false so callers can drop them from recommendations.
  const ineligibleReasons: string[] = [];

  // Remote-only seekers must not receive on-site jobs at all.
  // Only applies when the posting explicitly declares ONSITE — unknown
  // workPlace values are treated as non-strict to avoid over-filtering.
  if (prof.remote && job.workPlace === 'ONSITE') {
    ineligibleReasons.push('On-site role — you only want remote work');
  }

  // Excluding on-site work must also exclude international on-site jobs,
  // not just penalize them by a few points.
  if (
    prof.excludeOnsite &&
    job.workPlace === 'ONSITE' &&
    !job.locationClass.includes('LOCAL')
  ) {
    ineligibleReasons.push('International on-site role — you excluded on-site work');
  }

  // Relevance gate: without evidence that the job relates to one of the
  // candidate's target roles or core skills, generic bonuses (location,
  // experience, freshness, neutral salary) must not add up to a high
  // recommendation score.
  const hasCoreSkillOverlap =
    direct.length + transferable.length + related.length > 0;
  if (!hasCoreSkillOverlap && roleBest < 0.5) {
    ineligibleReasons.push('No role or skill alignment with your target roles');
  }

  const eligible = ineligibleReasons.length === 0;
  if (!eligible) {
    reasons.push(...ineligibleReasons);
  }

  // ── 3. Experience (15%) ───────────────────────────────────────────
  const reqYears = EXP_YEARS[job.experienceLevel] ?? 2;
  // Entry-level and intern roles give full credit — they are designed for
  // people with little or no professional experience.  Only mid/senior/lead
  // roles apply the experience ratio penalty.
  let expFrac: number;
  if (job.experienceLevel === 'ENTRY' || job.experienceLevel === 'INTERN') {
    expFrac = 1;
  } else if (reqYears === 0) {
    expFrac = 1;
  } else {
    expFrac = clamp(Math.max(0.3, prof.years / reqYears), 0, 1);
  }
  if (prof.years >= reqYears) reasons.push(`Experience fits (${prof.years} yrs vs ${reqYears}+ required)`);
  else if (reqYears - prof.years >= 2) reasons.push(`Requires ${reqYears}+ yrs — you have ${prof.years}`);

  // ── 4. Location (15%) ─────────────────────────────────────────────
  const tierW: Record<string, number> = { HIGH: 1, MEDIUM: 0.62, LOW: 0.38 };

  // Resolve a location tier for the user.  If the user has a specific city
  // (e.g. "addis_ababa") but no explicit "Ethiopia" entry, treat the city
  // as an Ethiopia-tier match.  Conversely, if the user has "Ethiopia"
  // but not a specific city, city-tier lookups resolve to the Ethiopia tier.
  const ETHIOPIAN_CITIES = new Set([
    'addis ababa', 'addis_ababa', 'bahir dar', 'bahir_dar', 'hawassa',
    'dire dawa', 'dire_dawa', 'jimma', 'mekelle', 'adama', 'dessie',
    'gondar', 'harar', 'arba minch', 'debremarkos', 'debre_markos',
    'hossana', 'shashamane', 'nazret', 'bolda',
  ]);
  // Build a set of user's Ethiopian city tiers for quick lookup
  const userEthioCityTier = (() => {
    for (const [region, tier] of Object.entries(prof.locationTiers)) {
      if (ETHIOPIAN_CITIES.has(region.toLowerCase().replace(/_/g, ' '))) return tier;
    }
    return '';
  })();

  const resolveTier = (key: string): string => {
    // Direct match (e.g. "Ethiopia", "Remote", "USA")
    const direct = prof.locationTiers[key];
    if (direct) return direct;
    // If querying for "Ethiopia" and user has a specific Ethiopian city → use that tier
    if (key === 'Ethiopia' && userEthioCityTier) return userEthioCityTier;
    // If user has "Ethiopia" and querying for an Ethiopian city → use Ethiopia tier
    if (ETHIOPIAN_CITIES.has(key.toLowerCase().replace(/_/g, ' '))) {
      return prof.locationTiers['Ethiopia'] ?? userEthioCityTier ?? '';
    }
    return '';
  };
  const tw = (n: string) => tierW[resolveTier(n)] ?? 0.12;

  let locFrac = 0;
  let locWhy = '';
  if (job.locationClass === 'ETHIOPIA_LOCAL') {
    locFrac = tw('Ethiopia');
    locWhy = `In Ethiopia (${job.location.split(',')[0]}) — your top market`;
  } else if (job.locationClass === 'ETHIOPIA_REMOTE') {
    locFrac = Math.max(tw('Ethiopia'), tw('Remote'));
    locWhy = 'Remote-friendly Ethiopian role';
  } else if (job.locationClass === 'INTERNATIONAL_REMOTE') {
    locFrac = tw('Remote');
    locWhy = 'Fully remote (international)';
  } else {
    locFrac = tw(job.country || 'International');
    locWhy = `On-site in ${job.country || 'abroad'}`;
  }
  if (locFrac >= 0.9) reasons.push(locWhy);

  // ── 5. Employment type (5%) ────────────────────────────────────────
  const empFrac = prof.employmentTypes.includes(job.employmentType) ? 1 : 0.35;

  // ── 6. Freshness (5%) ──────────────────────────────────────────────
  const hours = (Date.now() - new Date(job.postedAt).getTime()) / 3_600_000;
  const freshFrac = Math.max(0.05, Math.exp(-hours / 72));
  if (hours <= 12) reasons.push(`Very fresh — posted ${Math.round(hours)}h ago`);

  // ── 7. Salary (5%) ─────────────────────────────────────────────────
  let salFrac = 0.55;
  if (job.salary) salFrac = job.salary >= prof.minSalary ? 1 : Math.max(0.2, job.salary / Math.max(1, prof.minSalary));

  // ── Calculate base score ───────────────────────────────────────────
  let pts =
    25 * roleBest +
    30 * skillFrac +
    15 * expFrac +
    15 * locFrac +
    5 * empFrac +
    5 * freshFrac +
    5 * salFrac;

  // ── Negative signal detection ──────────────────────────────────────
  const { isNegative, penalty, reason: negReason } = detectNegativeSignals(
    job.title,
    job.skills || [],
    prof.skills,
  );
  if (isNegative) {
    pts -= penalty;
    reasons.push(negReason);
  }

  // ── Additional penalties ───────────────────────────────────────────
  const titleL = job.title.toLowerCase();
  // Seniority penalty: only apply when the job is genuinely senior-level
  // (title contains senior keywords AND the role profile confirms it) AND
  // the candidate has fewer than 4 years of experience.  A generic title
  // like "Software Engineer" that happens to match a senior synonym in
  // the knowledge base should not trigger this penalty.
  // Seniority penalty fires when the job title contains senior-level keywords
  // (senior, lead, principal, head) and the candidate has < 4 years experience.
  if (SENIORITY_RE.test(titleL) && prof.years < 4) {
    pts -= 5;
    reasons.push('Seniority above your stated experience (−5)');
  }
  if (job.workPlace === 'ONSITE' && !job.locationClass.includes('LOCAL') && prof.excludeOnsite) {
    // Soft reminder only when the job is still eligible; hard-excluded
    // jobs never reach this point with a meaningful score.
    pts -= 6;
    reasons.push('On-site only conflicts with your preference (−6)');
  }
  if (job.parseConfidence < 40) {
    pts *= 0.9;
    reasons.push('Low parse confidence — details may be incomplete');
  }

  const rawScore = clamp(Math.round(pts), 0, 100);
  // Hard-ineligible jobs are reported as score 0 so they can never rank
  // into recommendations or cross any notification threshold.
  const score = eligible ? rawScore : 0;

  // ── Build breakdown ────────────────────────────────────────────────
  const parts: ScoreBreakdown[] = [
    { label: 'Role', weight: 25, fraction: roleBest },
    { label: 'Skills', weight: 30, fraction: skillFrac },
    { label: 'Experience', weight: 15, fraction: expFrac },
    { label: 'Location', weight: 15, fraction: locFrac },
    { label: 'Employment', weight: 5, fraction: empFrac },
    { label: 'Freshness', weight: 5, fraction: freshFrac },
    { label: 'Salary', weight: 5, fraction: salFrac },
  ];

  // ── Summary ────────────────────────────────────────────────────────
  let summary: string;
  if (!eligible) {
    summary = ineligibleReasons.join('; ') + '.';
  } else {
    const bits: string[] = [];
    if (roleTarget) bits.push(`matches your ${roleTarget} goal`);
    const allMatched = direct.length + transferable.length;
    if (job.skills?.length) bits.push(`${allMatched} of ${job.skills.length} skills`);
    if (transferable.length) bits.push(`${transferable.length} transferable`);
    if (job.locationClass.includes('REMOTE')) bits.push('remote');
    else if (job.locationClass === 'ETHIOPIA_LOCAL') bits.push('local (Ethiopia)');
    if (job.experienceLevel === 'ENTRY') bits.push('junior level');
    summary = 'Matches your profile — ' + bits.join(', ') + '.';
  }

  return {
    score,
    roleTarget,
    eligible,
    ineligibleReasons,
    parts,
    matchedSkills: direct,
    transferableSkills: transferable,
    relatedSkills: [...transferable, ...related],
    missingSkills: missing,
    reasons,
    summary,
  };
}

export class MatchingEngine {
  scoreJob(job: JobInput, prof: ProfileInput): MatchResult {
    return scoreJob(job, prof);
  }
}
