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

import * as fs from 'fs';
import * as path from 'path';

// ── Load v2 knowledge base ──────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'knowledge-base.json'), 'utf-8'));

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

// ── Export for external use (e.g. Prisma seed) ─────────────────────
export const SKILL_DICT: string[] = Object.keys(SKILLS);
export const SKILL_ALIAS: Record<string, string> = ALIASES;
export const SKILL_GRAPH: Record<string, string[]> = Object.fromEntries(
  Object.entries(SKILLS).map(([name, s]) => [name, s.related])
);
export const EXP_YEARS_EXPORT = EXP_YEARS;

/**
 * Normalize a raw skill string to its canonical name using the v2 alias map.
 * Falls back to exact match, then case-insensitive match in skills dict.
 */
export function normalizeSkill(raw: string): string {
  const t = String(raw).trim();
  const low = t.toLowerCase();
  // 1. Direct alias lookup
  if (ALIASES[low]) return ALIASES[low];
  // 2. Skills dict exact match
  if (SKILLS[t]) return t;
  // 3. Case-insensitive scan
  for (const name of Object.keys(SKILLS)) {
    if (name.toLowerCase() === low) return name;
  }
  return t;
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
  if (fwd) return fwd * 0.8; // discount by 0.8 for indirect transfer
  const rev = REL_WEIGHT.get(`${to}->from`);
  if (rev) return rev * 0.8;
  // Via related skills (1-hop)
  const sa = SKILLS[from];
  if (sa?.related.includes(to)) return 0.4; // weak related match
  const sb = SKILLS[to];
  if (sb?.related.includes(from)) return 0.4;
  return 0;
}

/**
 * Check if a skill meets the prerequisites for a target skill.
 * Returns true if all prerequisites are satisfied by the user's skill set.
 */
export function satisfiesPrerequisites(targetSkill: string, userSkills: string[]): boolean {
  const prereqs = PREREQUISITES[targetSkill];
  if (!prereqs || prereqs.length === 0) return true;
  return prereqs.every((p) => userSkills.includes(normalizeSkill(p)));
}

/**
 * Get the role similarity score between a job title and a target role.
 */
