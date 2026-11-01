import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/profile.dto';

/**
 * Shared Prisma double. Every test starts from an empty but complete store so
 * adding a new section to the service cannot silently break older tests.
 */
function makePrisma(stored: any = { userId: 'user-1', title: 'M&E Officer', years: 4, minSalary: 0 }) {
  const listModel = () => ({
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  });
  const tx = {
    candidateProfile: { upsert: jest.fn().mockResolvedValue(stored) },
    candidateSkill: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
    skill: { upsert: jest.fn().mockResolvedValue({ id: 'skill-1' }) },
    targetRole: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
    locationPreference: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
    candidateEducation: listModel(),
    candidateExperience: listModel(),
    candidateProject: listModel(),
    candidateCertification: listModel(),
    candidateLanguage: listModel(),
  };
  const prisma: any = {
    ...tx,
    $transaction: jest.fn((fn: any) => fn(tx)),
    json: (v: any) => JSON.stringify(v),
    bool: (v: boolean) => (v ? 1 : 0),
    jsonArray: (v: any) => (typeof v === 'string' ? JSON.parse(v || '[]') : v ?? []),
    user: { findUnique: jest.fn().mockResolvedValue({ email: 'abebe@example.com' }) },
    cvFile: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  prisma.candidateProfile.findUnique = jest.fn().mockResolvedValue(stored);
  prisma.candidateSkill.findMany = jest.fn().mockResolvedValue([]);
  prisma.candidateSkill.count = jest.fn().mockResolvedValue(0);
  prisma.targetRole.findMany = jest.fn().mockResolvedValue([]);
  prisma.targetRole.count = jest.fn().mockResolvedValue(0);
  prisma.locationPreference.findMany = jest.fn().mockResolvedValue([]);
  prisma.locationPreference.count = jest.fn().mockResolvedValue(0);
  return prisma;
}

const service = (prisma: any, matching: any = { recalculate: jest.fn().mockResolvedValue(0) }) =>
  new ProfileService(prisma, matching);

/**
 * FR-003e (SRS §12): when PATCH /api/profile touches a core matching attribute the
 * change is persisted and answered immediately, and the recalculation runs as a
 * background task for that user. Non-core fields may skip recalculation in MVP.
 */
describe('FR-003e — Profile update recalculation hook', () => {
  it('recalculates for each core matching attribute named in the DTO', async () => {
    expect(UpdateProfileDto.CORE_KEYS).toEqual([
      'skills',
      'targetRoles',
      'locationTiers',
      'remote',
      'employmentTypes',
      'excludeEntryLevel',
    ]);

    for (const key of UpdateProfileDto.CORE_KEYS) {
      const prisma = makePrisma();
      const matching = { recalculate: jest.fn().mockResolvedValue(0) } as any;
      const value = key === 'skills' ? ['Monitoring & Evaluation']
        : key === 'targetRoles' ? ['M&E Officer']
        : key === 'locationTiers' ? ['Addis Ababa']
        : key === 'employmentTypes' ? ['FULL_TIME']
        : true;
      await service(prisma, matching).updateProfile('user-1', { [key]: value } as any);
      expect(matching.recalculate).toHaveBeenCalledWith('user-1');
    }
  });

  it('answers the PATCH before the background recalculation finishes', async () => {
    const prisma = makePrisma();
    let release: () => void = () => {};
    const matching = {
      recalculate: jest.fn().mockReturnValue(
        new Promise<number>((resolve) => {
          release = () => resolve(0);
        }),
      ),
    } as any;

    let settled = false;
    const response = service(prisma, matching)
      .updateProfile('user-1', { skills: ['Budgeting'] } as any)
      .then((profile) => {
        settled = true;
        return profile;
      });

    // setImmediate runs after every pending microtask: the write and the read
    // have both completed, yet the recalculation is still outstanding.
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(true);
    expect(matching.recalculate).toHaveBeenCalledWith('user-1');

    release();
    const profile = await response;
    expect(profile).toHaveProperty('completion');
  });

  it('skips recalculation when only non-core fields change', async () => {
    const prisma = makePrisma();
    const matching = { recalculate: jest.fn() } as any;
    await service(prisma, matching).updateProfile(
      'user-1',
      { summary: 'Eight years in NGO M&E', minSalary: 60000, title: 'Senior M&E Officer' } as any,
    );
    expect(prisma.candidateProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ summary: 'Eight years in NGO M&E' }) }),
    );
    expect(matching.recalculate).not.toHaveBeenCalled();
  });

  it('a failing recalculation never fails the profile response', async () => {
    const prisma = makePrisma();
    const matching = { recalculate: jest.fn().mockRejectedValue(new Error('db busy')) } as any;
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      service(prisma, matching).updateProfile('user-1', { remote: true } as any),
    ).resolves.toMatchObject({ title: 'M&E Officer' });
    // The rejection surfaces on the next macrotask, where the catch logs it.
    await new Promise((r) => setImmediate(r));
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[RECALC] background recalc failed for userId=user-1'),
      expect.any(Error),
    );
    spy.mockRestore();
  });
});

