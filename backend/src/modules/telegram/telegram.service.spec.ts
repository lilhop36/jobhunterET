import { TelegramService } from './telegram.service';

describe('TelegramService — link codes (FR-003b)', () => {
  const prismaMock = {
    telegramLink: {
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: { update: jest.fn() },
    jobMatch: { count: jest.fn().mockResolvedValue(0) },
    savedJob: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    application: { count: jest.fn().mockResolvedValue(0), upsert: jest.fn() },
    job: { findUnique: jest.fn() },
    matchCycle: { findFirst: jest.fn().mockResolvedValue(null) },
  } as any;

  const svc = new TelegramService(prismaMock);

  it('createCode returns { code, expiresAt, deepLink } with the bot username', () => {
    process.env.TELEGRAM_BOT_USERNAME = 'JobHunterBot';
    const r = svc.createCode('u1');
    expect(r.code).toHaveLength(6);
    expect(r.expiresAt).toBeInstanceOf(Date);
    expect(r.deepLink).toBe(`https://t.me/JobHunterBot?start=${r.code}`);
    expect(r.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000); // ~10 min
  });

  it('rejects an expired code (FR-003b single-use + 10-min expiry)', () => {
    (svc as any).codes.set('EXPIRED', { userId: 'u1', expiresAt: Date.now() - 1000 });
    expect(svc.validateCode('EXPIRED')).toBeNull();
    expect(svc.consumeCode('EXPIRED')).toBeNull();
  });

  it('consumeCode is single-use — a used code is rejected on reuse', () => {
    (svc as any).codes.set('USED', { userId: 'u1', expiresAt: Date.now() + 60_000 });
    expect(svc.consumeCode('USED')).toEqual({ userId: 'u1' });
    expect(svc.consumeCode('USED')).toBeNull();
    expect(svc.validateCode('USED')).toBeNull();
  });

  it('an unknown code is rejected', () => {
    expect(svc.consumeCode('NOPE')).toBeNull();
  });

  it('FR-025a: callback [Save] stores against the LINKED user (chatId → userId)', async () => {
    const link = { userId: 'u-owned', chatId: '555', user: {} };
    const upsert = jest.fn().mockResolvedValue({});
    const prisma2 = {
      telegramLink: { findUnique: jest.fn().mockResolvedValue(link) },
      savedJob: { upsert },
      job: { findUnique: jest.fn().mockResolvedValue({ url: 'https://x' }) },
      application: { upsert: jest.fn() },
      matchCycle: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    const s2 = new TelegramService(prisma2);

    await (s2 as any).handleCallback(555, 'save:job-xyz', 'cb1');

    expect(upsert).toHaveBeenCalledWith({
      where: { userId_jobId: { userId: 'u-owned', jobId: 'job-xyz' } },
      create: { userId: 'u-owned', jobId: 'job-xyz' },
      update: {},
    });
  });

  it('FR-025b/§33: an unknown chatId receives no user data (linking prompt only)', async () => {
    const prisma2 = {
      telegramLink: { findUnique: jest.fn().mockResolvedValue(null) },
      savedJob: { upsert: jest.fn() },
      job: { findUnique: jest.fn() },
      application: { upsert: jest.fn() },
      matchCycle: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    const s2 = new TelegramService(prisma2);
    const answer = jest.spyOn(s2 as any, 'answerCallback').mockResolvedValue(undefined);

    await (s2 as any).handleCallback(999, 'save:job-xyz', 'cb2');

    expect(answer).toHaveBeenCalledWith('cb2', expect.stringContaining('Link your account first'));
    expect(prisma2.savedJob.upsert).not.toHaveBeenCalled();
  });
});

describe('TelegramService.throttle — SEC-005 atomic slot reservation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('serializes concurrent sends so they respect the global rate cap (no burst)', async () => {
    const prismaMock = { telegramLink: { updateMany: jest.fn().mockResolvedValue({}) } } as any;
    const svc = new TelegramService(prismaMock);
    (svc as any).botToken = 'test-token';
    (svc as any).globalRate = 20; // 50 ms minimum gap
    (svc as any).perChatInterval = 0; // isolate the global cap
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: {} }) } as any);

    const start = Date.now();
    const results = await Promise.all([
      svc.sendMessage('1', 'a'),
      svc.sendMessage('1', 'b'),
      svc.sendMessage('1', 'c'),
    ]);
    const elapsed = Date.now() - start;

    // 3 sends at 20 msg/s need 2 × 50 ms of spacing. A non-atomic limiter would
    // finish all three near-instantly; the reservation must serialize them.
    expect(results).toEqual(['SENT', 'SENT', 'SENT']);
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('TelegramService.buildMatchText — SEC-002 HTML escaping', () => {
  const svc = new TelegramService({} as any); // buildMatchText touches no DB state

  it('escapes source-controlled fields for Telegram HTML parse mode', () => {
    const text = svc.buildMatchText({
      score: 92,
      summary: 'Matches <b>your</b> profile & more',
      matchedSkills: ['Node.js', '<script>alert(1)</script>'],
      missingSkills: ['AWS & Azure'],
      job: {
        title: 'Junior <b>Backend</b> Developer & Co',
        company: 'ACME <i>Inc</i>',
        location: 'Addis Ababa & Remote',
        workPlace: 'ONSITE',
        employmentType: 'FULL_TIME',
        url: 'https://example.com/job?a=1&b=2',
      },
    });

    expect(text).toContain('Junior &lt;b&gt;Backend&lt;/b&gt; Developer &amp; Co');
    expect(text).toContain('ACME &lt;i&gt;Inc&lt;/i&gt;');
    expect(text).toContain('Addis Ababa &amp; Remote');
    expect(text).toContain('Matches &lt;b&gt;your&lt;/b&gt; profile &amp; more');
    expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(text).toContain('AWS &amp; Azure');
    expect(text).toContain('https://example.com/job?a=1&amp;b=2');
    expect(text).not.toContain('<b>');
  });
});

