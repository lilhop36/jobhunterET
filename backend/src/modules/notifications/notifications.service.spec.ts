import { NotificationsService } from './notifications.service';

describe('NotificationsService — FR-024/FR-025/FR-027', () => {
  const mk = (over = {}) => {
    const telegram: any = { configured: true, sendMessage: jest.fn(), buildMatchText: jest.fn() };
    const prisma: any = {
      user: { findUnique: jest.fn() },
      job: { findUnique: jest.fn() },
      jobMatch: { findUnique: jest.fn() },
      notification: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    };
    const svc = new NotificationsService(prisma, telegram);
    return { svc, prisma, telegram, ...over };
  };

  const base = {
    user: { id: 'u1', notificationsPaused: false, telegramLink: { chatId: '12345' } },
    job: { id: 'j1', status: 'ACTIVE', title: 'Junior Backend Developer', company: 'ACME', location: 'Addis Ababa', workPlace: 'ONSITE', employmentType: 'FULL_TIME', url: 'https://x/job' },
    match: { score: 92, summary: 'Matches your profile', matchedSkills: ['Node.js'], missingSkills: ['AWS'], reasons: ['x'], job: null },
  };

  it('FR-025: linked user receives Telegram message containing summary + [Save][Reject][Apply][Open]', async () => {
    const { svc, prisma, telegram } = mk();
    prisma.user.findUnique.mockResolvedValue(base.user);
    prisma.job.findUnique.mockResolvedValueOnce({ status: 'ACTIVE' }).mockResolvedValueOnce(base.job);
    prisma.jobMatch.findUnique.mockResolvedValue(base.match);
    telegram.sendMessage.mockResolvedValue('SENT');

    // Real formatting is verified via TelegramService.buildMatchText; here we verify
    // the service composes it and attaches the inline keyboard with all four buttons.
    await svc.notifyForMatch('u1', 'j1', 92, 'Matches your profile');

    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, markup] = telegram.sendMessage.mock.calls[0];
    expect(chatId).toBe('12345');
    expect(markup.inline_keyboard[0].map((b: any) => b.text)).toEqual(['Save', 'Reject', 'Apply', 'Open']);
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: 'TELEGRAM', status: 'SENT' }) }),
    );
  });

  it('FR-024c: Telegram delivery failure falls back to the Web Inbox (UNREAD_WEB)', async () => {
    const { svc, prisma, telegram } = mk();
    prisma.user.findUnique.mockResolvedValue(base.user);
    prisma.job.findUnique.mockResolvedValueOnce({ status: 'ACTIVE' }).mockResolvedValueOnce(base.job);
    prisma.jobMatch.findUnique.mockResolvedValue(base.match);
    telegram.sendMessage.mockResolvedValue('FAILED');

    const r = await svc.notifyForMatch('u1', 'j1', 92, 'Matches your profile');

    expect(r).toBe('WEB');
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: 'WEB', status: 'UNREAD_WEB' }) }),
    );
  });

  it('FR-024: non-ACTIVE job is never notified', async () => {
    const { svc, prisma, telegram } = mk();
    prisma.user.findUnique.mockResolvedValue(base.user);
    prisma.job.findUnique.mockResolvedValue({ status: 'EXPIRED' });

    const r = await svc.notifyForMatch('u1', 'j1', 92, 'Matches your profile');

    expect(r).toBe('SKIPPED');
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('FR-027: same (userId, jobId) never delivered twice', async () => {
    const { svc, prisma, telegram } = mk();
    prisma.user.findUnique.mockResolvedValue(base.user);
    prisma.job.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.notification.findFirst.mockResolvedValue({ id: 'existing' });

    const r = await svc.notifyForMatch('u1', 'j1', 92, 'Matches your profile');

    expect(r).toBe('SKIPPED');
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('FR-024: paused user is never notified', async () => {
    const { svc, prisma, telegram } = mk();
    prisma.user.findUnique.mockResolvedValue({ ...base.user, notificationsPaused: true });

    const r = await svc.notifyForMatch('u1', 'j1', 92, 'Matches your profile');

    expect(r).toBe('SKIPPED');
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });
});
