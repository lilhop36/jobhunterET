/* Matching engine — ported from the SRS prototype (FR-018/019/019a/019b/020).
 * Deterministic, rule-based, explainable. Each JobMatch stores the breakdown. */

export const SKILL_DICT = [
  // ── Core Web ──────────────────────────────────────────
  'Node.js', 'TypeScript', 'JavaScript', 'HTML', 'CSS', 'React', 'Next.js',
  'Vue', 'Nuxt.js', 'Angular', 'Svelte', 'Redux', 'Tailwind CSS', 'SASS',
  'REST API', 'GraphQL', 'WebSocket', 'gRPC',
  // ── Backend Frameworks ─────────────────────────────────
  'NestJS', 'Express', 'Fastify', 'AdonisJS', 'Koa',
  'Django', 'Flask', 'FastAPI', 'Rails', 'Laravel', 'Spring Boot',
  // ── Languages ──────────────────────────────────────────
  'Python', 'Java', 'C#', 'Go', 'Rust', 'PHP', 'Ruby', 'Swift', 'Kotlin',
  // ── Databases ──────────────────────────────────────────
  'PostgreSQL', 'MySQL', 'MongoDB', 'SQL', 'Redis', 'SQLite',
  'Elasticsearch', 'DynamoDB', 'Cassandra', 'Neo4j', 'Prisma', 'Sequelize',
  // ── DevOps / Cloud ─────────────────────────────────────
  'Docker', 'Kubernetes', 'CI/CD', 'Linux', 'AWS', 'Azure', 'GCP',
  'Terraform', 'Ansible', 'Nginx', 'Apache', 'Jenkins', 'GitHub Actions',
  'Vercel', 'Netlify', 'Cloudflare',
  // ── Data / ML / AI ─────────────────────────────────────
  'Pandas', 'NumPy', 'TensorFlow', 'PyTorch', 'Scikit-learn',
  'Apache Spark', 'Airflow', 'ETL', 'Data Analysis', 'Machine Learning',
  'NLP', 'Computer Vision', 'LLM', 'OpenAI API',
  // ── Mobile ─────────────────────────────────────────────
  'React Native', 'Flutter', 'iOS', 'Android', 'Expo',
  // ── Testing ────────────────────────────────────────────
  'Jest', 'Playwright', 'Cypress', 'Selenium', 'Testing', 'QA', 'TDD',
  // ── Design / UX ────────────────────────────────────────
  'Figma', 'Adobe XD', 'UI Design', 'UX Research', 'Accessibility',
  // ── PM / Business ──────────────────────────────────────
  'Agile', 'Scrum', 'Jira', 'Confluence', 'Project Management',
  // ── IT / Infra ─────────────────────────────────────────
  'Networking', 'IT Support', 'Systems Administration', 'Microservices',
  'WordPress', 'Shopify', 'SEO', 'Digital Marketing',
];

