import {
  normalizeSkill,
  areSkillsRelated,
  roleSimilarity,
  scoreJob,
  ProfileInput,
  JobInput,
} from './matching-engine';

const HOUR = 3_600_000;

function makeProfile(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    skills: ['Node.js', 'TypeScript', 'PostgreSQL'],
    targetRoles: [{ role: 'Backend Developer', priority: 'HIGH' }],
    locationTiers: { Ethiopia: 'HIGH', Remote: 'HIGH' },
    remote: true,
    employmentTypes: ['FULL_TIME'],
    years: 2,
    minSalary: 0,
    excludeOnsite: false,
    ...overrides,
  };
}

function makeJob(overrides: Partial<JobInput> = {}): JobInput {
  return {
    title: 'Backend Developer',
    skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'AWS'],
    locationClass: 'ETHIOPIA_LOCAL',
    location: 'Addis Ababa, Ethiopia',
    country: 'Ethiopia',
    employmentType: 'FULL_TIME',
    experienceLevel: 'ENTRY',
    salary: null,
    workPlace: 'ONSITE',
    parseConfidence: 90,
    postedAt: Date.now(),
    ...overrides,
  };
}

const findPart = (r: ReturnType<typeof scoreJob>, label: string) =>
  r.parts.find((p) => p.label === label)!;

describe('normalizeSkill (FR-012 / skill alias dictionary)', () => {
  it('maps aliases onto canonical names', () => {
    expect(normalizeSkill('node')).toBe('Node.js');
    expect(normalizeSkill('NodeJS')).toBe('Node.js');
    expect(normalizeSkill('Node.js')).toBe('Node.js');
    expect(normalizeSkill('ts')).toBe('TypeScript');
    expect(normalizeSkill('postgres')).toBe('PostgreSQL');
  });

  it('passes through canonical names and unknown skills', () => {
    expect(normalizeSkill('React')).toBe('React');
    expect(normalizeSkill('Kubernetes')).toBe('Kubernetes');
    expect(normalizeSkill('SomethingWeird')).toBe('SomethingWeird');
  });
});

describe('areSkillsRelated (FR-012b skill relationship graph)', () => {
  it('is symmetric for graph edges', () => {
    expect(areSkillsRelated('JavaScript', 'TypeScript')).toBe(true);
    expect(areSkillsRelated('TypeScript', 'JavaScript')).toBe(true);
    expect(areSkillsRelated('Node.js', 'NestJS')).toBe(true);
    expect(areSkillsRelated('PostgreSQL', 'SQL')).toBe(true);
  });

  it('is false for unrelated or identical skills', () => {
    expect(areSkillsRelated('Node.js', 'PostgreSQL')).toBe(false);
    expect(areSkillsRelated('JavaScript', 'JavaScript')).toBe(false);
  });
});

describe('roleSimilarity (FR-018 role compatibility)', () => {
  it('returns 1 for an exact match', () => {
    expect(roleSimilarity('Backend Developer', 'Backend Developer')).toBe(1);
  });

  it('matches synonyms at 0.75', () => {
    expect(roleSimilarity('Junior Backend Engineer', 'Backend Developer')).toBe(0.75);
    expect(roleSimilarity('Senior Fullstack Engineer', 'Full Stack Developer')).toBe(0.75);
  });

  it('falls back to a small engineer/developer overlap', () => {
    expect(roleSimilarity('Software Engineer', 'Full Stack Developer')).toBe(0.75); // explicit synonym
    expect(roleSimilarity('Frontend Developer', 'Backend Developer')).toBe(0);
  });
});

describe('scoreJob — skill scoring (FR-019)', () => {
  it('counts direct, related, and missing skills', () => {
    const r = scoreJob(makeJob(), makeProfile());
    expect(r.matchedSkills).toEqual(['Node.js', 'TypeScript', 'PostgreSQL']);
    // AWS is now related via skill graph (AWS ↔ Node.js), so it's not missing
    expect(r.missingSkills).not.toContain('AWS');
  });

  it('counts graph-related skills at half weight', () => {
    const prof = makeProfile({ skills: ['JavaScript'] });
    const job = makeJob({ title: 'Frontend Developer', skills: ['TypeScript', 'React'] });
    const r = scoreJob(job, prof);
    // JS→TS (0.85*0.8=0.68) and JS→React (0.8*0.8=0.64) are both above 0.6
    // transferability threshold, so they're classified as transferable (not related).
    // relatedSkills includes both transferable and related.
    expect(r.relatedSkills).toEqual(['TypeScript', 'React']);
    expect(findPart(r, 'Skills').fraction).toBeCloseTo(0.66, 1); // (0.68 + 0.64) / 2
  });
});

