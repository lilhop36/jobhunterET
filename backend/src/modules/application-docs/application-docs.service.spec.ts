import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApplicationDocsService } from './application-docs.service';

function profileView() {
  return {
    personal: {
      fullName: 'Abebe Bikila',
      email: 'abebe@example.com',
      phone: null,
      city: 'Addis Ababa',
      country: 'Ethiopia',
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
    },
    title: 'Backend Developer',
    summary: null,
    years: 6,
    remote: false,
    minSalary: 0,
    excludeOnsite: false,
    excludeEntryLevel: false,
    employmentTypes: [],
    onboardDone: true,
    skills: ['Node.js'],
    targetRoles: [],
    locationTiers: [],
    education: [],
    experiences: [],
    projects: [],
    certifications: [],
    languages: [],
    documents: [],
    completion: 60,
  };
}

const jobRow = {
  id: 'job-1',
  title: 'Senior Backend Developer',
  company: 'Safaricom Ethiopia',
  location: 'Addis Ababa',
  description: 'Build APIs.',
  experienceLevel: 'SENIOR',
  deadline: null,
  skills: [{ skill: { name: 'Node.js' } }],
};

function makeService(over: { latest?: any; matchRow?: any } = {}) {
  const prisma: any = {
    job: { findUnique: jest.fn().mockResolvedValue(jobRow) },
    jobMatch: { findUnique: jest.fn().mockResolvedValue(over.matchRow ?? null) },
    applicationPackage: {
      findFirst: jest.fn().mockResolvedValue(over.latest ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'pkg-1', createdAt: new Date('2026-11-02T12:00:00Z'), ...data }),
      ),
    },
    jsonArray: (v: any) => (typeof v === 'string' ? JSON.parse(v) : Array.isArray(v) ? v : []),
  };
  const profiles: any = { getProfile: jest.fn().mockResolvedValue(profileView()) };
  return { service: new ApplicationDocsService(prisma, profiles), prisma, profiles };
}

describe('ApplicationDocsService.generate', () => {
  it('persists version 1 with the generated package body', async () => {
    const { service, prisma } = makeService();

    const view = await service.generate('user-1', 'job-1');

    expect(view.version).toBe(1);
    expect(view.cv).toContain('Target role: Senior Backend Developer — Safaricom Ethiopia');
    expect(view.generatorVersion).toBe('v1.0-deterministic');

    const data = prisma.applicationPackage.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'user-1', jobId: 'job-1', version: 1 });
    expect(typeof data.content).toBe('string');
    expect(JSON.parse(data.content).cv).toBe(view.cv);
  });

  it('appends the next version instead of overwriting history', async () => {
    const { service, prisma } = makeService({ latest: { version: 4 } });

    const view = await service.generate('user-1', 'job-1');

    expect(view.version).toBe(5);
    expect(prisma.applicationPackage.create.mock.calls[0][0].data.version).toBe(5);
  });

  it('reads the profile only for the authenticated user', async () => {
    const { service, profiles, prisma } = makeService();

    await service.generate('user-1', 'job-1');

    expect(profiles.getProfile).toHaveBeenCalledWith('user-1');
    expect(prisma.jobMatch.findUnique).toHaveBeenCalledWith({
      where: { userId_jobId: { userId: 'user-1', jobId: 'job-1' } },
    });
    expect(prisma.applicationPackage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', jobId: 'job-1' } }),
    );
  });

  it('passes the stored requirement verdicts into the requirement mapping', async () => {
    const matchRow = {
      requiredRequirements: JSON.stringify([
        {
          name: 'Node.js',
          kind: 'SKILL',
          importance: 'REQUIRED',
          status: 'MET',
          evidence: 'Listed in your profile skills.',
        },
      ]),
      preferredRequirements: '[]',
      missingRequirements: '[]',
      unknownRequirements: '[]',
    };
    const { service } = makeService({ matchRow });

    const view = await service.generate('user-1', 'job-1');

    expect(view.requirementMapping).toEqual([
      {
        name: 'Node.js',
        kind: 'SKILL',
        importance: 'REQUIRED',
        status: 'MET',
        evidence: 'Listed in your profile skills.',
      },
    ]);
  });

  it('404s for an unknown job', async () => {
    const { service, prisma } = makeService();
    prisma.job.findUnique.mockResolvedValue(null);

    await expect(service.generate('user-1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.applicationPackage.create).not.toHaveBeenCalled();
  });
});

describe('ApplicationDocsService history', () => {
  it('lists versions newest first with their warning counts', async () => {
    const { service, prisma } = makeService();
    prisma.applicationPackage.findMany.mockResolvedValue([
      {
        version: 2,
        createdAt: new Date('2026-11-02T12:00:00Z'),
        content: JSON.stringify({ generatorVersion: 'v1.0-deterministic', warnings: ['a', 'b'] }),
      },
      {
        version: 1,
        createdAt: new Date('2026-11-01T12:00:00Z'),
        content: JSON.stringify({ generatorVersion: 'v1.0-deterministic', warnings: [] }),
      },
    ]);

    const history = await service.list('user-1', 'job-1');

    expect(history.map((h) => h.version)).toEqual([2, 1]);
    expect(history[0].warnings).toHaveLength(2);
    expect(prisma.applicationPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', jobId: 'job-1' }, orderBy: { version: 'desc' } }),
    );
  });

  it('returns one stored version and scopes it to the user', async () => {
    const { service, prisma } = makeService();
    prisma.applicationPackage.findFirst.mockResolvedValue({
      id: 'pkg-2',
      version: 2,
      createdAt: new Date('2026-11-02T12:00:00Z'),
      content: JSON.stringify({
        cv: 'CV body',
        coverLetter: 'Letter',
        screeningAnswers: [],
        requirementMapping: [],
        warnings: [],
        generatorVersion: 'v1.0-deterministic',
      }),
    });

    const view = await service.get('user-1', 'job-1', 2);

    expect(view.cv).toBe('CV body');
    expect(view.version).toBe(2);
    expect(prisma.applicationPackage.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', jobId: 'job-1', version: 2 },
    });
  });

  it('rejects an invalid version and 404s a missing one', async () => {
    const { service } = makeService();

    await expect(service.get('user-1', 'job-1', 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.get('user-1', 'job-1', 9)).rejects.toBeInstanceOf(NotFoundException);
  });
});
