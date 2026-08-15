/* Matching engine — ported from the SRS prototype (FR-018/019/019a/019b/020).
 * Deterministic, rule-based, explainable. Each JobMatch stores the breakdown. */

export const SKILL_DICT = [
  'Node.js', 'TypeScript', 'JavaScript', 'PostgreSQL', 'MySQL', 'MongoDB', 'SQL',
  'NestJS', 'Express', 'Fastify', 'React', 'Next.js', 'Redux', 'Vue', 'HTML', 'CSS',
  'Git', 'Docker', 'Kubernetes', 'CI/CD', 'Linux', 'AWS', 'Azure', 'GraphQL', 'REST API',
  'Python', 'Django', 'Flask', 'Java', 'Spring', 'PHP', 'WordPress', 'Redis', 'Spark',
  'Airflow', 'ETL', 'Networking', 'IT Support', 'Systems Administration', 'Microservices',
  'Testing', 'QA',
];

export const SKILL_ALIAS: Record<string, string> = {
  node: 'Node.js', nodejs: 'Node.js', 'node.js': 'Node.js', ts: 'TypeScript', js: 'JavaScript',
  postgres: 'PostgreSQL', pg: 'PostgreSQL', reactjs: 'React', nextjs: 'Next.js',
  rest: 'REST API', 'rest apis': 'REST API', k8s: 'Kubernetes',
};

export const SKILL_GRAPH: Record<string, string[]> = {
  JavaScript: ['TypeScript', 'Node.js', 'React', 'HTML', 'CSS'],
  'Node.js': ['Express', 'NestJS', 'Fastify', 'GraphQL'],
  PostgreSQL: ['SQL', 'MySQL'],
  React: ['Next.js', 'Redux', 'Vue'],
  Python: ['Django', 'Flask'],
  Docker: ['Kubernetes', 'CI/CD'],
  Git: ['CI/CD'],
};

export const EXP_YEARS: Record<string, number> = {
  INTERN: 0, ENTRY: 1, MID: 3, SENIOR: 5, LEAD: 7,
};

export function normalizeSkill(raw: string): string {
  const t = String(raw).trim();
  const low = t.toLowerCase();
  if (SKILL_ALIAS[low]) return SKILL_ALIAS[low];
  const hit = SKILL_DICT.find((s) => s.toLowerCase() === low);
  return hit || t;
}

export function areSkillsRelated(a: string, b: string): boolean {
  if (a === b) return false;
  return (SKILL_GRAPH[a] || []).includes(b) || (SKILL_GRAPH[b] || []).includes(a);
}

