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

/** Tokenize text into lowercase word tokens. Hyphens, underscores and
 *  punctuation separate tokens, except for "+", "#" and "." which are part
 *  of skill names like "c++", "c#" and "node.js". */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean);
}

/** True when every token of `phrase` appears as a whole word in `tokens`.
 *  This is profession-neutral: "accountant" matches "senior accountant" but
 *  never "accounting", and "full-stack" matches "full stack". */
function containsPhrase(tokens: string[], phrase: string): boolean {
  const pt = tokenize(phrase);
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

/**
 * Get the role similarity score between a job title and a target role.
 * Token-aware phrase matching so results do not depend on the candidate's
 * profession (an accountant, nurse or driver matches exactly like a
 * developer does).
 */
export function roleSimilarity(jobTitle: string, targetRole: string): number {
  const tokens = tokenize(jobTitle);
  // Normalize underscores to spaces and strip stray quotes so that
  // user-stored roles like '"backend_developer"' or 'backend_developer'
  // match knowledge-base keys like 'backend developer'.
  const tr = targetRole.toLowerCase().replace(/["']/g, '').replace(/_/g, ' ').trim();

  if (containsPhrase(tokens, tr)) return 1;

  const words = ROLE_SYNONYMS[tr] || [tr];
  let best = 0;
  for (const w of [...words, tr]) {
    if (!containsPhrase(tokens, w)) continue;
    best = Math.max(best, 0.75);
  }

  if (best === 0) {
    const profile = ROLE_PROFILES[tr];
    if (profile) {
      for (const word of tokens) {
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
  // Skills outside the tech knowledge base are matched as plain text, so
  // compare them case-insensitively ("Accounting" == "accounting").
  const userKeys = new Set(userNorm.map((s) => s.toLowerCase()));

  const direct: string[] = [];
  const transferable: string[] = [];
  const related: string[] = [];
  const missing: string[] = [];

  for (const js of jobNorm) {
    if (userKeys.has(js.toLowerCase())) {
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
    // Token-aware phrase matching (same rules as roleSimilarity).
    const isMatch = roleWords.some((w) => containsPhrase(tokens, w));
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

/** Verified profile sections used as matching evidence (Phase 6). */
export interface ProfileEducation {
  institution: string;
  degree?: string | null;
  field?: string | null;
  endYear?: number | null;
}

export interface ProfileExperience {
  title: string;
  company: string;
  startYear?: number | null;
  endYear?: number | null;
  current?: boolean;
  description?: string | null;
}

export interface ProfileProject {
  name: string;
  description?: string | null;
  year?: number | null;
}

export interface ProfileCertification {
  name: string;
  issuer?: string | null;
  year?: number | null;
}

export interface ProfileLanguage {
  language: string;
  proficiency?: string | null;
}

export interface ProfileInput {
  skills: string[];
  targetRoles: { role: string; priority: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  locationTiers: Record<string, TierPriority>;
  remote: boolean;
  employmentTypes: string[];
  years: number;
  minSalary: number;
  excludeOnsite: boolean;
  /** Hide ENTRY/INTERN postings for candidates who are past that stage. */
  excludeEntryLevel: boolean;
  /** Phase 6: verified sections are optional so old callers keep working. */
  education?: ProfileEducation[];
  experience?: ProfileExperience[];
  projects?: ProfileProject[];
  certifications?: ProfileCertification[];
  languages?: ProfileLanguage[];
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
  /** Phase 6 vacancy signals. Optional: unknown means "not supplied". */
  status?: string;
  deadline?: Date | number | null;
  lastSeenAt?: Date | number | null;
  urlStatus?: string | null;
}

export interface ScoreBreakdown {
  label: string;
  weight: number;
  fraction: number;
  /** Phase 6: why this factor got this fraction. */
  evidence: string;
}

export type RequirementStatus = 'MET' | 'PARTIAL' | 'MISSING' | 'UNKNOWN';
export type RequirementKind = 'SKILL' | 'EXPERIENCE';
export type VacancyRisk = 'OK' | 'EXPIRED' | 'STALE' | 'UNVERIFIED';

export interface RequirementVerdict {
  name: string;
  kind: RequirementKind;
  importance: 'REQUIRED' | 'PREFERRED';
  status: RequirementStatus;
  /** The verified profile evidence behind the verdict, or why it is unknown. */
  evidence: string;
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
  /** Hard-gate result, kept separate from the relevance score. */
  eligibility: { status: 'ELIGIBLE' | 'REJECTED'; reasons: string[] };
  requiredRequirements: RequirementVerdict[];
  preferredRequirements: RequirementVerdict[];
  missingRequirements: string[];
  unknownRequirements: string[];
  vacancy: { risk: VacancyRisk; reasons: string[] };
  /** One line per score factor — every point is traceable. */
  evidence: string[];
}

export const MATCHER_VERSION = 'v3.0-requirements';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Hoist regex to module-level constant
const SENIORITY_RE = /\b(senior|lead|principal|head)\b/;

const DAY = 86_400_000;
/** A posting not re-seen for this long is treated as stale. */
const STALE_AFTER_DAYS = 7;
const STALE_PENALTY = 6;
/** A link that could not be re-checked is weaker evidence, not a dead end. */
const UNVERIFIED_PENALTY = 4;

/**
 * Canonical skill names plus aliases, used to find verified skill evidence
 * inside the structured profile text (certifications, projects, education,
 * experience). Short aliases ("ts", "js", "go", "r") are dropped: whole-word
 * matching them in prose produces more false evidence than signal.
 */
const SKILL_PHRASES: { canonical: string; phrases: string[] }[] = Object.keys(SKILLS)
  .map((canonical) => ({
    canonical,
    phrases: [canonical, ...(CANONICAL_TO_ALIASES.get(canonical) ?? [])]
      .map((p) => p.toLowerCase())
      .filter((p) => p.length >= 3),
  }))
  .filter((entry) => entry.phrases.length > 0);

/**
 * Map each verified skill to the profile sections that prove it. A skill
 * listed directly is evidence; a skill named in a certification, project,
 * degree or job title is also evidence, with its source recorded so the
 * explanation can point at it.
 */
export function buildSkillEvidence(prof: ProfileInput): Map<string, string[]> {
  const evidence = new Map<string, string[]>();

  const add = (skill: string, source: string) => {
    const canonical = normalizeSkill(skill);
    if (!canonical) return;
    const list = evidence.get(canonical) ?? [];
    if (!list.includes(source)) list.push(source);
    evidence.set(canonical, list);
  };

  const scan = (text: string | null | undefined, source: string) => {
    if (!text) return;
    const tokens = tokenize(text);
    for (const { canonical, phrases } of SKILL_PHRASES) {
      if (phrases.some((phrase) => containsPhrase(tokens, phrase))) add(canonical, source);
    }
  };

  for (const skill of prof.skills ?? []) add(skill, 'your profile skills');
  for (const cert of prof.certifications ?? []) {
    scan([cert.name, cert.issuer].filter(Boolean).join(' '), `certification: ${cert.name}`);
  }
  for (const project of prof.projects ?? []) {
    scan([project.name, project.description].filter(Boolean).join(' '), `project: ${project.name}`);
  }
  for (const edu of prof.education ?? []) {
    scan([edu.degree, edu.field].filter(Boolean).join(' '), `education: ${edu.degree ?? edu.institution}`);
  }
  for (const exp of prof.experience ?? []) {
    scan(
      [exp.title, exp.description].filter(Boolean).join(' '),
      `experience: ${exp.title} at ${exp.company}`,
    );
  }
  for (const lang of prof.languages ?? []) {
    add(lang.language, `language: ${lang.language}${lang.proficiency ? ` (${lang.proficiency})` : ''}`);
  }

  return evidence;
}

/**
 * Years of experience the profile can actually support. Stated years win;
 * otherwise the earliest verified role is used. Returns null when the profile
 * has no experience data at all — that is unknown, not zero years.
 */
export function deriveVerifiedYears(prof: ProfileInput): number | null {
  const stated = prof.years > 0 ? prof.years : null;
  const entries = prof.experience ?? [];
  if (!entries.length) return stated;

  const starts = entries
    .map((entry) => entry.startYear)
    .filter((year): year is number => typeof year === 'number' && year > 1900);
  if (!starts.length) return stated;

  const derived = new Date().getFullYear() - Math.min(...starts);
  const best = Math.max(stated ?? 0, derived);
  return best > 0 ? best : null;
}

/** Expired, stale and unverifiable postings are penalised, never boosted. */
function evaluateVacancy(job: JobInput): {
  risk: VacancyRisk;
  reasons: string[];
  penalty: number;
  blocked: string[];
} {
  const reasons: string[] = [];
  const blocked: string[] = [];
  const now = Date.now();
  let risk: VacancyRisk = 'OK';
  let penalty = 0;

  if (job.status && job.status !== 'ACTIVE') {
    blocked.push('Posting is no longer active');
  }

  if (job.deadline) {
    const deadline = new Date(job.deadline).getTime();
    if (Number.isFinite(deadline) && deadline < now) {
      risk = 'EXPIRED';
      blocked.push('Vacancy deadline has passed');
    } else if (Number.isFinite(deadline) && deadline - now <= 3 * DAY) {
      reasons.push('Deadline is within 3 days — apply soon');
    }
  }

  if (!blocked.length && job.lastSeenAt) {
    const lastSeen = new Date(job.lastSeenAt).getTime();
    const days = (now - lastSeen) / DAY;
    if (Number.isFinite(days) && days > STALE_AFTER_DAYS) {
      risk = 'STALE';
      penalty += STALE_PENALTY;
      reasons.push(`Not re-listed for ${Math.floor(days)} days — may be stale (−${STALE_PENALTY})`);
    }
  }

  // OK means the link was recently checked and worked. ERROR/other values
  // mean "could not verify", which is a small confidence penalty, not proof
  // that the job is gone.
  if (!blocked.length && job.urlStatus && job.urlStatus !== 'OK') {
    if (risk === 'OK') risk = 'UNVERIFIED';
    penalty += UNVERIFIED_PENALTY;
    reasons.push(`Posting could not be re-verified — apply link may be stale (−${UNVERIFIED_PENALTY})`);
  }

  return { risk, reasons, penalty, blocked };
}

/**
 * Required qualifications are what the posting states (its extracted skills
 * and experience level). Preferred qualifications come from the role profile
 * for the job title: boards rarely label preferences structurally, so role
 * expectations are the deterministic fallback.
 */
function buildRequirementVerdicts(
  job: JobInput,
  prof: ProfileInput,
  skillEvidence: Map<string, string[]>,
  match: { direct: string[]; transferable: string[]; related: string[] },
  roleKey: string | null,
): { required: RequirementVerdict[]; preferred: RequirementVerdict[] } {
  const required: RequirementVerdict[] = [];
  const jobSkills = [...new Set((job.skills ?? []).map(normalizeSkill))];
  const has = (list: string[], skill: string) =>
    list.some((value) => normalizeSkill(value) === skill);

  for (const skill of jobSkills) {
    const sources = skillEvidence.get(skill);
    if (has(match.direct, skill)) {
      required.push({
        name: skill,
        kind: 'SKILL',
        importance: 'REQUIRED',
        status: 'MET',
        evidence: sources?.length
          ? `Verified in ${sources.slice(0, 2).join('; ')}`
          : 'Listed on your profile',
      });
    } else if (has(match.transferable, skill)) {
      required.push({
        name: skill,
        kind: 'SKILL',
        importance: 'REQUIRED',
        status: 'PARTIAL',
        evidence: 'Transferable from a related skill, not a direct match',
      });
    } else {
      required.push({
        name: skill,
        kind: 'SKILL',
        importance: 'REQUIRED',
        status: 'MISSING',
        evidence: has(match.related, skill)
          ? 'Only a related skill is on your profile'
          : 'Not found in your verified profile',
      });
    }
  }

  if (!jobSkills.length) {
    required.push({
      name: 'Skill requirements',
      kind: 'SKILL',
      importance: 'REQUIRED',
      status: 'UNKNOWN',
      evidence: 'The posting lists no structured skills; unknown is not treated as met.',
    });
  }

  const preferred: RequirementVerdict[] = [];
  const role = roleKey ? ROLE_PROFILES[roleKey] : null;
  if (role) {
    const requiredNames = new Set(jobSkills);
    const candidates = [...new Set([...role.common, ...role.advanced])]
      .map(normalizeSkill)
      .filter((skill) => !requiredNames.has(skill))
      .slice(0, 6);
    for (const skill of candidates) {
      const sources = skillEvidence.get(skill);
      preferred.push({
        name: skill,
        kind: 'SKILL',
        importance: 'PREFERRED',
        status: sources?.length ? 'MET' : 'MISSING',
        evidence: sources?.length
          ? `Verified in ${sources[0]}`
          : 'Not found in your verified profile',
      });
    }
  }

  return { required, preferred };
}


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

  // Verified sections (certifications, projects, education, experience,
  // languages) can prove a skill even when it is not in the skills list.
  const skillEvidence = buildSkillEvidence(prof);
  const effectiveSkills = [
    ...new Set([...prof.skills.map(normalizeSkill), ...skillEvidence.keys()]),
  ];
  const verifiedYears = deriveVerifiedYears(prof);

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

  const { roleMatch: profileMatch, roleProfile } = matchRoleProfile(job.title, effectiveSkills);
  if (profileMatch > 0.5) {
    roleBest = Math.max(roleBest, profileMatch * 0.8);
    reasons.push(`Strong role profile match (${Math.round(profileMatch * 100)}% of core skills)`);
  }

  if (roleBest >= 0.9) reasons.push(`Matches your "${roleTarget}" goal (${rolePrio} priority)`);
  else if (roleBest >= 0.6) reasons.push(`Closely related to your "${roleTarget}" goal`);

  // ── 2. Skills (30%) — with transferability ────────────────────────

  const { direct, transferable, related, missing, skillFrac } = matchSkills(
    job.skills || [],
    effectiveSkills,
  );

  const { required, preferred } = buildRequirementVerdicts(
    job,
    prof,
    skillEvidence,
    { direct, transferable, related },
    roleProfile,
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

  // Candidate preference, not a profession-wide rule: some users want
  // entry-level/internship postings, some have outgrown them.
  if (
    prof.excludeEntryLevel &&
    (job.experienceLevel === 'ENTRY' || job.experienceLevel === 'INTERN')
  ) {
    ineligibleReasons.push('Entry-level role — you hide entry-level jobs');
  }

  // Relevance gate: without evidence that the job relates to one of the
  // candidate's target roles or core skills, generic bonuses (location,
  // experience, freshness, neutral salary) must not add up to a high
  // recommendation score. A single incidental tag is not enough evidence:
  // boards often tag jobs with an industry ("Medical Devices") that has
  // nothing to do with the role, so require role alignment or at least two
  // skill signals.
  const skillSignals = direct.length + transferable.length + related.length;
  if (skillSignals < 2 && roleBest < 0.5) {
    ineligibleReasons.push('No role or skill alignment with your target roles');
  }

  // Expired or withdrawn postings are never recommendations. Stale and
  // unverifiable ones stay eligible but carry a score penalty.
  const vacancy = evaluateVacancy(job);
  ineligibleReasons.push(...vacancy.blocked);
  if (vacancy.reasons.length) reasons.push(...vacancy.reasons);

  const eligible = ineligibleReasons.length === 0;
  if (!eligible) {
    reasons.push(...ineligibleReasons);
  }

  // ── 3. Experience (15%) ───────────────────────────────────────────
  // Unknown experience data is neutral (0.5), never full credit. Entry-level
  // postings genuinely require no prior experience, so they stay MET.
  const requirementYears = EXP_YEARS[job.experienceLevel];
  const reqYears = requirementYears ?? 0;
  let expFrac: number;
  let expStatus: RequirementStatus;
  let expEvidence: string;
  if (job.experienceLevel === 'ENTRY' || job.experienceLevel === 'INTERN') {
    expFrac = 1;
    expStatus = 'MET';
    expEvidence = 'Entry-level role — no prior experience required';
    if (verifiedYears !== null) reasons.push(`Experience fits (${verifiedYears} yrs vs ${reqYears}+ required)`);
  } else if (requirementYears === undefined) {
    expFrac = 0.5;
    expStatus = 'UNKNOWN';
    expEvidence = `Experience level "${job.experienceLevel || 'unspecified'}" is not specific enough to judge`;
  } else if (verifiedYears === null) {
    expFrac = 0.5;
    expStatus = 'UNKNOWN';
    expEvidence = 'Your profile has no verified experience yet';
  } else if (verifiedYears >= requirementYears) {
    expFrac = 1;
    expStatus = 'MET';
    expEvidence = `You have ${verifiedYears} yrs vs ${requirementYears}+ required`;
    reasons.push(`Experience fits (${verifiedYears} yrs vs ${requirementYears}+ required)`);
  } else {
    expFrac = clamp(Math.max(0.3, verifiedYears / requirementYears), 0, 1);
    expStatus = 'MISSING';
    expEvidence = `You have ${verifiedYears} of ${requirementYears}+ required years`;
    if (requirementYears - verifiedYears >= 2) {
      reasons.push(`Requires ${requirementYears}+ yrs — you have ${verifiedYears}`);
    }
  }
  required.push({
    name:
      job.experienceLevel === 'ENTRY' || job.experienceLevel === 'INTERN'
        ? 'Experience (entry level)'
        : `Experience (${requirementYears ?? job.experienceLevel}+ years)`,
    kind: 'EXPERIENCE',
    importance: 'REQUIRED',
    status: expStatus,
    evidence: expEvidence,
  });

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
  const freshEvidence =
    hours <= 12
      ? `Posted ${Math.round(hours)}h ago`
      : `Posted ${Math.round(hours)}h ago — freshness decays with a 72h half-life`;

  // ── 7. Salary (5%) ─────────────────────────────────────────────────
  let salFrac = 0.55;
  let salEvidence = 'No salary stated — neutral, not treated as a match';
  if (job.salary) {
    salFrac = job.salary >= prof.minSalary ? 1 : Math.max(0.2, job.salary / Math.max(1, prof.minSalary));
    salEvidence =
      job.salary >= prof.minSalary
        ? `Salary ${job.salary} meets your minimum ${prof.minSalary}`
        : `Salary ${job.salary} is below your minimum ${prof.minSalary}`;
  }

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
  pts -= vacancy.penalty;
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
    {
      label: 'Role',
      weight: 25,
      fraction: roleBest,
      evidence: roleBest > 0
        ? `"${job.title}" aligns with "${roleTarget}" at ${Math.round(roleBest * 100)}%`
        : 'No alignment with your target roles',
    },
    {
      label: 'Skills',
      weight: 30,
      fraction: skillFrac,
      evidence: job.skills?.length
        ? `${direct.length} required skill(s) met, ${transferable.length} transferable, ${missing.length} missing`
        : 'No structured skills on the posting — unknown, neutral score',
    },
    { label: 'Experience', weight: 15, fraction: expFrac, evidence: expEvidence },
    { label: 'Location', weight: 15, fraction: locFrac, evidence: locWhy },
    {
      label: 'Employment',
      weight: 5,
      fraction: empFrac,
      evidence: prof.employmentTypes.includes(job.employmentType)
        ? `${job.employmentType} is one of your accepted types`
        : `${job.employmentType} is not in your accepted types`,
    },
    { label: 'Freshness', weight: 5, fraction: freshFrac, evidence: freshEvidence },
    { label: 'Salary', weight: 5, fraction: salFrac, evidence: salEvidence },
  ];

  const missingRequirements = required
    .filter((requirement) => requirement.status === 'MISSING')
    .map((requirement) => requirement.name);
  const unknownRequirements = required
    .filter((requirement) => requirement.status === 'UNKNOWN')
    .map((requirement) => requirement.name);

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
    if (missingRequirements.length) bits.push(`${missingRequirements.length} requirement(s) missing`);
    if (job.locationClass.includes('REMOTE')) bits.push('remote');
    else if (job.locationClass === 'ETHIOPIA_LOCAL') bits.push('local (Ethiopia)');
    if (job.experienceLevel === 'ENTRY') bits.push('junior level');
    if (vacancy.risk !== 'OK') bits.push(vacancy.risk.toLowerCase().replace('unverified', 'unverifiable'));
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
    eligibility: {
      status: eligible ? 'ELIGIBLE' : 'REJECTED',
      reasons: ineligibleReasons,
    },
    requiredRequirements: required,
    preferredRequirements: preferred,
    missingRequirements,
    unknownRequirements,
    vacancy: { risk: vacancy.risk, reasons: vacancy.reasons },
    evidence: parts.map((part) => `${part.label}: ${part.evidence}`),
  };
}

export class MatchingEngine {
  scoreJob(job: JobInput, prof: ProfileInput): MatchResult {
    return scoreJob(job, prof);
  }
}
