import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SourcesService } from './sources.service';
import { RawJob } from './adapters/job-source.adapter';

function rawJob(overrides: Partial<RawJob> = {}): RawJob {
  return {
    title: 'Backend Developer',
    company: 'Acme',
    location: 'Addis Ababa, Ethiopia',
    locationClass: 'ETHIOPIA_LOCAL',
    employmentType: 'FULL_TIME',
    experienceLevel: 'ENTRY',
    workPlace: 'ONSITE',
    skills: ['Node.js', 'TypeScript'],
    url: 'https://example.com/job/1',
    sourceJobId: 'rw-1',
    postedDate: new Date(),
    parseConfidence: 88,
    ...overrides,
  };
}

function createService() {
  const prisma: any = {
    jobSource: { findUnique: jest.fn(), update: jest.fn() },
    job: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    skill: { upsert: jest.fn().mockResolvedValue({ id: 'skill-1' }) },
    sourceRun: { create: jest.fn().mockResolvedValue({}) },
  };
  const matching: any = {
    recalculate: jest.fn().mockResolvedValue(0),
    matchUnmatchedJobs: jest.fn().mockResolvedValue({
      jobsEvaluated: 0,
      usersProcessed: 0,
      matchesCreated: 0,
      aboveThreshold: 0,
      sent: 0,
      toInbox: 0,
      skipped: 0,
    }),
  };
  const reliefweb: any = { sourceId: 'reliefweb', fetchJobs: jest.fn() };
  const remotive: any = { sourceId: 'remotive', fetchJobs: jest.fn() };
  const arbeitnow: any = { sourceId: 'arbeitnow', fetchJobs: jest.fn() };
  const ethiongojobs: any = { sourceId: 'ethiongojobs', fetchJobs: jest.fn() };
  const geezjobs: any = { sourceId: 'geezjobs', fetchJobs: jest.fn() };
  const ethiojobs: any = { sourceId: 'ethiojobs', fetchJobs: jest.fn() };
  const service = new SourcesService(prisma, matching, reliefweb, remotive, arbeitnow, ethiongojobs, geezjobs, ethiojobs);
  return { service, prisma, matching, reliefweb, remotive };
}

describe('SourcesService.collect — FR-015 ghost detection via reconciliation', () => {
  it('increments missedCycles for unseen ACTIVE jobs and REMOVEs them at the limit', async () => {
    const { service, prisma, reliefweb } = createService();
    prisma.jobSource.findUnique.mockResolvedValue({ id: 'reliefweb', name: 'ReliefWeb', status: 'ACTIVE' });
    reliefweb.fetchJobs.mockResolvedValue([rawJob()]); // only sourceJobId 'rw-1' is seen
    prisma.job.findUnique.mockResolvedValue(null); // all fetched jobs are new
    prisma.job.create.mockResolvedValue({ id: 'j-new' });
    prisma.job.findMany.mockResolvedValue([
      { id: 'j-ghost-1', sourceJobId: 'rw-old-1', missedCycles: 2 }, // 2 + 1 = 3 → REMOVED
      { id: 'j-ghost-2', sourceJobId: 'rw-old-2', missedCycles: 0 }, // 0 + 1 = 1 → keep
    ]);

    const result = await service.collect('reliefweb');

    expect(result.status).toBe('OK');
    // First updateMany: increment missedCycles for both unseen jobs.
    const incrementCall = prisma.job.updateMany.mock.calls.find(
      (c: any[]) => c[0]?.data?.missedCycles?.increment === 1,
    );
    expect(incrementCall).toBeDefined();
    expect(incrementCall[0].where.id.in).toEqual(['j-ghost-1', 'j-ghost-2']);
    // Second updateMany: REMOVE the job that crossed the limit.
    const removeCall = prisma.job.updateMany.mock.calls.find((c: any[]) => c[0]?.data?.status === 'REMOVED');
    expect(removeCall).toBeDefined();
    expect(removeCall[0].where.id.in).toEqual(['j-ghost-1']);
    expect(removeCall[0].data.statusChangedAt).toBeInstanceOf(Date);
  });

  it('resets missedCycles and refreshes lastSeenAt for jobs seen in the latest fetch', async () => {
    const { service, prisma, reliefweb } = createService();
    prisma.jobSource.findUnique.mockResolvedValue({ id: 'reliefweb', name: 'ReliefWeb', status: 'ACTIVE' });
    reliefweb.fetchJobs.mockResolvedValue([rawJob({ sourceJobId: 'rw-1' })]);
    prisma.job.findUnique.mockResolvedValue({ id: 'j-existing', status: 'ACTIVE' });
    prisma.job.findMany.mockResolvedValue([]); // nothing else stored for this source

    await service.collect('reliefweb');

    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'j-existing' },
        data: expect.objectContaining({ missedCycles: 0 }),
      }),
    );
    // No ghost pass ran because nothing was unseen.
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
  });
});

