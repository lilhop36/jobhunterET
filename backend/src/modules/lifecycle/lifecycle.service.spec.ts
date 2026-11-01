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


/**
 * FR-034a (SRS §23): a scheduled task every 6 hours marks overdue ACTIVE jobs
 * EXPIRED. The cadence itself is covered in lifecycle.tasks.spec.ts; here the
 * predicate is what matters — nothing else may change status.
 */
describe('LifecycleService.sweepExpired — FR-034a expiration sweeper', () => {
  it('marks only ACTIVE jobs whose deadline has already passed', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const service = new LifecycleService({ job: { updateMany } } as any, {} as any);
    const before = Date.now();

    expect(await service.sweepExpired()).toBe(3);

    const args = updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ status: 'ACTIVE', deadline: { lt: expect.any(Date) } });
    const cutoff = args.where.deadline.lt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before);
    expect(cutoff).toBeLessThanOrEqual(Date.now());
    expect(args.data).toEqual({ status: 'EXPIRED', statusChangedAt: expect.any(Date) });
  });

  it('reports zero and stays quiet when nothing is overdue', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const service = new LifecycleService({ job: { updateMany } } as any, {} as any);
    expect(await service.sweepExpired()).toBe(0);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});

/**
 * FR-037b / §25.2: the nightly retention archiver sheds bulk from old orphaned
 * jobs. It never hard-deletes — the row stays for audit, the payload goes.
 */
describe('LifecycleService.retentionArchive — FR-037b', () => {
  const originalDays = process.env.RETENTION_DAYS;
  afterEach(() => {
    if (originalDays === undefined) delete process.env.RETENTION_DAYS;
    else process.env.RETENTION_DAYS = originalDays;
  });

  const makePrisma = (rows: { id: string }[]) => ({
    job: {
      findMany: jest.fn().mockResolvedValue(rows),
      updateMany: jest.fn().mockResolvedValue({ count: rows.length }),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  });

  it('archives expired and removed jobs past the retention window that no application references', async () => {
    process.env.RETENTION_DAYS = '90';
    const prisma = makePrisma([{ id: 'job-old-1' }, { id: 'job-old-2' }]);
    const service = new LifecycleService(prisma as any, {} as any);

    expect(await service.retentionArchive()).toBe(2);

    const findMany = prisma.job.findMany.mock.calls[0][0];
    expect(findMany.where.status).toEqual({ in: ['EXPIRED', 'REMOVED'] });
    expect(findMany.where.archivedAt).toBeNull();
    expect(findMany.where.apps).toEqual({ none: {} });
    const cutoff = findMany.where.statusChangedAt.lt.getTime();
    expect(Math.round((Date.now() - cutoff) / 86_400_000)).toBe(90);

    const update = prisma.job.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: { in: ['job-old-1', 'job-old-2'] } });
    expect(update.data).toEqual({ archivedAt: expect.any(Date), rawData: null, description: null });
  });

  it('honours RETENTION_DAYS and never deletes rows', async () => {
    process.env.RETENTION_DAYS = '30';
    const prisma = makePrisma([{ id: 'job-x' }]);
    const service = new LifecycleService(prisma as any, {} as any);

    await service.retentionArchive();

    const findMany = prisma.job.findMany.mock.calls[0][0];
    expect(Math.round((Date.now() - findMany.where.statusChangedAt.lt.getTime()) / 86_400_000)).toBe(30);
    expect(prisma.job.delete).not.toHaveBeenCalled();
    expect(prisma.job.deleteMany).not.toHaveBeenCalled();
  });

  it('writes nothing when there is nothing to archive', async () => {
    const prisma = makePrisma([]);
    const service = new LifecycleService(prisma as any, {} as any);
    expect(await service.retentionArchive()).toBe(0);
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * FR-037c (SRS §23): purge SENT/READ notifications after 90 days, keep UNREAD_WEB
 * until the user reads it, and rotate SystemLog after 30 days.
 */
describe('LifecycleService.retentionNotificationsAndLogs — FR-037c', () => {
  const original = {
    notif: process.env.NOTIFICATION_RETENTION_DAYS,
    log: process.env.LOG_RETENTION_DAYS,
  };

  afterEach(() => {
    if (original.notif === undefined) delete process.env.NOTIFICATION_RETENTION_DAYS;
    else process.env.NOTIFICATION_RETENTION_DAYS = original.notif;
    if (original.log === undefined) delete process.env.LOG_RETENTION_DAYS;
    else process.env.LOG_RETENTION_DAYS = original.log;
  });

  const makePrisma = () => ({
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 14 }) },
    systemLog: { deleteMany: jest.fn().mockResolvedValue({ count: 40 }) },
  });

  const daysAgo = (ms: number) => Math.round((Date.now() - ms) / 86_400_000);

  it('purges only SENT and READ notifications, keeping unread ones', async () => {
    delete process.env.NOTIFICATION_RETENTION_DAYS;
    delete process.env.LOG_RETENTION_DAYS;
    const prisma = makePrisma();
    const service = new LifecycleService(prisma as any, {} as any);

    expect(await service.retentionNotificationsAndLogs()).toEqual({ notifications: 14, logs: 40 });

    const notifWhere = prisma.notification.deleteMany.mock.calls[0][0].where;
    expect(notifWhere.status.in).toEqual(['SENT', 'READ']);
    expect(notifWhere.status.in).not.toContain('UNREAD_WEB');
    expect(daysAgo(notifWhere.createdAt.lt.getTime())).toBe(90);
    expect(daysAgo(prisma.systemLog.deleteMany.mock.calls[0][0].where.at.lt.getTime())).toBe(30);
  });

  it('honours the retention overrides', async () => {
    process.env.NOTIFICATION_RETENTION_DAYS = '45';
    process.env.LOG_RETENTION_DAYS = '7';
    const prisma = makePrisma();
    const service = new LifecycleService(prisma as any, {} as any);

    await service.retentionNotificationsAndLogs();

    expect(daysAgo(prisma.notification.deleteMany.mock.calls[0][0].where.createdAt.lt.getTime())).toBe(45);
    expect(daysAgo(prisma.systemLog.deleteMany.mock.calls[0][0].where.at.lt.getTime())).toBe(7);
  });
});