export const SKILL_ALIAS: Record<string, string> = {
  // ── JS ecosystem ───────────────────────────────────────
  node: 'Node.js', nodejs: 'Node.js', 'node.js': 'Node.js',
  ts: 'TypeScript', typescript: 'TypeScript',
  js: 'JavaScript', javascript: 'JavaScript',
  reactjs: 'React',
  nextjs: 'Next.js', 'next.js': 'Next.js',
  vuejs: 'Vue', 'vue.js': 'Vue',
  'vue 3': 'Vue',
  nuxtjs: 'Nuxt.js', 'nuxt.js': 'Nuxt.js',
  angularjs: 'Angular', 'angular.js': 'Angular',
  tailwind: 'Tailwind CSS', 'tailwindcss': 'Tailwind CSS',
  reduxjs: 'Redux',
  // ── Python ecosystem ───────────────────────────────────
  'python3': 'Python', 'python 3': 'Python',
  django: 'Django', 'django rest framework': 'Django',
  flask: 'Flask', fastapi: 'FastAPI',
  pandas: 'Pandas', numpy: 'NumPy',
  tensorflow: 'TensorFlow', pytorch: 'PyTorch',
  'scikit learn': 'Scikit-learn', sklearn: 'Scikit-learn',
  // ── Java ecosystem ─────────────────────────────────────
  java: 'Java', spring: 'Spring Boot', 'spring boot': 'Spring Boot',
  'spring boot 3': 'Spring Boot',
  // ── PHP ecosystem ──────────────────────────────────────
  php: 'PHP', laravel: 'Laravel', wordpress: 'WordPress',
  // ── Ruby ───────────────────────────────────────────────
  ruby: 'Ruby', rails: 'Rails', 'ruby on rails': 'Rails',
  // ── Databases ──────────────────────────────────────────
  postgres: 'PostgreSQL', postgresql: 'PostgreSQL', pg: 'PostgreSQL',
  psql: 'PostgreSQL',
  mysql: 'MySQL', mongo: 'MongoDB', mongodb: 'MongoDB',
  redis: 'Redis', sqlite: 'SQLite',
  elasticsearch: 'Elasticsearch', elastic: 'Elasticsearch',
  prisma: 'Prisma', sequelize: 'Sequelize',
  // ── DevOps / Cloud ─────────────────────────────────────
  docker: 'Docker', k8s: 'Kubernetes', kubernetes: 'Kubernetes',
  cicd: 'CI/CD', 'ci/cd': 'CI/CD',
  linux: 'Linux', ubuntu: 'Linux',
  aws: 'AWS', 'amazon web services': 'AWS',
  azure: 'Azure', gcp: 'GCP', 'google cloud': 'GCP',
  terraform: 'Terraform', ansible: 'Ansible',
  nginx: 'Nginx', apache: 'Apache',
  jenkins: 'Jenkins', 'github actions': 'GitHub Actions',
  vercel: 'Vercel', netlify: 'Netlify',
  // ── APIs / Protocols ───────────────────────────────────
  rest: 'REST API', 'rest apis': 'REST API', 'restful': 'REST API',
  'rest api': 'REST API',
  graphql: 'GraphQL', gql: 'GraphQL',
  websocket: 'WebSocket',
  grpc: 'gRPC',
  // ── Mobile ─────────────────────────────────────────────
  'react native': 'React Native', rn: 'React Native',
  flutter: 'Flutter', expo: 'Expo',
  ios: 'iOS', android: 'Android',
  // ── Testing ────────────────────────────────────────────
  jest: 'Jest', playwright: 'Playwright',
  cypress: 'Cypress', selenium: 'Selenium',
  tdd: 'TDD', 'test driven': 'TDD',
  // ── Design ─────────────────────────────────────────────
  figma: 'Figma', 'adobe xd': 'Adobe XD',
  'ui design': 'UI Design', ux: 'UX Research',
  // ── PM / Business ──────────────────────────────────────
  scrum: 'Scrum', agile: 'Agile', jira: 'Jira',
  // ── Other ──────────────────────────────────────────────
  'machine learning': 'Machine Learning', ml: 'Machine Learning',
  'data analysis': 'Data Analysis', nlp: 'NLP',
  seo: 'SEO', 'digital marketing': 'Digital Marketing',
  shopify: 'Shopify',
};