export function roleSimilarity(jobTitle: string, targetRole: string): number {
  const t = jobTitle.toLowerCase();
  const tr = targetRole.toLowerCase();
  if (t.includes(tr)) return 1;
  const syn: Record<string, string[]> = {
    'backend developer': ['backend', 'back-end', 'api', 'node', 'server'],
    'full stack developer': ['full stack', 'fullstack', 'full-stack', 'software engineer', 'web developer'],
    'frontend developer': ['frontend', 'front-end', 'ui developer', 'react', 'web developer'],
    'data engineer': ['data engineer', 'etl', 'analytics engineer'],
    'devops engineer': ['devops', 'sre', 'platform engineer', 'cloud'],
  };
  const words = syn[tr] || [tr];
  let s = 0;
  for (const w of words) if (t.includes(w)) s = Math.max(s, 0.75);
  if (s < 0.75 && t.includes('engineer') && (tr.includes('developer') || tr.includes('engineer'))) {
    s = Math.max(s, 0.45);
  }
  return s;
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
  relatedSkills: string[];
  missingSkills: string[];
  reasons: string[];
  summary: string;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function scoreJob(job: JobInput, prof: ProfileInput): MatchResult {
  const reasons: string[] = [];
  let roleBest = 0;
  let roleTarget: string | null = null;
  let rolePrio = '';

  for (const tr of prof.targetRoles) {
    const w = tr.priority === 'HIGH' ? 1 : tr.priority === 'MEDIUM' ? 0.72 : 0.45;
    const s = roleSimilarity(job.title, tr.role) * w;
    if (s > roleBest) {
      roleBest = s;
      roleTarget = tr.role;
      rolePrio = tr.priority;
    }
  }
  if (roleBest >= 0.9) reasons.push(`Matches your "${roleTarget}" goal (${rolePrio} priority)`);
  else if (roleBest >= 0.6) reasons.push(`Closely related to your "${roleTarget}" goal`);

  const uNorm = [...new Set(prof.skills.map(normalizeSkill))];
  const jNorm = [...new Set((job.skills || []).map(normalizeSkill))];
  const direct: string[] = [];
  const related: string[] = [];
  const missing: string[] = [];
  for (const js of jNorm) {
    if (uNorm.includes(js)) direct.push(js);
    else if (uNorm.some((us) => areSkillsRelated(us, js))) related.push(js);
    else missing.push(js);
  }
  const skillFrac = jNorm.length ? clamp((direct.length + related.length * 0.5) / jNorm.length, 0, 1) : 0.5;
  if (direct.length) reasons.push(`${direct.length} of ${jNorm.length} required skills matched directly`);
  if (related.length) reasons.push(`Related via skill graph: ${related.join(', ')}`);
  if (missing.length) reasons.push(`Missing: ${missing.join(', ')}`);

  const reqYears = EXP_YEARS[job.experienceLevel] ?? 2;
  const expFrac = reqYears === 0 ? 1 : clamp(Math.max(0.15, prof.years / reqYears), 0, 1);
  if (prof.years >= reqYears) reasons.push(`Experience fits (${prof.years} yrs vs ${reqYears}+ required)`);
  else if (reqYears - prof.years >= 2) reasons.push(`Requires ${reqYears}+ yrs — you have ${prof.years}`);

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

  const empFrac = prof.employmentTypes.includes(job.employmentType) ? 1 : 0.35;

  const hours = (Date.now() - new Date(job.postedAt).getTime()) / 3_600_000;
  const freshFrac = Math.max(0.05, Math.exp(-hours / 72));
  if (hours <= 12) reasons.push(`Very fresh — posted ${Math.round(hours)}h ago`);

  let salFrac = 0.55;
  if (job.salary) salFrac = job.salary >= prof.minSalary ? 1 : Math.max(0.2, job.salary / Math.max(1, prof.minSalary));

  let pts =
    25 * roleBest +
    30 * skillFrac +
    15 * expFrac +
    15 * locFrac +
    5 * empFrac +
    5 * freshFrac +
    5 * salFrac;

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
  const parts: ScoreBreakdown[] = [
    { label: 'Role', weight: 25, fraction: roleBest },
    { label: 'Skills', weight: 30, fraction: skillFrac },
    { label: 'Experience', weight: 15, fraction: expFrac },
    { label: 'Location', weight: 15, fraction: locFrac },
    { label: 'Employment', weight: 5, fraction: empFrac },
    { label: 'Freshness', weight: 5, fraction: freshFrac },
    { label: 'Salary', weight: 5, fraction: salFrac },
  ];

  const bits: string[] = [];
  if (roleTarget) bits.push(`matches your ${roleTarget} goal`);
  if (jNorm.length) bits.push(`${direct.length} of ${jNorm.length} core skills`);
  if (job.locationClass.includes('REMOTE')) bits.push('remote');
  else if (job.locationClass === 'ETHIOPIA_LOCAL') bits.push('local (Ethiopia)');
  if (job.experienceLevel === 'ENTRY') bits.push('junior level');
  const summary = 'Matches your profile — ' + bits.join(', ') + '.';

  return {
    score,
    roleTarget,
    parts,
    matchedSkills: direct,
    relatedSkills: related,
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