describe('TelegramService.poll — BUG-002 offset persistence + reentrancy', () => {
  it('onModuleInit loads persisted offset from BotState', async () => {
    const prisma = {
      botState: { findUnique: jest.fn().mockResolvedValue({ key: 'telegram:pollOffset', value: '42' }) },
    } as any;
    const svc = new TelegramService(prisma);
    await svc.onModuleInit();
    expect((svc as any).updateOffset).toBe(42);
    expect(prisma.botState.findUnique).toHaveBeenCalledWith({ where: { key: 'telegram:pollOffset' } });
  });

  it('onModuleInit leaves offset at 0 when no row exists', async () => {
    const prisma = {
      botState: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const svc = new TelegramService(prisma);
    await svc.onModuleInit();
    expect((svc as any).updateOffset).toBe(0);
  });

  it('pollOnce persists the offset after processing updates', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      botState: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert,
      },
      telegramLink: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const svc = new TelegramService(prisma);
    (svc as any).botToken = 'test-token';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ result: [{ update_id: 10, message: { chat: { id: 1 }, text: '/help' } }] }),
    } as any);
    jest.spyOn(svc as any, 'sendMessage').mockResolvedValue('SENT');

    await (svc as any).pollOnce();

    expect((svc as any).updateOffset).toBe(11);
    expect(upsert).toHaveBeenCalledWith({
      where: { key: 'telegram:pollOffset' },
      create: { key: 'telegram:pollOffset', value: '11' },
      update: { value: '11' },
    });
  });

  it('pollOnce skips DB write when no updates received', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      botState: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert,
      },
    } as any;
    const svc = new TelegramService(prisma);
    (svc as any).botToken = 'test-token';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ result: [] }),
    } as any);

    await (svc as any).pollOnce();

    expect(upsert).not.toHaveBeenCalled();
  });
});
