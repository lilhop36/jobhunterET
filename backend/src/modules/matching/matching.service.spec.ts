import { MatchingService } from './matching.service';

function job(over: Record<string, unknown> = {}) {
  return {
    id: 'j1',
    title: 'Backend Developer',
    location: 'Addis Ababa, Ethiopia',
    locationClass: 'ETHIOPIA_LOCAL',
    country: 'Ethiopia',
    employmentType: 'FULL_TIME',
    experienceLevel: 'ENTRY',
    salary: null,
    workPlace: 'ONSITE',
    parseConfidence: 90,
    postedDate: new Date(),
    skills: [
      { skill: { name: 'Node.js' } },
      { skill: { name: 'TypeScript' } },
      { skill: { name: 'PostgreSQL' } },
    ],
    ...over,
  };
}

function makeService(notifyResult: 'SENT' | 'WEB' | 'SKIPPED' = 'SENT') {
  const prisma: any = {
    job: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: { findMany: jest.fn() },
    candidateProfile: { findMany: jest.fn() },
    candidateSkill: { findMany: jest.fn() },
    targetRole: { findMany: jest.fn() },
    locationPreference: { findMany: jest.fn() },
    jobMatch: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const notifications: any = { notifyForMatch: jest.fn().mockResolvedValue(notifyResult) };
  const svc = new MatchingService(prisma, notifications);
  return { svc, prisma, notifications };
}

/** One user with a meaningful profile (1 skill, 1 target role, Ethiopia HIGH). */
function stubEligibleUser(prisma: any) {
  prisma.user.findMany.mockResolvedValue([{ id: 'u1', matchThreshold: 70 }]);
  prisma.candidateProfile.findMany.mockResolvedValue([
    { userId: 'u1', remote: true, employmentTypes: ['FULL_TIME'], years: 2, minSalary: 0, excludeOnsite: false },
  ]);
  prisma.candidateSkill.findMany.mockResolvedValue([{ userId: 'u1', skill: { name: 'Node.js' } }]);
  prisma.targetRole.findMany.mockResolvedValue([{ userId: 'u1', role: 'Backend Developer', priority: 'HIGH' }]);
  prisma.locationPreference.findMany.mockResolvedValue([{ userId: 'u1', region: 'Ethiopia', tier: 'HIGH' }]);
}

describe('MatchingService.matchUnmatchedJobs — FR-018 incremental matching', () => {
  it('scores only unmatched ACTIVE jobs, bulk-inserts, marks them matched, and notifies above-threshold matches', async () => {
    const { svc, prisma, notifications } = makeService();
    prisma.job.findMany.mockResolvedValue([job()]);
    stubEligibleUser(prisma);
    prisma.jobMatch.createMany.mockResolvedValue({ count: 1 });

    const outcome = await svc.matchUnmatchedJobs();

    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE', matchedAt: null }),
      }),
    );
    expect(prisma.jobMatch.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 'u1', jobId: 'j1', score: 78 })],
      skipDuplicates: true,
    });
    expect(prisma.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matchedAt: expect.any(Date) }) }),
    );
    expect(notifications.notifyForMatch).toHaveBeenCalledWith('u1', 'j1', 78, expect.any(String));
    expect(outcome).toEqual({
      jobsEvaluated: 1,
      usersProcessed: 1,
      matchesCreated: 1,
      aboveThreshold: 1,
      sent: 1,
      toInbox: 0,
      skipped: 0,
    });
  });

  it('skips users with empty profiles (prefilter) and records jobs as matched without inserting rows', async () => {
    const { svc, prisma } = makeService();
    prisma.job.findMany.mockResolvedValue([job()]);
    prisma.user.findMany.mockResolvedValue([]);

    const outcome = await svc.matchUnmatchedJobs();

    expect(prisma.jobMatch.createMany).not.toHaveBeenCalled();
    expect(prisma.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matchedAt: expect.any(Date) }) }),
    );
    expect(outcome.jobsEvaluated).toBe(1);
    expect(outcome.usersProcessed).toBe(0);
    expect(outcome.matchesCreated).toBe(0);
  });

  it('is a no-op when every ACTIVE job is already matched', async () => {
    const { svc, prisma } = makeService();
    prisma.job.findMany.mockResolvedValue([]);

    const outcome = await svc.matchUnmatchedJobs();

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      jobsEvaluated: 0,
      usersProcessed: 0,
      matchesCreated: 0,
      aboveThreshold: 0,
      sent: 0,
      toInbox: 0,
      skipped: 0,
    });
  });

  it('keeps pre-existing match rows (from a profile recalc) and still marks the job matched', async () => {
    const { svc, prisma, notifications } = makeService();
    prisma.job.findMany.mockResolvedValue([job()]);
    stubEligibleUser(prisma);
    prisma.jobMatch.findMany.mockResolvedValue([{ userId: 'u1', jobId: 'j1' }]); // row already exists

    const outcome = await svc.matchUnmatchedJobs();

    expect(prisma.jobMatch.createMany).not.toHaveBeenCalled();
    expect(notifications.notifyForMatch).not.toHaveBeenCalled();
    expect(prisma.job.updateMany).toHaveBeenCalled();
    expect(outcome.matchesCreated).toBe(0);
  });
});
