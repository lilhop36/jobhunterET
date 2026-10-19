// The liveness check validates every outbound URL (SSRF guard) and therefore
// resolves the hostname before fetching. Stub DNS so the test is hermetic and
// never performs a real lookup for a reserved `.example` domain.
jest.mock('node:dns', () => ({
  promises: {
    lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34' }]),
  },
}));

import { LifecycleService } from './lifecycle.service';

describe('LifecycleService link-rot sweep', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const makePrisma = (job: Record<string, unknown>) =>
    ({
      job: {
        findMany: jest.fn().mockResolvedValue([job]),
        update: jest.fn().mockResolvedValue({}),
      },
    }) as any;

  it('rechecks NOT_FOUND online apply links and restores them when live', async () => {
    const prisma = makePrisma({
      id: 'job-1',
      url: 'https://source.example/jobs/1',
      applyUrl: 'https://apply.example/jobs/1',
      urlStatus: 'NOT_FOUND',
    });
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

  it('refuses to fetch a link that points at a private address (SSRF guard)', async () => {
    const prisma = makePrisma({
      id: 'job-2',
      url: 'https://source.example/jobs/2',
      applyUrl: 'http://169.254.169.254/latest/meta-data/',
      urlStatus: 'OK',
    });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    const service = new LifecycleService(prisma, {} as any);

    await service.sweepLinkRot();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job-2' },
      data: expect.objectContaining({ urlStatus: 'UNSAFE' }),
    });
  });
});
