import benchmarksData from './salary-benchmarks.data.json';

/**
 * Salary benchmarks for the Ethiopian tech market (ETB/month and USD/month).
 * Sources: local job boards, freelancer surveys, NGO pay scales (2024-2026).
 * Used by the matching engine and displayed on job detail pages.
 */

export interface SalaryRange {
  min: number;
  median: number;
  max: number;
  currency: 'ETB' | 'USD';
}

export interface RoleBenchmark {
  role: string;
  level: string;
  etb: SalaryRange;
  usd: SalaryRange;
  notes?: string;
}

/**
 * Static FX conversion: 1 USD ≈ 57 ETB (approximate, update periodically).
 * For production, fetch from an FX API.
 */
export const USD_TO_ETB = Number(process.env.USD_TO_ETB_RATE ?? 57);

/**
 * Benchmark data — keyed by normalized role + level string.
 * Levels: ENTRY, MID, SENIOR, LEAD
 */
export const BENCHMARKS: RoleBenchmark[] = benchmarksData as RoleBenchmark[];


/**
 * Level aliases → canonical level.
 */
const LEVEL_MAP: Record<string, string> = {
  INTERN: 'ENTRY',
  ENTRY: 'ENTRY',
  JUNIOR: 'ENTRY',
  MID: 'MID',
  MIDDLE: 'MID',
  MIDLEVEL: 'MID',
  SENIOR: 'SENIOR',
  SR: 'SENIOR',
  LEAD: 'LEAD',
  PRINCIPAL: 'LEAD',
  STAFF: 'LEAD',
};

/**
 * Role aliases → canonical role prefix for benchmark lookup.
 */
const ROLE_MAP: Record<string, string> = {
  'backend developer': 'Backend Developer',
  'back-end developer': 'Backend Developer',
  'frontend developer': 'Frontend Developer',
  'front-end developer': 'Frontend Developer',
  'full stack developer': 'Full Stack Developer',
  'fullstack developer': 'Full Stack Developer',
  'full-stack developer': 'Full Stack Developer',
  'software engineer': 'Software Engineer',
  'software developer': 'Software Engineer',
  'developer': 'Software Engineer',
  'devops engineer': 'DevOps Engineer',
  'sre': 'DevOps Engineer',
  'site reliability engineer': 'DevOps Engineer',
  'platform engineer': 'DevOps Engineer',
  'data analyst': 'Data Analyst',
  'data engineer': 'Data Engineer',
  'data scientist': 'Machine Learning Engineer',
  'ml engineer': 'Machine Learning Engineer',
  'machine learning engineer': 'Machine Learning Engineer',
  'ai engineer': 'Machine Learning Engineer',
  'mobile developer': 'Mobile Developer',
  'ios developer': 'Mobile Developer',
  'android developer': 'Mobile Developer',
  'react native developer': 'Mobile Developer',
  'qa engineer': 'QA Engineer',
  'quality assurance': 'QA Engineer',
  'test engineer': 'QA Engineer',
  'project manager': 'Project Manager',
  'product manager': 'Product Manager',
  'ui designer': 'UI Designer',
  'ux designer': 'UI Designer',
  'product designer': 'UI Designer',
  'it support': 'IT Support',
  'systems administrator': 'Systems Administrator',
  'network administrator': 'Systems Administrator',
};

export interface BenchmarkResult {
  role: string;
  level: string;
  benchmark: RoleBenchmark | null;
  jobSalaryPercentile: number | null; // where the job falls in the benchmark range
  comparison: string | null; // human-readable comparison
}

/**
 * Look up salary benchmark for a given job title and experience level.
 */
export function lookupBenchmark(
  jobTitle: string,
  experienceLevel: string,
): BenchmarkResult {
  const titleLower = jobTitle.toLowerCase().trim();
  const level = LEVEL_MAP[experienceLevel.toUpperCase()] || experienceLevel;

  // Find best matching role
  let matchedRole: string | null = null;
  for (const [alias, canonical] of Object.entries(ROLE_MAP)) {
    if (titleLower.includes(alias)) {
      matchedRole = canonical;
      break;
    }
  }

  if (!matchedRole) {
    return { role: jobTitle, level, benchmark: null, jobSalaryPercentile: null, comparison: null };
  }

  const benchmark = BENCHMARKS.find(
    (b) => b.role === matchedRole && b.level === level,
  ) || BENCHMARKS.find(
    (b) => b.role === matchedRole,
  );

  if (!benchmark) {
    return { role: matchedRole, level, benchmark: null, jobSalaryPercentile: null, comparison: null };
  }

  return {
    role: matchedRole,
    level,
    benchmark,
    jobSalaryPercentile: null,
    comparison: null,
  };
}

/**
 * Compare a job's salary against the benchmark and return a percentile + comparison string.
 */
export function compareSalary(
  jobSalary: number | null,
  jobCurrency: string,
  jobTitle: string,
  experienceLevel: string,
): BenchmarkResult & { percentAbove?: number } {
  const result = lookupBenchmark(jobTitle, experienceLevel);

  if (!result.benchmark || jobSalary == null) {
    return result;
  }

  const bench = result.benchmark;
  const ref = jobCurrency === 'ETB' ? bench.etb : bench.usd;
  const range = ref.max - ref.min;

  // Percentile: 0 = at min, 100 = at max
  const pct = range > 0 ? Math.round(((jobSalary - ref.min) / range) * 100) : 50;
  const clampedPct = Math.max(0, Math.min(100, pct));

  let comparison: string;
  if (clampedPct >= 80) {
    comparison = `Above market — top ${100 - clampedPct}% for ${bench.role} ${bench.level} in Ethiopia`;
  } else if (clampedPct >= 50) {
    comparison = `At market rate — median is ${ref.currency} ${ref.median.toLocaleString()}`;
  } else if (clampedPct >= 20) {
    comparison = `Below median — market range is ${ref.currency} ${ref.min.toLocaleString()} – ${ref.max.toLocaleString()}`;
  } else {
    comparison = `Well below market — typical range is ${ref.currency} ${ref.min.toLocaleString()} – ${ref.max.toLocaleString()}`;
  }

  const percentAbove = ref.median > 0
    ? Math.round(((jobSalary - ref.median) / ref.median) * 100)
    : undefined;

  return {
    ...result,
    jobSalaryPercentile: clampedPct,
    comparison,
    percentAbove,
  };
}
