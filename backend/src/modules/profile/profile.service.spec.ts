import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/profile.dto';

/**
 * FR-003e (SRS §12): when PATCH /api/profile touches a core matching attribute the
 * change is persisted and answered immediately, and the recalculation runs as a
 * background task for that user. Non-core fields may skip recalculation in MVP.
 */
describe('FR-003e — Profile update recalculation hook', () => {
  function makePrisma(stored: any = { userId: 'user-1', title: 'M&E Officer', years: 4, minSalary: 0 }) {
    const tx = {
      candidateProfile: { upsert: jest.fn().mockResolvedValue(stored) },
      candidateSkill: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
      skill: { upsert: jest.fn().mockResolvedValue({ id: 'skill-1' }) },
      targetRole: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
      locationPreference: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      ...tx,
      $transaction: jest.fn((fn: any) => fn(tx)),
      json: (v: any) => JSON.stringify(v),
      bool: (v: boolean) => (v ? 1 : 0),
      jsonArray: (v: any) => (typeof v === 'string' ? JSON.parse(v || '[]') : v ?? []),
      cvFile: { findFirst: jest.fn().mockResolvedValue(null) },
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
      await new ProfileService(prisma, matching).updateProfile('user-1', { [key]: value } as any);
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
    const response = new ProfileService(prisma, matching)
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
    await new ProfileService(prisma, matching).updateProfile(
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
      new ProfileService(prisma, matching).updateProfile('user-1', { remote: true } as any),
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
