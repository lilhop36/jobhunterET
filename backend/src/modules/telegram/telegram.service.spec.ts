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
