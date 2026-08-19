import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import {
  Page,
  decodeCursor,
  encodeCursor,
  keysetAfter,
  pageFrom,
  parseLimit,
} from '../../common/utils/keyset';

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class NotificationsService {
  /** SEC-003: per-(userId, jobId) in-process lock so overlapping cycles can't double-send. */
  private readonly pairLocks = new Map<string, Promise<unknown>>();

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
    // SEC-003: serialize delivery per (userId, jobId) so overlapping cycles
    // (collection, 10-min match cycle, profile recalc, manual recalc) cannot
    // double-send within this process. The unique DB constraint is the backstop
    // for any cross-process race.
    return this.serialized(`notify:${userId}:${jobId}`, () =>
      this.deliver(userId, jobId, score, summary),
    );
  }

  /** The actual delivery decision, run at most once per (userId, jobId) at a time. */
  private async deliver(
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

    // FR-027 / SEC-003: never repeat the same (userId, jobId) delivery — any row,
    // any status, counts as delivered. The unique (userId, jobId) constraint
    // enforces this even if two processes pass this check simultaneously.
    const existing = await this.prisma.notification.findFirst({
      where: { userId, jobId },
    });
    if (existing) return 'SKIPPED';

    // Telegram-first (FR-025); permanent failure falls back to the Web Inbox (FR-024c).
    if (user.telegramLink && this.telegram.configured) {
      const [jobFull, match] = await Promise.all([
        this.prisma.job.findUnique({ where: { id: jobId } }),
        this.prisma.jobMatch.findUnique({ where: { userId_jobId: { userId, jobId } } }),
      ]);
      if (jobFull && match) {
        const text = this.telegram.buildMatchText({
          score: match.score,
          summary: match.summary,
          matchedSkills: match.matchedSkills,
          missingSkills: match.missingSkills,
          job: {
            title: jobFull.title,
            company: jobFull.company,
            location: jobFull.location,
            workPlace: jobFull.workPlace,
            employmentType: jobFull.employmentType,
            url: jobFull.url,
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
          const recorded = await this.record({
            userId,
            jobId,
            channel: 'TELEGRAM',
            status: 'SENT',
            score,
            summary,
            sentAt: new Date(),
          });
          return recorded === 'ALREADY_EXISTS' ? 'SKIPPED' : 'SENT';
        }
      }
    }

    const recorded = await this.record({
      userId,
      jobId,
      channel: 'WEB',
      status: 'UNREAD_WEB',
      score,
      summary,
    });
    return recorded === 'ALREADY_EXISTS' ? 'SKIPPED' : 'WEB';
  }

  /**
   * Insert the delivery record. A unique-constraint violation (P2002) means a
   * concurrent producer already recorded this pair — treated as already-notified.
   */
  private async record(data: {
    userId: string;
    jobId: string;
    channel: 'TELEGRAM' | 'WEB';
    status: 'SENT' | 'UNREAD_WEB';
    score: number;
    summary?: string;
    sentAt?: Date;
  }): Promise<'RECORDED' | 'ALREADY_EXISTS'> {
    try {
      await this.prisma.notification.create({ data });
      return 'RECORDED';
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return 'ALREADY_EXISTS';
      }
      throw e;
    }
  }

  /** SEC-003: run one task at a time per key, within this process. */
  private async serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.pairLocks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn); // start after the previous task settles, whatever its outcome
    const tail = run.then(
      () => undefined,
      () => undefined, // keep the chain alive; errors surface to the caller via `run`
    );
    this.pairLocks.set(key, tail);
    tail.then(() => {
      if (this.pairLocks.get(key) === tail) this.pairLocks.delete(key);
    });
    return run;
  }

  /** PERF-002: keyset-paginated Web Inbox — stable (createdAt, id) ordering, total count. */
  async listInbox(userId: string, limitRaw?: string, cursorRaw?: string): Promise<Page<any>> {
    const where: any = { userId, channel: 'WEB' };
    const limit = parseLimit(limitRaw, PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeCursor(cursorRaw);
    const cursorWhere = cursor
      ? keysetAfter('createdAt', cursor.createdAt ?? null, cursor.id, 'desc')
      : null;

    const [total, rows] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where: cursorWhere ? { AND: [where, cursorWhere] } : where,
        include: { job: { select: { title: true, company: true, location: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    ]);

    const { items, nextCursor } = pageFrom(rows, limit, (last) =>
      encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }),
    );
    return {
      items: items.map((n) => ({
        id: n.id,
        jobId: n.jobId,
        title: n.job?.title,
        company: n.job?.company,
        location: n.job?.location,
        score: n.score,
        summary: n.summary,
        status: n.status,
        createdAt: n.createdAt,
      })),
      nextCursor,
      total,
    };
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