/** Phase 5 — the profile is a structured document, not a bag of strings. */
describe('Phase 5 — structured candidate profile', () => {
  it('exposes personal details, sections and documents', async () => {
    const prisma = makePrisma();
    prisma.candidateEducation.findMany.mockResolvedValue([
      { id: 'e1', institution: 'Addis Ababa University', degree: 'BSc', field: 'CS', startYear: 2015, endYear: 2019, grade: null },
    ]);
    prisma.candidateExperience.findMany.mockResolvedValue([
      { id: 'x1', title: 'Engineer', company: 'Acme', location: null, startYear: 2020, endYear: null, current: 1, description: null },
    ]);
    prisma.candidateLanguage.findMany.mockResolvedValue([
      { id: 'l1', language: 'Amharic', proficiency: 'NATIVE' },
    ]);
    prisma.cvFile.findMany.mockResolvedValue([
      { id: 'd1', kind: 'CV', label: null, originalName: 'cv.pdf', sizeBytes: 10, uploadedAt: new Date(0) },
    ]);

    const view = await service(prisma).getProfile('user-1');

    expect(view.personal).toMatchObject({ email: 'abebe@example.com' });
    expect(view.education[0]).toMatchObject({ institution: 'Addis Ababa University', endYear: 2019 });
    expect(view.experiences[0].current).toBe(true);
    expect(view.languages).toEqual([{ id: 'l1', language: 'Amharic', proficiency: 'NATIVE' }]);
    expect(view.documents).toHaveLength(1);
  });

  it('trims personal fields and drops empty strings', async () => {
    const prisma = makePrisma();
    await service(prisma).updateProfile('user-1', {
      fullName: '  Abebe Kebede  ',
      phone: '   ',
      city: ' Addis Ababa ',
    } as any);

    const data = prisma.candidateProfile.upsert.mock.calls[0][0].update;
    expect(data).toMatchObject({ fullName: 'Abebe Kebede', phone: null, city: 'Addis Ababa' });
  });

  it('replaces education rows and skips blank entries', async () => {
    const prisma = makePrisma();
    await service(prisma).updateProfile('user-1', {
      education: [
        { institution: ' Addis Ababa University ', degree: 'BSc', field: 'Computer Science', startYear: 2015, endYear: 2019 },
        { institution: '   ' },
        { institution: 'AAiT', startYear: 1000, endYear: 2021 },
      ],
    } as any);

    expect(prisma.candidateEducation.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(prisma.candidateEducation.create).toHaveBeenCalledTimes(2);
    expect(prisma.candidateEducation.create).toHaveBeenNthCalledWith(1, {
      data: {
        userId: 'user-1',
        institution: 'Addis Ababa University',
        degree: 'BSc',
        field: 'Computer Science',
        startYear: 2015,
        endYear: 2019,
        grade: null,
      },
    });
    // An impossible year is dropped rather than stored.
    expect(prisma.candidateEducation.create.mock.calls[1][0].data).toMatchObject({
      institution: 'AAiT',
      startYear: null,
      endYear: 2021,
    });
  });

  it('stores 0/1 for "current" and de-duplicates languages', async () => {
    const prisma = makePrisma();
    await service(prisma).updateProfile('user-1', {
      experiences: [
        { title: 'Engineer', company: 'Acme', startYear: 2020, current: true },
        { title: '', company: 'Ignored' },
      ],
      languages: [
        { language: 'Amharic', proficiency: 'NATIVE' },
        { language: 'amharic', proficiency: 'FLUENT' },
        { language: 'English', proficiency: 'NOT_A_LEVEL' },
      ],
    } as any);

    expect(prisma.candidateExperience.create).toHaveBeenCalledTimes(1);
    expect(prisma.candidateExperience.create.mock.calls[0][0].data.current).toBe(1);

    expect(prisma.candidateLanguage.create).toHaveBeenCalledTimes(2);
    expect(prisma.candidateLanguage.create.mock.calls[1][0].data).toEqual({
      userId: 'user-1',
      language: 'English',
      proficiency: 'INTERMEDIATE',
    });
  });

  it('leaves sections untouched when the PATCH does not mention them', async () => {
    const prisma = makePrisma();
    await service(prisma).updateProfile('user-1', { title: 'Engineer' } as any);
    expect(prisma.candidateEducation.deleteMany).not.toHaveBeenCalled();
    expect(prisma.candidateExperience.deleteMany).not.toHaveBeenCalled();
    expect(prisma.candidateProject.deleteMany).not.toHaveBeenCalled();
    expect(prisma.candidateCertification.deleteMany).not.toHaveBeenCalled();
    expect(prisma.candidateLanguage.deleteMany).not.toHaveBeenCalled();
  });

  it('completion weights add up to exactly 100 for a complete profile', async () => {
    const prisma = makePrisma({
      userId: 'user-1',
      fullName: 'Abebe Kebede',
      phone: '+251911234567',
      city: 'Addis Ababa',
      title: 'Software Engineer',
      summary: 'Builds things',
      years: 5,
      minSalary: 50000,
      employmentTypes: '["FULL_TIME"]',
    });
    prisma.candidateSkill.count.mockResolvedValue(3);
    prisma.targetRole.count.mockResolvedValue(2);
    prisma.locationPreference.count.mockResolvedValue(1);
    prisma.candidateEducation.count.mockResolvedValue(1);
    prisma.candidateExperience.count.mockResolvedValue(1);
    prisma.cvFile.findFirst.mockResolvedValue({ id: 'cv' });

    await expect(service(prisma).completion('user-1')).resolves.toBe(100);
  });

  it('counts a CV only when it is an active CV document', async () => {
    const prisma = makePrisma();
    await service(prisma).completion('user-1');
    expect(prisma.cvFile.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', active: 1, kind: 'CV' },
    });
  });
});