describe('SourcesService.persist — upsert, dedup, reactivation (FR-014 / FR-015)', () => {
  it('creates a new job and returns CREATED', async () => {
    const { service, prisma } = createService();
    prisma.job.findUnique.mockResolvedValue(null);

    const result = await (service as any).persist('reliefweb', rawJob());

    expect(result).toBe('CREATED');
    expect(prisma.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Backend Developer',
          sourceId: 'reliefweb',
          sourceJobId: 'rw-1',
          status: 'ACTIVE',
          skills: { create: [{ skillId: 'skill-1' }, { skillId: 'skill-1' }] },
        }),
      }),
    );
  });

  it('counts an existing ACTIVE job as a duplicate and resets its missedCycles', async () => {
    const { service, prisma } = createService();
    prisma.job.findUnique.mockResolvedValue({ id: 'j-1', status: 'ACTIVE' });

    const result = await (service as any).persist('reliefweb', rawJob());

    expect(result).toBe('DUPLICATE');
    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'j-1' },
      data: expect.objectContaining({ missedCycles: 0, status: 'ACTIVE', statusChangedAt: undefined }),
    });
  });

  it('reactivates a REMOVED job that reappears on the source', async () => {
    const { service, prisma } = createService();
    prisma.job.findUnique.mockResolvedValue({ id: 'j-1', status: 'REMOVED' });

    const result = await (service as any).persist('reliefweb', rawJob());

    expect(result).toBe('DUPLICATE');
    const update = prisma.job.update.mock.calls[0][0];
    expect(update.data.status).toBe('ACTIVE');
    expect(update.data.statusChangedAt).toBeNull();
  });
});

describe('SourcesService.collect — validation, dedup counting, isolation (FR-013/014/036)', () => {
  it('rejects a missing or non-ACTIVE source', async () => {
    const { service, prisma } = createService();
    prisma.jobSource.findUnique.mockResolvedValue(null);
    await expect(service.collect('nope')).rejects.toBeInstanceOf(NotFoundException);

    prisma.jobSource.findUnique.mockResolvedValue({ id: 'reliefweb', status: 'DISABLED' });
    await expect(service.collect('reliefweb')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('drops invalid postings and counts new vs duplicate', async () => {
    const { service, prisma, reliefweb } = createService();
    prisma.jobSource.findUnique.mockResolvedValue({ id: 'reliefweb', name: 'ReliefWeb', status: 'ACTIVE' });
    reliefweb.fetchJobs.mockResolvedValue([
      rawJob({ sourceJobId: 'rw-new' }),
      rawJob({ sourceJobId: 'rw-dup' }),
      { ...rawJob({ sourceJobId: 'rw-invalid' }), title: '' }, // FR-013: invalid
    ]);
    prisma.job.findUnique
      .mockResolvedValueOnce(null) // rw-new → create
      .mockResolvedValueOnce({ id: 'j-dup', status: 'ACTIVE' }); // rw-dup → duplicate
    prisma.job.create.mockResolvedValue({ id: 'j-new' });
    prisma.job.findMany.mockResolvedValue([]);

    const result = await service.collect('reliefweb');

    expect(result).toEqual({ status: 'OK', jobsFetched: 2, jobsCreated: 1, duplicates: 1, delivered: 0 });
    const run = prisma.sourceRun.create.mock.calls[0][0].data;
    expect(run.status).toBe('OK');
    expect(run.errors).toBe(1); // the invalid posting was counted as an error
    expect(run.jobsCreated).toBe(1);
  });

  it('isolates a failing source without blocking other sources or matching (FR-036)', async () => {
    const { service, prisma, reliefweb, matching } = createService();
    prisma.jobSource.findUnique.mockResolvedValue({ id: 'reliefweb', name: 'ReliefWeb', status: 'ACTIVE' });
    reliefweb.fetchJobs.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await service.collect('reliefweb');

    expect(result.status).toBe('FAIL');
    expect(prisma.jobSource.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ERROR', lastError: 'ETIMEDOUT' }) }),
    );
    expect(prisma.sourceRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAIL', errors: 1 }) }),
    );
    expect(matching.matchUnmatchedJobs).not.toHaveBeenCalled();
  });

  it('fails cleanly for sources without a registered adapter (no demo templates)', async () => {
    const { service, prisma } = createService();
    prisma.jobSource.findUnique.mockResolvedValue({ id: 'hahu', name: 'HaHuJobs', status: 'ACTIVE' });

    const result = await service.collect('hahu');

    expect(result.status).toBe('FAIL');
    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(prisma.jobSource.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ERROR' }) }),
    );
    expect(prisma.sourceRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAIL', errors: 1 }) }),
    );
  });
});