/**
 * FR-037a (SRS §23): every match cycle records the funnel it walked, so ops can
 * see where jobs are lost between collection and delivery.
 */
describe('LifecycleService.runMatchCycle — FR-037a funnel metrics', () => {
  const funnel = {
    jobsEvaluated: 250,
    usersProcessed: 4,
    matchesCreated: 31,
    aboveThreshold: 12,
    sent: 9,
    toInbox: 3,
    skipped: 2,
  };

  it('writes one MatchCycle row with the full funnel', async () => {
    const matching = { matchUnmatchedJobs: jest.fn().mockResolvedValue({ ...funnel }) } as any;
    const create = jest.fn().mockResolvedValue({});
    const service = new LifecycleService({ matchCycle: { create } } as any, matching);

    await service.runMatchCycle();

    const data = create.mock.calls[0][0].data;
    expect(data).toEqual({
      jobsEvaluated: 250,
      usersProcessed: 4,
      matchesCreated: 31,
      aboveThreshold: 12,
      notificationsSent: 9,
      toInbox: 3,
      startedAt: expect.any(Date),
      finishedAt: expect.any(Date),
    });
    expect(data.finishedAt.getTime()).toBeGreaterThanOrEqual(data.startedAt.getTime());
  });

  it('records a zero cycle so a quiet run is still visible in the history', async () => {
    const zeros = {
      jobsEvaluated: 0,
      usersProcessed: 0,
      matchesCreated: 0,
      aboveThreshold: 0,
      sent: 0,
      toInbox: 0,
      skipped: 0,
    };
    const matching = { matchUnmatchedJobs: jest.fn().mockResolvedValue(zeros) } as any;
    const create = jest.fn().mockResolvedValue({});
    const service = new LifecycleService({ matchCycle: { create } } as any, matching);

    await service.runMatchCycle();
    expect(create.mock.calls[0][0].data).toMatchObject({
      jobsEvaluated: 0,
      matchesCreated: 0,
      notificationsSent: 0,
    });
  });

  it('does not record a cycle that never ran', async () => {
    const matching = {
      matchUnmatchedJobs: jest.fn().mockRejectedValue(new Error('scoring blew up')),
    } as any;
    const create = jest.fn();
    const service = new LifecycleService({ matchCycle: { create } } as any, matching);

    await expect(service.runMatchCycle()).rejects.toThrow('scoring blew up');
    expect(create).not.toHaveBeenCalled();
  });

  it('serves the latest cycle to the dashboard', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'cycle-9', jobsEvaluated: 250 });
    const service = new LifecycleService({ matchCycle: { findFirst } } as any, {} as any);

    await expect(service.latestCycle()).resolves.toMatchObject({ id: 'cycle-9' });
    expect(findFirst).toHaveBeenCalledWith({ orderBy: { startedAt: 'desc' } });
  });
});
