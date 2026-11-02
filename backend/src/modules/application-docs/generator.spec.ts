import {
  PackageJob,
  PackageMatch,
  PackageProfile,
  generateApplicationPackage,
} from './generator';

function profile(over: Partial<PackageProfile> = {}): PackageProfile {
  return {
    personal: {
      fullName: 'Abebe Bikila',
      email: 'abebe@example.com',
      phone: '+251911000000',
      city: 'Addis Ababa',
      country: 'Ethiopia',
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
    },
    title: 'Backend Developer',
    summary: 'Backend developer with six years building payment systems.',
    years: 6,
    skills: ['Node.js', 'PostgreSQL'],
    education: [
      {
        institution: 'Addis Ababa University',
        degree: 'BSc',
        field: 'Computer Science',
        startYear: 2014,
        endYear: 2018,
        grade: null,
      },
    ],
    experiences: [
      {
        title: 'Senior Backend Engineer',
        company: 'Ethio Telecom',
        location: 'Addis Ababa',
        startYear: 2018,
        endYear: null,
        current: true,
        description: 'Built billing APIs handling 2M requests per day.',
      },
    ],
    projects: [
      {
        name: 'OpenLedger',
        description: 'Double-entry accounting service.',
        url: 'https://example.com/openledger',
        year: 2023,
      },
    ],
    certifications: [
      { name: 'AWS Solutions Architect', issuer: 'Amazon', year: 2022, credentialUrl: null },
    ],
    languages: [{ language: 'Amharic', proficiency: 'Native' }],
    documents: [{ kind: 'CV', originalName: 'cv.pdf' }],
    ...over,
  };
}

function job(over: Partial<PackageJob> = {}): PackageJob {
  return {
    id: 'job-1',
    title: 'Senior Backend Developer',
    company: 'Safaricom Ethiopia',
    location: 'Addis Ababa',
    description: 'Build APIs.',
    skills: ['Node.js', 'Kubernetes'],
    experienceLevel: 'SENIOR',
    deadline: null,
    ...over,
  };
}

function match(over: Partial<PackageMatch> = {}): PackageMatch {
  return {
    requiredRequirements: [
      {
        name: 'Node.js',
        kind: 'SKILL',
        importance: 'REQUIRED',
        status: 'MET',
        evidence: 'Node.js is listed in your verified skills.',
      },
      {
        name: 'Kubernetes',
        kind: 'SKILL',
        importance: 'REQUIRED',
        status: 'MISSING',
        evidence: 'No Kubernetes evidence in your verified profile.',
      },
    ],
    preferredRequirements: [],
    missingRequirements: ['Kubernetes'],
    unknownRequirements: [],
    ...over,
  };
}

describe('generateApplicationPackage — never invents candidate facts', () => {
  it('omits unverified skills from the CV and never claims them in the cover letter', () => {
    const pkg = generateApplicationPackage(profile({ skills: [] }), job(), null);

    expect(pkg.cv).not.toContain('Kubernetes');
    expect(pkg.cv).not.toContain('Node.js');
    expect(pkg.coverLetter).not.toContain('Kubernetes');
    expect(pkg.coverLetter).not.toContain('Node.js');
  });

  it('only mentions job skills the verified profile can prove', () => {
    const pkg = generateApplicationPackage(profile(), job(), null);

    expect(pkg.coverLetter).toContain('Node.js');
    expect(pkg.coverLetter).toContain('verified in');
    expect(pkg.coverLetter).not.toContain('Kubernetes');
  });

  it('falls back to verified profile skills when the posting lists none', () => {
    const pkg = generateApplicationPackage(profile(), job({ skills: [] }), null);

    expect(pkg.coverLetter).toContain('Node.js');
    expect(pkg.coverLetter).toContain('PostgreSQL');
  });

  it('answers an unverified screening question honestly instead of guessing', () => {
    const pkg = generateApplicationPackage(profile({ skills: [] }), job({ skills: ['Kubernetes'] }), null);

    const answer = pkg.screeningAnswers.find((a) => a.question.includes('Kubernetes'));
    expect(answer?.answer).toBe('Not verified in your profile.');
    expect(answer?.basis).toMatch(/no verified evidence/i);
  });

  it('states missing requirements as warnings rather than fabricating them', () => {
    const pkg = generateApplicationPackage(profile(), job(), match());

    expect(pkg.warnings).toContain(
      'Missing required qualification: Kubernetes. Do not claim it until it is verified.',
    );
    expect(pkg.cv).not.toContain('Kubernetes');
  });

  it('flags empty profile sections instead of writing placeholder history', () => {
    const pkg = generateApplicationPackage(
      profile({ experiences: [], education: [], skills: [], certifications: [] }),
      job(),
      null,
    );

    expect(pkg.cv).not.toMatch(/^## Experience$/m);
    expect(pkg.cv).not.toMatch(/^## Education$/m);
    expect(pkg.warnings).toEqual(
      expect.arrayContaining([
        'No verified work experience — the CV will omit the experience section.',
        'No verified education — the CV will omit the education section.',
        'No verified skills — the skills section will be empty.',
      ]),
    );
    expect(pkg.screeningAnswers.find((a) => a.question.includes('highest level'))?.answer).toBe(
      'Not provided in your profile.',
    );
  });
});

describe('generateApplicationPackage — verified content and evidence', () => {
  it('renders only the sections the profile actually contains', () => {
    const pkg = generateApplicationPackage(profile(), job(), match());

    expect(pkg.cv).toContain('Abebe Bikila');
    expect(pkg.cv).toContain('Senior Backend Engineer — Ethio Telecom');
    expect(pkg.cv).toContain('BSc in Computer Science');
    expect(pkg.cv).toContain('AWS Solutions Architect');
    expect(pkg.cv).toContain('OpenLedger');
    expect(pkg.cv).toContain('Amharic (Native)');
    expect(pkg.cv).toContain('Target role: Senior Backend Developer — Safaricom Ethiopia');
  });

  it('maps every requirement verdict into the requirement-to-evidence table', () => {
    const m = match();
    const pkg = generateApplicationPackage(profile(), job(), m);

    expect(pkg.requirementMapping).toHaveLength(2);
    expect(pkg.requirementMapping[0]).toEqual({
      name: 'Node.js',
      kind: 'SKILL',
      importance: 'REQUIRED',
      status: 'MET',
      evidence: 'Node.js is listed in your verified skills.',
    });
    expect(pkg.requirementMapping[1].status).toBe('MISSING');
  });

  it('warns about an expired deadline and missing personal details', () => {
    const pkg = generateApplicationPackage(
      profile({
        personal: {
          fullName: null,
          email: null,
          phone: null,
          city: null,
          country: null,
          linkedinUrl: null,
          githubUrl: null,
          portfolioUrl: null,
        },
      }),
      job({ deadline: new Date(Date.now() - 86_400_000) }),
      null,
    );

    expect(pkg.warnings).toEqual(
      expect.arrayContaining([
        'Your full name is missing from the profile.',
        'Your email address is missing from the profile.',
        'The application deadline has passed.',
      ]),
    );
  });

  it('is deterministic: identical inputs produce identical output', () => {
    const first = generateApplicationPackage(profile(), job(), match());
    const second = generateApplicationPackage(profile(), job(), match());

    expect(second).toEqual(first);
  });
});
