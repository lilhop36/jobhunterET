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
export const USD_TO_ETB = 57;

/**
 * Benchmark data — keyed by normalized role + level string.
 * Levels: ENTRY, MID, SENIOR, LEAD
 */
export const BENCHMARKS: RoleBenchmark[] = [
  // ── Software Engineering ──────────────────────────────
  {
    role: 'Frontend Developer',
    level: 'ENTRY',
    etb: { min: 15_000, median: 25_000, max: 40_000, currency: 'ETB' },
    usd: { min: 400, median: 700, max: 1200, currency: 'USD' },
    notes: 'React/Next.js skills command premium',
  },
  {
    role: 'Frontend Developer',
    level: 'MID',
    etb: { min: 30_000, median: 50_000, max: 80_000, currency: 'ETB' },
    usd: { min: 800, median: 1500, max: 2500, currency: 'USD' },
  },
  {
    role: 'Frontend Developer',
    level: 'SENIOR',
    etb: { min: 60_000, median: 90_000, max: 140_000, currency: 'ETB' },
    usd: { min: 1500, median: 2500, max: 4000, currency: 'USD' },
  },
  {
    role: 'Backend Developer',
    level: 'ENTRY',
    etb: { min: 18_000, median: 28_000, max: 45_000, currency: 'ETB' },
    usd: { min: 500, median: 800, max: 1300, currency: 'USD' },
    notes: 'Node.js/NestJS most in-demand',
  },
  {
    role: 'Backend Developer',
    level: 'MID',
    etb: { min: 35_000, median: 55_000, max: 90_000, currency: 'ETB' },
    usd: { min: 900, median: 1600, max: 2800, currency: 'USD' },
  },
  {
    role: 'Backend Developer',
    level: 'SENIOR',
    etb: { min: 70_000, median: 100_000, max: 160_000, currency: 'ETB' },
    usd: { min: 1800, median: 3000, max: 5000, currency: 'USD' },
  },
  {
    role: 'Full Stack Developer',
    level: 'ENTRY',
    etb: { min: 15_000, median: 25_000, max: 40_000, currency: 'ETB' },
    usd: { min: 400, median: 700, max: 1200, currency: 'USD' },
  },
  {
    role: 'Full Stack Developer',
    level: 'MID',
    etb: { min: 35_000, median: 55_000, max: 85_000, currency: 'ETB' },
    usd: { min: 900, median: 1600, max: 2500, currency: 'USD' },
  },
  {
    role: 'Full Stack Developer',
    level: 'SENIOR',
    etb: { min: 65_000, median: 95_000, max: 150_000, currency: 'ETB' },
    usd: { min: 1700, median: 2800, max: 4500, currency: 'USD' },
  },
  {
    role: 'Software Engineer',
    level: 'ENTRY',
    etb: { min: 15_000, median: 25_000, max: 40_000, currency: 'ETB' },
    usd: { min: 400, median: 700, max: 1200, currency: 'USD' },
  },
  {
    role: 'Software Engineer',
    level: 'MID',
    etb: { min: 35_000, median: 55_000, max: 90_000, currency: 'ETB' },
    usd: { min: 900, median: 1600, max: 2800, currency: 'USD' },
  },
  {
    role: 'Software Engineer',
    level: 'SENIOR',
    etb: { min: 70_000, median: 100_000, max: 160_000, currency: 'ETB' },
    usd: { min: 1800, median: 3000, max: 5000, currency: 'USD' },
  },
  {
    role: 'Software Engineer',
    level: 'LEAD',
    etb: { min: 90_000, median: 130_000, max: 200_000, currency: 'ETB' },
    usd: { min: 2500, median: 4000, max: 6500, currency: 'USD' },
  },
  // ── DevOps / Infra ────────────────────────────────────
  {
    role: 'DevOps Engineer',
    level: 'MID',
    etb: { min: 35_000, median: 60_000, max: 95_000, currency: 'ETB' },
    usd: { min: 1000, median: 1800, max: 3000, currency: 'USD' },
    notes: 'AWS/Docker/K8s highly valued',
  },
  {
    role: 'DevOps Engineer',
    level: 'SENIOR',
    etb: { min: 70_000, median: 110_000, max: 170_000, currency: 'ETB' },
    usd: { min: 2000, median: 3200, max: 5000, currency: 'USD' },
  },
  // ── Data / ML ─────────────────────────────────────────
  {
    role: 'Data Analyst',
    level: 'ENTRY',
    etb: { min: 12_000, median: 20_000, max: 35_000, currency: 'ETB' },
    usd: { min: 350, median: 600, max: 1000, currency: 'USD' },
  },
  {
    role: 'Data Analyst',
    level: 'MID',
    etb: { min: 25_000, median: 40_000, max: 65_000, currency: 'ETB' },
    usd: { min: 700, median: 1200, max: 2000, currency: 'USD' },
  },
  {
    role: 'Data Engineer',
    level: 'MID',
    etb: { min: 35_000, median: 55_000, max: 85_000, currency: 'ETB' },
    usd: { min: 900, median: 1600, max: 2500, currency: 'USD' },
  },
  {
    role: 'Machine Learning Engineer',
    level: 'MID',
    etb: { min: 40_000, median: 65_000, max: 100_000, currency: 'ETB' },
    usd: { min: 1100, median: 2000, max: 3200, currency: 'USD' },
    notes: 'Rare skill premium in Ethiopia',
  },
  // ── Mobile ────────────────────────────────────────────
  {
    role: 'Mobile Developer',
    level: 'ENTRY',
    etb: { min: 15_000, median: 25_000, max: 40_000, currency: 'ETB' },
    usd: { min: 400, median: 700, max: 1200, currency: 'USD' },
  },
  {
    role: 'Mobile Developer',
    level: 'MID',
    etb: { min: 30_000, median: 50_000, max: 80_000, currency: 'ETB' },
    usd: { min: 800, median: 1500, max: 2500, currency: 'USD' },
  },
  // ── QA ────────────────────────────────────────────────
  {
    role: 'QA Engineer',
    level: 'ENTRY',
    etb: { min: 12_000, median: 20_000, max: 35_000, currency: 'ETB' },
    usd: { min: 350, median: 600, max: 1000, currency: 'USD' },
  },
  {
    role: 'QA Engineer',
    level: 'MID',
    etb: { min: 25_000, median: 40_000, max: 65_000, currency: 'ETB' },
    usd: { min: 700, median: 1200, max: 2000, currency: 'USD' },
  },
  // ── PM / Design ───────────────────────────────────────
  {
    role: 'Project Manager',
    level: 'MID',
    etb: { min: 30_000, median: 50_000, max: 80_000, currency: 'ETB' },
    usd: { min: 800, median: 1500, max: 2500, currency: 'USD' },
  },
  {
    role: 'Product Manager',
    level: 'MID',
    etb: { min: 35_000, median: 60_000, max: 100_000, currency: 'ETB' },
    usd: { min: 1000, median: 1800, max: 3000, currency: 'USD' },
  },
  {
    role: 'UI Designer',
    level: 'MID',
    etb: { min: 20_000, median: 35_000, max: 55_000, currency: 'ETB' },
    usd: { min: 600, median: 1000, max: 1700, currency: 'USD' },
  },
  // ── IT / Support ──────────────────────────────────────
  {
    role: 'IT Support',
    level: 'ENTRY',
    etb: { min: 8_000, median: 15_000, max: 25_000, currency: 'ETB' },
    usd: { min: 250, median: 450, max: 700, currency: 'USD' },
  },
  {
    role: 'Systems Administrator',
    level: 'MID',
    etb: { min: 25_000, median: 40_000, max: 65_000, currency: 'ETB' },
    usd: { min: 700, median: 1200, max: 2000, currency: 'USD' },
  },
];

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