export const SKILL_GRAPH: Record<string, string[]> = {
  // ── JS / TS ecosystem ──────────────────────────────────
  JavaScript: ['TypeScript', 'Node.js', 'React', 'Vue', 'Angular', 'HTML', 'CSS'],
  TypeScript: ['JavaScript', 'Node.js', 'React', 'Next.js', 'NestJS', 'Angular'],
  'Node.js': ['Express', 'NestJS', 'Fastify', 'GraphQL', 'TypeScript', 'JavaScript'],
  React: ['Next.js', 'Redux', 'React Native', 'TypeScript', 'Tailwind CSS'],
  'Next.js': ['React', 'TypeScript', 'Tailwind CSS', 'Vercel'],
  Vue: ['Nuxt.js', 'TypeScript', 'JavaScript'],
  Angular: ['TypeScript', 'JavaScript'],
  'Tailwind CSS': ['CSS', 'HTML', 'React', 'Next.js'],
  // ── Python ecosystem ───────────────────────────────────
  Python: ['Django', 'Flask', 'FastAPI', 'Pandas', 'NumPy', 'SQL'],
  Django: ['Python', 'PostgreSQL', 'REST API', 'Docker'],
  Flask: ['Python', 'REST API', 'Docker'],
  FastAPI: ['Python', 'REST API', 'Docker', 'GraphQL'],
  Pandas: ['Python', 'NumPy', 'Data Analysis', 'SQL'],
  'Machine Learning': ['Python', 'TensorFlow', 'PyTorch', 'Scikit-learn', 'NumPy', 'Pandas'],
  TensorFlow: ['Python', 'Machine Learning', 'NumPy'],
  PyTorch: ['Python', 'Machine Learning', 'NumPy'],
  'Scikit-learn': ['Python', 'Machine Learning', 'Pandas', 'NumPy'],
  'Data Analysis': ['Python', 'SQL', 'Pandas', 'Excel'],
  // ── Java ecosystem ─────────────────────────────────────
  Java: ['Spring Boot', 'Maven', 'Gradle', 'SQL', 'Docker'],
  'Spring Boot': ['Java', 'SQL', 'Docker', 'REST API', 'Microservices'],
  // ── PHP ecosystem ──────────────────────────────────────
  PHP: ['Laravel', 'WordPress', 'MySQL', 'HTML', 'CSS'],
  Laravel: ['PHP', 'MySQL', 'REST API', 'Docker'],
  WordPress: ['PHP', 'MySQL', 'HTML', 'CSS', 'SEO'],
  // ── Ruby ───────────────────────────────────────────────
  Ruby: ['Rails', 'PostgreSQL', 'REST API'],
  Rails: ['Ruby', 'PostgreSQL', 'REST API', 'Docker'],
  // ── Databases ──────────────────────────────────────────
  PostgreSQL: ['SQL', 'MySQL', 'Redis', 'Prisma', 'Docker'],
  MySQL: ['SQL', 'PostgreSQL', 'PHP', 'Docker'],
  MongoDB: ['JavaScript', 'Node.js', 'TypeScript'],
  Redis: ['Node.js', 'Docker', 'Microservices'],
  SQL: ['PostgreSQL', 'MySQL', 'Data Analysis'],
  Elasticsearch: ['Docker', 'Node.js', 'Python'],
  // ── DevOps / Cloud ─────────────────────────────────────
  Docker: ['Kubernetes', 'CI/CD', 'AWS', 'Azure', 'GCP', 'Linux'],
  Kubernetes: ['Docker', 'AWS', 'GCP', 'Terraform', 'Linux'],
  AWS: ['Docker', 'Kubernetes', 'Terraform', 'Linux', 'Python', 'Node.js'],
  Azure: ['Docker', 'Kubernetes', 'CI/CD', 'Terraform'],
  GCP: ['Docker', 'Kubernetes', 'Terraform', 'Python'],
  Terraform: ['AWS', 'Azure', 'GCP', 'Kubernetes', 'Linux'],
  Linux: ['Docker', 'Nginx', 'AWS', 'Bash', 'CI/CD'],
  'CI/CD': ['Docker', 'GitHub Actions', 'Jenkins', 'Git'],
  // ── API / Protocol ─────────────────────────────────────
  'REST API': ['GraphQL', 'Node.js', 'Express', 'NestJS', 'FastAPI'],
  GraphQL: ['REST API', 'Node.js', 'React', 'Apollo'],
  // ── Mobile ─────────────────────────────────────────────
  'React Native': ['React', 'TypeScript', 'JavaScript', 'Expo'],
  Flutter: ['Dart', 'Android', 'iOS'],
  // ── Testing ────────────────────────────────────────────
  Jest: ['Node.js', 'TypeScript', 'React', 'TDD'],
  Playwright: ['TypeScript', 'JavaScript', 'Testing', 'CI/CD'],
  Cypress: ['JavaScript', 'TypeScript', 'React', 'Testing'],
  // ── Design / UX ────────────────────────────────────────
  Figma: ['UI Design', 'UX Research', 'Tailwind CSS'],
  'UI Design': ['Figma', 'HTML', 'CSS', 'Accessibility'],
  // ── PM / Business ──────────────────────────────────────
  Agile: ['Scrum', 'Jira', 'Project Management'],
  Scrum: ['Agile', 'Jira', 'Project Management'],
  // ── IT / Infra ─────────────────────────────────────────
  Networking: ['Linux', 'AWS', 'Systems Administration'],
  'Systems Administration': ['Linux', 'Networking', 'Docker'],
  Microservices: ['Docker', 'Kubernetes', 'REST API', 'GraphQL', 'Node.js'],
  SEO: ['WordPress', 'Digital Marketing', 'HTML', 'Google Analytics'],
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

  // Bidirectional synonym map: each key maps to terms that should score highly
  const syn: Record<string, string[]> = {
    // ── Software Engineering ──────────────────────────────
    'backend developer': ['backend', 'back-end', 'back end', 'api', 'node', 'server-side', 'server side', 'server-side developer'],
    'back-end developer': ['backend', 'back-end', 'api', 'node', 'server'],
    'frontend developer': ['frontend', 'front-end', 'front end', 'ui developer', 'react', 'web developer', 'client-side', 'client side'],
    'front-end developer': ['frontend', 'front-end', 'ui developer', 'react', 'web developer'],
    'full stack developer': ['full stack', 'fullstack', 'full-stack', 'full stack developer', 'software engineer', 'web developer', 'software developer'],
    'full-stack developer': ['full stack', 'fullstack', 'full-stack', 'software engineer', 'web developer'],
    'software engineer': ['software engineer', 'software developer', 'developer', 'full stack', 'fullstack', 'full-stack', 'web developer', 'programmer', 'swe'],
    'software developer': ['software engineer', 'software developer', 'developer', 'full stack', 'programmer'],
    'web developer': ['web developer', 'frontend', 'frontend developer', 'full stack', 'full stack developer', 'react', 'node'],
    'mobile developer': ['mobile', 'mobile developer', 'ios developer', 'android developer', 'react native', 'flutter'],
    'ios developer': ['ios', 'ios developer', 'mobile', 'swift', 'react native'],
    'android developer': ['android', 'android developer', 'mobile', 'kotlin', 'flutter'],
    // ── Data / ML ─────────────────────────────────────────
    'data engineer': ['data engineer', 'etl', 'analytics engineer', 'data pipeline', 'data platform'],
    'data analyst': ['data analyst', 'analytics', 'data analysis', 'business intelligence', 'bi'],
    'data scientist': ['data scientist', 'machine learning', 'ml engineer', 'ai engineer'],
    'machine learning engineer': ['machine learning', 'ml engineer', 'ai engineer', 'data scientist'],
    'ml engineer': ['machine learning', 'ml', 'ai engineer', 'data scientist'],
    'ai engineer': ['ai', 'artificial intelligence', 'machine learning', 'ml engineer', 'llm'],
    // ── DevOps / Infra ────────────────────────────────────
    'devops engineer': ['devops', 'sre', 'platform engineer', 'cloud', 'infrastructure', 'infrastructure engineer', 'devsecops'],
    'site reliability engineer': ['sre', 'devops', 'platform engineer', 'infrastructure'],
    'platform engineer': ['platform', 'devops', 'sre', 'infrastructure', 'cloud'],
    'cloud engineer': ['cloud', 'aws', 'azure', 'gcp', 'devops', 'infrastructure'],
    'infrastructure engineer': ['infrastructure', 'devops', 'sre', 'platform', 'cloud'],
    'systems engineer': ['systems', 'infrastructure', 'linux', 'networking', 'devops'],
    // ── QA / Testing ──────────────────────────────────────
    'qa engineer': ['qa', 'quality assurance', 'testing', 'test engineer', 'sdet', 'quality engineer'],
    'quality assurance': ['qa', 'quality assurance', 'testing', 'test engineer'],
    'test engineer': ['qa', 'testing', 'sdet', 'quality assurance'],
    'sdet': ['qa', 'testing', 'automation engineer', 'test engineer', 'quality assurance'],
    // ── Design ────────────────────────────────────────────
    'ui designer': ['ui', 'ui designer', 'ui developer', 'frontend', 'web designer', 'visual designer'],
    'ux designer': ['ux', 'ux designer', 'user experience', 'product designer'],
    'product designer': ['product designer', 'ux designer', 'ui designer', 'ux/ui'],
    // ── PM / Business ─────────────────────────────────────
    'project manager': ['project manager', 'pm', 'program manager', 'delivery manager'],
    'product manager': ['product manager', 'pm', 'product owner', 'po'],
    'scrum master': ['scrum master', 'agile coach', 'delivery manager'],
    // ── Security ──────────────────────────────────────────
    'security engineer': ['security', 'infosec', 'cybersecurity', 'application security', 'appsec'],
    // ── Database ──────────────────────────────────────────
    'database administrator': ['dba', 'database', 'database engineer', 'data engineer'],
    'database engineer': ['dba', 'database', 'data engineer', 'database administrator'],
    // ── Generic ───────────────────────────────────────────
    developer: ['developer', 'engineer', 'programmer', 'coder'],
    engineer: ['engineer', 'developer', 'programmer'],
  };

  const words = syn[tr] || [tr];
  let s = 0;
  for (const w of words) if (t.includes(w)) s = Math.max(s, 0.75);

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