describe('scoreJob — freshness decay (FR-019b)', () => {
  it('decays exponentially with τ=72h and clamps at 0.05', () => {
    const fresh = scoreJob(makeJob({ postedAt: Date.now() - 1 * HOUR }), makeProfile());
    const stale = scoreJob(makeJob({ postedAt: Date.now() - 720 * HOUR }), makeProfile());
    expect(findPart(fresh, 'Freshness').fraction).toBeCloseTo(Math.exp(-1 / 72), 3);
    expect(findPart(stale, 'Freshness').fraction).toBe(0.05);
    expect(findPart(fresh, 'Freshness').fraction).toBeGreaterThan(findPart(stale, 'Freshness').fraction);
  });

  it('ranks a freshly posted job above an identical older one', () => {
    const fresh = scoreJob(makeJob({ postedAt: Date.now() - 1 * HOUR }), makeProfile());
    const stale = scoreJob(makeJob({ postedAt: Date.now() - 30 * 24 * HOUR }), makeProfile());
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  it('notes very fresh postings in the reasons', () => {
    const r = scoreJob(makeJob({ postedAt: Date.now() - 3 * HOUR }), makeProfile());
    expect(r.reasons.some((reason) => reason.startsWith('Very fresh'))).toBe(true);
  });
});

describe('scoreJob — experience, location, employment, salary', () => {
  it('gives full experience credit when years meet the requirement', () => {
    const r = scoreJob(makeJob({ experienceLevel: 'ENTRY' }), makeProfile({ years: 2 }));
    expect(findPart(r, 'Experience').fraction).toBe(1);
    expect(r.reasons).toContain('Experience fits (2 yrs vs 1+ required)');
  });

  it('flags a large experience gap', () => {
    const r = scoreJob(makeJob({ experienceLevel: 'SENIOR' }), makeProfile({ years: 1 }));
    expect(r.reasons).toContain('Requires 5+ yrs — you have 1');
  });

  it('scores location from the user tier map', () => {
    const localHigh = scoreJob(makeJob({ locationClass: 'ETHIOPIA_LOCAL' }), makeProfile());
    const untiered = scoreJob(makeJob({ locationClass: 'ETHIOPIA_LOCAL' }), makeProfile({ locationTiers: {} }));
    expect(findPart(localHigh, 'Location').fraction).toBe(1);
    expect(findPart(untiered, 'Location').fraction).toBeCloseTo(0.12, 5);
  });

  it('penalizes employment types not in the profile', () => {
    const ok = scoreJob(makeJob({ employmentType: 'FULL_TIME' }), makeProfile());
    const bad = scoreJob(makeJob({ employmentType: 'CONTRACT' }), makeProfile({ employmentTypes: [] }));
    expect(findPart(ok, 'Employment').fraction).toBe(1);
    expect(findPart(bad, 'Employment').fraction).toBe(0.35);
  });

  it('rewards salaries at or above the minimum', () => {
    const good = scoreJob(makeJob({ salary: 900 }), makeProfile({ minSalary: 700 }));
    const poor = scoreJob(makeJob({ salary: 350 }), makeProfile({ minSalary: 700 }));
    expect(findPart(good, 'Salary').fraction).toBe(1);
    expect(findPart(poor, 'Salary').fraction).toBeCloseTo(0.5, 5);
  });
});

describe('scoreJob — penalties and confidence (FR-020 / FR-012c)', () => {
  it('applies a seniority penalty for junior profiles', () => {
    const base = scoreJob(makeJob(), makeProfile());
    const senior = scoreJob(makeJob({ title: 'Senior Backend Developer' }), makeProfile({ years: 2 }));
    expect(senior.score).toBeLessThan(base.score);
    expect(senior.reasons).toContain('Seniority above your stated experience (−5)');
  });

  it('down-weights jobs with low parse confidence', () => {
    const low = scoreJob(makeJob({ parseConfidence: 30 }), makeProfile());
    expect(low.reasons).toContain('Low parse confidence — details may be incomplete');
    expect(low.score).toBeLessThan(scoreJob(makeJob(), makeProfile()).score);
  });

  it('penalizes international on-site jobs when on-site is excluded', () => {
    const base = scoreJob(makeJob({ locationClass: 'INTERNATIONAL_ONSITE', workPlace: 'ONSITE' }), makeProfile());
    const excluded = scoreJob(
      makeJob({ locationClass: 'INTERNATIONAL_ONSITE', workPlace: 'ONSITE' }),
      makeProfile({ excludeOnsite: true }),
    );
    expect(excluded.score).toBeLessThan(base.score);
  });
});

describe('scoreJob — overall math (FR-019 weights)', () => {
  it('produces a high score for a strong local backend match', () => {
    const r = scoreJob(makeJob(), makeProfile());
    expect(r.score).toBeGreaterThanOrEqual(88);
    expect(r.score).toBeLessThanOrEqual(95);
    // 25*1 + 30*0.875 + 15*1 + 15*1 + 5*1 + 5*1 + 5*0.55 = 93.5 → 94
    // (AWS now related via expanded skill graph, boosting skill fraction)
  });

  it('keeps the score inside [0, 100] and stores all seven breakdown parts', () => {
    const r = scoreJob(makeJob(), makeProfile());
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.parts.map((p) => p.label)).toEqual([
      'Role',
      'Skills',
      'Experience',
      'Location',
      'Employment',
      'Freshness',
      'Salary',
    ]);
    expect(r.summary).toContain('Matches your profile');
  });
});
