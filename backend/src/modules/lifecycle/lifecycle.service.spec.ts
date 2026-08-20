import { LifecycleService } from './lifecycle.service';

describe('LifecycleService link-rot sweep', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rechecks NOT_FOUND online apply links and restores them when live', async () => {
    const prisma = {
      job: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'job-1',
            url: 'https://source.example/jobs/1',
            applyUrl: 'https://apply.example/jobs/1',
            urlStatus: 'NOT_FOUND',
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers() }) as any;

    const service = new LifecycleService(prisma, {} as any);

    const result = await service.sweepLinkRot();

    expect(result).toBe(0);
    expect(prisma.job.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', applyMethod: 'ONLINE_URL' },
      select: { id: true, url: true, applyUrl: true, urlStatus: true },
      take: 200,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://apply.example/jobs/1',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
    );
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({ urlStatus: 'OK', finalUrl: null }),
    });
  });
});