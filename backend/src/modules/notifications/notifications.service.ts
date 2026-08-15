import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  /** FR-024 / FR-024c: deliver a qualifying match — Telegram when linked & configured, else Web Inbox. */
  async notifyForMatch(
    userId: string,
    jobId: string,
    score: number,
    summary: string,
  ): Promise<'SENT' | 'WEB' | 'SKIPPED'> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { telegramLink: true },
    });
    if (!user) return 'SKIPPED';
    if (user.notificationsPaused) return 'SKIPPED';

    // FR-024: only ACTIVE jobs are ever notified (REMOVED/EXPIRED are excluded).
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!job || job.status !== 'ACTIVE') return 'SKIPPED';

    // FR-027: never repeat the same (userId, jobId) delivery.
    const existing = await this.prisma.notification.findFirst({
      where: { userId, jobId, status: { in: ['SENT', 'UNREAD_WEB'] } },
    });
    if (existing) return 'SKIPPED';

    // Telegram-first (FR-025); permanent failure falls back to the Web Inbox (FR-024c).
    if (user.telegramLink && this.telegram.configured) {
      const [job, match] = await Promise.all([
        this.prisma.job.findUnique({ where: { id: jobId } }),
        this.prisma.jobMatch.findUnique({ where: { userId_jobId: { userId, jobId } } }),
      ]);
      if (job && match) {
        const text = this.telegram.buildMatchText({
          score: match.score,
          summary: match.summary,
          matchedSkills: match.matchedSkills,
          missingSkills: match.missingSkills,
          job: {
            title: job.title,
            company: job.company,
            location: job.location,
            workPlace: job.workPlace,
            employmentType: job.employmentType,
            url: job.url,
          },
        });
        const markup = {
          inline_keyboard: [
            [
              { text: 'Save', callback_data: `save:${jobId}` },
              { text: 'Reject', callback_data: `reject:${jobId}` },
              { text: 'Apply', callback_data: `apply:${jobId}` },
              { text: 'Open', callback_data: `open:${jobId}` },
            ],
          ],
        };
        const result = await this.telegram.sendMessage(user.telegramLink.chatId, text, markup);
        if (result === 'SENT') {
          await this.prisma.notification.create({
            data: { userId, jobId, channel: 'TELEGRAM', status: 'SENT', score, summary, sentAt: new Date() },
          });
          return 'SENT';
        }
      }
    }

    await this.prisma.notification.create({
      data: { userId, jobId, channel: 'WEB', status: 'UNREAD_WEB', score, summary },
    });
    return 'WEB';
  }

  async listInbox(userId: string) {
    const items = await this.prisma.notification.findMany({
      where: { userId, channel: 'WEB' },
      include: { job: { select: { title: true, company: true, location: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((n) => ({
      id: n.id,
      jobId: n.jobId,
      title: n.job?.title,
      company: n.job?.company,
      location: n.job?.location,
      score: n.score,
      summary: n.summary,
      status: n.status,
      createdAt: n.createdAt,
    }));
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, channel: 'WEB' },
      data: { status: 'READ' },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, channel: 'WEB' },
      data: { status: 'READ' },
    });
    return { ok: true };
  }

  async unreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, channel: 'WEB', status: 'UNREAD_WEB' },
    });
  }

  async preview(userId: string, threshold: number) {
    const matches = await this.prisma.jobMatch.findMany({
      where: { userId, score: { gte: threshold } },
    });
    return { threshold, projected: matches.length };
  }
}
