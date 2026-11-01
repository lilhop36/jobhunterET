import { DigestService } from './digest.service';

/**
 * FR-028 (SRS §21): the daily digest is generated per user over the last 24 hours
 * of collected jobs, delivered Telegram-first, and — when Telegram is not
 * available — pushed into the Web Inbox as qualifying alerts only.
 */
describe('DigestService — FR-028 daily digest (per user)', () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  function makePrisma(options: {
    user?: any;
    jobs?: any[];
    matches?: any[];
    existingNotifications?: any[];
    users?: any[];
  } = {}) {
    const user = 'user' in options ? options.user : {
      id: 'user-1',
      matchThreshold: 65,
      digestEnabled: 1,
      notificationsPaused: 0,
      telegramLink: null,
      searches: [],
    };
    const created: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        findMany: jest.fn().mockResolvedValue(options.users ?? []),
      },
      job: {
        findMany: jest.fn().mockResolvedValue(options.jobs ?? [
          { id: 'job-1', status: 'ACTIVE', title: 'M&E Officer', company: 'IRC', workPlace: 'REMOTE', skills: [], source: { name: 'ReliefWeb' } },
          { id: 'job-2', status: 'ACTIVE', title: 'Driver', company: 'UNMISS', workPlace: 'ONSITE', skills: [], source: { name: 'Ethiojobs' } },
        ]),
      },
      jobMatch: {
        findMany: jest.fn().mockResolvedValue(options.matches ?? [
          { jobId: 'job-1', score: 92, summary: 'Strong fit' },
          { jobId: 'job-2', score: 58, summary: 'Below your threshold' },
        ]),
      },
      digest: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: 'digest-1', createdAt: new Date(), ...data };
          created.push(row);
          return row;
        }),
        update: jest.fn(async ({ data }: any) => ({ id: 'digest-1', createdAt: new Date(), ...created[0], ...data })),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      notification: {
        findFirst: jest.fn().mockResolvedValue(options.existingNotifications?.[0] ?? null),
        create: jest.fn(async ({ data }: any) => ({ id: 'notif-1', ...data })),
      },
      json: (v: any) => JSON.stringify(v ?? []),
      parseJson: (v: any) => (typeof v === 'string' ? JSON.parse(v) : v ?? []),
      bool: (v: boolean) => (v ? 1 : 0),
    };
    return { prisma, created };
  }

  const telegram = (configured: boolean, sendResult = 'SENT') => {
    const svc: any = { configured, sendMessage: jest.fn().mockResolvedValue(sendResult) };
    return svc;
  };

  it('delivers to Telegram first when the user has a linked account', async () => {
    const { prisma } = makePrisma({
      user: { id: 'user-1', matchThreshold: 65, telegramLink: { chatId: '7712' }, searches: [] },
    });
    const tg = telegram(true);
    const service = new DigestService(prisma, tg);

    const result: any = await service.runForUser('user-1');

    expect(tg.sendMessage).toHaveBeenCalledWith('7712', expect.stringContaining('JobHunter daily digest'));
    expect(prisma.digest.update).toHaveBeenCalledWith({
      where: { id: 'digest-1' },
      data: { deliveredTo: 'TELEGRAM', status: 'SENT' },
    });
    expect(result.deliveredTo).toBe('TELEGRAM');
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('falls back to the Web Inbox and only alerts matches above the user threshold', async () => {
    const { prisma } = makePrisma();
    const tg = telegram(false);
    const service = new DigestService(prisma, tg);

    const result: any = await service.runForUser('user-1');

    expect(tg.sendMessage).not.toHaveBeenCalled();
    const alerted = prisma.notification.create.mock.calls.map((c: any[]) => c[0].data.jobId);
    expect(alerted).toEqual(['job-1']); // 92 >= 65; the 58-score job stays report-only
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', channel: 'WEB', status: 'UNREAD_WEB', score: 92 }),
    });
    expect(result.deliveredTo).toBe('WEB');
  });

  it('never re-alerts a job the user has already been notified about', async () => {
    const { prisma } = makePrisma({ existingNotifications: [{ id: 'notif-old', jobId: 'job-1' }] });
    const service = new DigestService(prisma, telegram(false));

    await service.runForUser('user-1');
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('records the run as NO_CONTENT when the 24-hour window has nothing to say', async () => {
    const { prisma, created } = makePrisma({ jobs: [], matches: [] });
    const tg = telegram(true);
    const service = new DigestService(prisma, tg);

    const result: any = await service.runForUser('user-1');

    expect(result.status).toBe('NO_CONTENT');
    expect(tg.sendMessage).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    const since = prisma.job.findMany.mock.calls[0][0].where.firstSeenAt.gte.getTime();
    expect(Math.round((Date.now() - since) / DAY)).toBe(1); // the report window is one day
    expect(created[0]).toMatchObject({ jobsCollected: 0, newJobs: 0, strongMatches: 0 });
  });

  it('counts a strong match at 80 or above and reports saved-search hits', async () => {
    const { prisma } = makePrisma({
      user: {
        id: 'user-1',
        matchThreshold: 65,
        telegramLink: null,
        searches: [{ id: 's-1', name: 'Remote M&E', q: 'monitoring', tier: 'HIGH', remote: true }],
      },
      jobs: [
        { id: 'job-1', status: 'ACTIVE', title: 'Monitoring Officer', company: 'IRC', workPlace: 'REMOTE', skills: [], source: { name: 'ReliefWeb' } },
        { id: 'job-2', status: 'EXPIRED', title: 'Monitoring Officer', company: 'NRC', workPlace: 'REMOTE', skills: [], source: { name: 'ReliefWeb' } },
      ],
      matches: [{ jobId: 'job-1', score: 84, summary: 'Good fit' }],
    });
    const service = new DigestService(prisma, telegram(false));

    const result: any = await service.runForUser('user-1');

    expect(result.strongMatches).toBe(1);
    expect(result.newJobs).toBe(1); // the EXPIRED twin is not counted as new
    expect(result.searches).toEqual([{ name: 'Remote M&E', hits: 1 }]);
  });

  it('runAll walks only users who keep the digest on and have not paused notifications', async () => {
    const { prisma } = makePrisma({ users: [{ id: 'user-1' }, { id: 'user-2' }] });
    const service = new DigestService(prisma, telegram(false));
    const runForUser = jest.spyOn(service, 'runForUser').mockResolvedValue({ id: 'd' } as any);

    await service.runAll();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { digestEnabled: 1, notificationsPaused: 0 },
      select: { id: true },
    });
    expect(runForUser.mock.calls.map((c) => c[0])).toEqual(['user-1', 'user-2']);
  });

  it('one failing user does not stop the rest of the digest run', async () => {
    const { prisma } = makePrisma({ users: [{ id: 'user-1' }, { id: 'user-2' }, { id: 'user-3' }] });
    const service = new DigestService(prisma, telegram(false));
    jest
      .spyOn(service, 'runForUser')
      .mockImplementationOnce(() => Promise.reject(new Error('telegram timeout')))
      .mockResolvedValue({ id: 'd' } as any);
    const logged: string[] = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: any) => {
      logged.push(String(chunk));
      return true;
    }) as any);

    await service.runAll();

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(logged.join('')).toContain('failed for userId=user-1');
    spy.mockRestore();
  });

  it('generates nothing for an id that is not a user', async () => {
    const { prisma } = makePrisma({ user: null });
    const service = new DigestService(prisma, telegram(true));
    await expect(service.runForUser('ghost')).resolves.toBeNull();
    expect(prisma.digest.create).not.toHaveBeenCalled();
  });
});