export function roleSimilarity(jobTitle: string, targetRole: string): number {
  const t = jobTitle.toLowerCase();
  const tr = targetRole.toLowerCase();

  // Direct substring match
  if (t.includes(tr)) return 1;

  // Synonym expansion
  const words = ROLE_SYNONYMS[tr] || [tr];
  let best = 0;
  for (const w of words) {
    if (t.includes(w)) best = Math.max(best, 0.75);
  }

  // Category-level match: if job title contains a word that appears in
  // any role's synonyms for the target role, give partial credit
  if (best === 0) {
    // Check if the job title contains any word from the target role's profile
    const profile = ROLE_PROFILES[tr];
    if (profile) {
      const titleWords = t.split(/\s+/);
      for (const word of titleWords) {
        if (word.length > 3) {
          // Check if this word relates to any core skill of the target role
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
    // Check if the job matches this role
    const roleWords = ROLE_SYNONYMS[role] || [role];
    const isJobRole = roleWords.some((w) => titleLower.includes(w));
    if (!isJobRole) continue;

    // Check how many weak evidence skills the user has
    const userNorm = userSkills.map(normalizeSkill);
    const weakMatches = signals.weakEvidence.filter((w) => userNorm.includes(normalizeSkill(w)));
    const coreMatches = signals.coreSkills.filter((c) => userNorm.includes(normalizeSkill(c)));

    // If user has mostly weak evidence and few core skills → negative signal
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
 *
 * Scoring tiers:
 * - Exact match: 1.00
 * - Strong transferable: 0.70-0.90
 * - Weak transferable: 0.40-0.60
 * - Related (graph): 0.30
 * - Missing: 0.00
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
      // Check transferability
      let bestTransfer = 0;
      let bestFrom = '';
      for (const us of userNorm) {
        const t = getTransferability(us, js);
        if (t > bestTransfer) {
          bestTransfer = t;
          bestFrom = us;
        }
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

  // Weighted skill fraction
  let totalWeight = 0;
  let earnedWeight = 0;
  for (const js of jobNorm) {
    totalWeight += 1;
    if (direct.includes(js)) {
      earnedWeight += 1.0;
    } else if (transferable.includes(js)) {
      // Use the actual transferability score
      let bestT = 0;
      for (const us of userNorm) {
        bestT = Math.max(bestT, getTransferability(us, js));
      }
      earnedWeight += bestT;
    } else if (related.includes(js)) {
      earnedWeight += 0.3;
    }
  }

  const skillFrac = totalWeight > 0 ? earnedWeight / totalWeight : 0.5;

  return { direct, transferable, related, missing, skillFrac };
}

/**
 * Match job against role profile (core/common/advanced).
 */
function matchRoleProfile(
  jobTitle: string,
  userSkills: string[],
): { roleMatch: number; roleProfile: string | null } {
  const titleLower = jobTitle.toLowerCase();
  const userNorm = [...new Set(userSkills.map(normalizeSkill))];

  for (const [role, profile] of Object.entries(ROLE_PROFILES)) {
    const roleWords = ROLE_SYNONYMS[role] || [role];
    const isMatch = roleWords.some((w) => titleLower.includes(w));
    if (!isMatch) continue;

    // Score against role profile
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
  parts: ScoreBreakdown[];
  matchedSkills: string[];
  transferableSkills: string[];
  relatedSkills: string[]; // kept for backwards compat — includes both transferable and graph-related
  missingSkills: string[];
  reasons: string[];
  summary: string;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

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
      roleTarget = tr.role;
      rolePrio = tr.priority;
    }
  }

  // Also check role profile match
  const { roleMatch: profileMatch } = matchRoleProfile(job.title, prof.skills);
  if (profileMatch > 0.5) {
    roleBest = Math.max(roleBest, profileMatch * 0.8);
    reasons.push(`Strong role profile match (${Math.round(profileMatch * 100)}% of core skills)`);
  }

  if (roleBest >= 0.9) reasons.push(`Matches your "${roleTarget}" goal (${rolePrio} priority)`);
  else if (roleBest >= 0.6) reasons.push(`Closely related to your "${roleTarget}" goal`);

  // ── 2. Skills (30%) — with transferability ────────────────────────
  const uNorm = [...new Set(prof.skills.map(normalizeSkill))];
  const { direct, transferable, related, missing, skillFrac } = matchSkills(
    job.skills || [],
    prof.skills,
  );

  if (direct.length) reasons.push(`${direct.length} direct skill matches`);
  if (transferable.length) reasons.push(`Transferable: ${transferable.join(', ')}`);
  if (related.length) reasons.push(`Related via graph: ${related.join(', ')}`);
  if (missing.length) reasons.push(`Missing: ${missing.join(', ')}`);

  // ── 3. Experience (15%) ───────────────────────────────────────────
  const reqYears = EXP_YEARS[job.experienceLevel] ?? 2;
  const expFrac = reqYears === 0 ? 1 : clamp(Math.max(0.15, prof.years / reqYears), 0, 1);
  if (prof.years >= reqYears) reasons.push(`Experience fits (${prof.years} yrs vs ${reqYears}+ required)`);
  else if (reqYears - prof.years >= 2) reasons.push(`Requires ${reqYears}+ yrs — you have ${prof.years}`);

  // ── 4. Location (15%) ─────────────────────────────────────────────
  const tierW: Record<string, number> = { HIGH: 1, MEDIUM: 0.62, LOW: 0.38 };
  const tw = (n: string) => tierW[prof.locationTiers[n] ?? ''] ?? 0.12;
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
  if (/\b(senior|lead|principal|head)\b/.test(titleL) && prof.years < 4) {
    pts -= 8;
    reasons.push('Seniority above your stated preference (−8)');
  }
  if (job.workPlace === 'ONSITE' && !job.locationClass.includes('LOCAL') && prof.excludeOnsite) {
    pts -= 6;
    reasons.push('On-site only conflicts with your preference (−6)');
  }
  if (job.parseConfidence < 40) {
    pts *= 0.9;
    reasons.push('Low parse confidence — details may be incomplete');
  }

  const score = clamp(Math.round(pts), 0, 100);

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
  const bits: string[] = [];
  if (roleTarget) bits.push(`matches your ${roleTarget} goal`);
  const allMatched = direct.length + transferable.length;
  if (job.skills?.length) bits.push(`${allMatched} of ${job.skills.length} skills`);
  if (transferable.length) bits.push(`${transferable.length} transferable`);
  if (job.locationClass.includes('REMOTE')) bits.push('remote');
  else if (job.locationClass === 'ETHIOPIA_LOCAL') bits.push('local (Ethiopia)');
  if (job.experienceLevel === 'ENTRY') bits.push('junior level');
  const summary = 'Matches your profile — ' + bits.join(', ') + '.';

  return {
    score,
    roleTarget,
    parts,
    matchedSkills: direct,
    transferableSkills: transferable,
    relatedSkills: [...transferable, ...related], // backwards compat: combined list
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
