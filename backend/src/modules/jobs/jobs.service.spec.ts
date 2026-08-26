import { JobsService } from './jobs.service';

const row = (id: string, firstSeenAt: string) => ({
  id,
  firstSeenAt: new Date(firstSeenAt),
  postedDate: new Date(firstSeenAt),
  deadline: null,
  title: `Job ${id}`,
  company: 'Acme',
  location: 'Addis Ababa',
  workPlace: 'ONSITE',
  employmentType: 'FULL_TIME',
  experienceLevel: 'MID',
  skills: [],
  source: { id: 's1', name: 'ReliefWeb', priorityTier: 'ETHIOPIA' },
  matches: [],
  savedBy: [],
  apps: [],
});

function createService() {
  const job: any = {
    count: jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const salary: any = { compareJobSalary: jest.fn().mockReturnValue(null) };
  const prisma = { job, json: (v: any) => v, parseJson: (v: any) => v, jsonArray: (v: any) => (Array.isArray(v) ? v : []) };
  return { service: new JobsService(prisma as any, salary), job, salary };
}

describe('JobsService.list — PERF-002 keyset pagination', () => {
  it('applies the default page size, stable ordering, and returns the envelope', async () => {
    const { service, job } = createService();
    job.count.mockResolvedValue(3);
    job.findMany.mockResolvedValue([row('a', '2026-08-16T00:00:00Z'), row('b', '2026-08-15T00:00:00Z')]);

    const res = await service.list({ userId: 'u1' });

    expect(res.total).toBe(3);
    expect(res.items.map((j: any) => j.id)).toEqual(['a', 'b']);
    expect(res.nextCursor).toBeNull();
    expect(job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 51,
        orderBy: [{ firstSeenAt: 'desc' }, { id: 'desc' }],
        where: { status: 'ACTIVE' },
      }),
    );
    expect(job.count).toHaveBeenCalledWith({ where: { status: 'ACTIVE' } });
  });

  it('emits a nextCursor when more rows exist and applies it as a keyset where on the next page', async () => {
    const { service, job } = createService();
    job.count.mockResolvedValue(60);
    const rows = Array.from({ length: 51 }, (_, i) =>
      row(`j${String(i).padStart(2, '0')}`, `2026-08-01T00:00:${String(i).padStart(2, '0')}Z`),
    );
    job.findMany.mockResolvedValueOnce(rows);

    const page1 = await service.list({ userId: 'u1' });
    expect(page1.items).toHaveLength(50);
    expect(page1.nextCursor).toBeTruthy();

    job.findMany.mockResolvedValueOnce([row('j50', '2026-08-01T00:00:50Z')]);
    const page2 = await service.list({ userId: 'u1', cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    const call = job.findMany.mock.calls[1][0];
    expect(call.take).toBe(51);
    expect(call.where.AND).toBeDefined();
    // AND[0] = the base ACTIVE filter, AND[1] = the keyset predicate
    expect(call.where.AND[1].OR).toBeDefined();
  });

  it('combines the cursor with existing filters (q + tier)', async () => {
    const { service, job } = createService();
    job.findMany.mockResolvedValue([]);
    await service.list({ userId: 'u1', q: 'node', tier: 'ETHIOPIA' });
    const where = job.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      status: 'ACTIVE',
      source: { priorityTier: 'ETHIOPIA' },
      OR: expect.any(Array),
    });
  });
});
