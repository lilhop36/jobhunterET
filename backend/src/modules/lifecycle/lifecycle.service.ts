import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly notifications: NotificationsService,
  ) {}

  /** FR-034a: mark past-deadline ACTIVE jobs EXPIRED. */
  async sweepExpired(): Promise<number> {
    const res = await this.prisma.job.updateMany({
      where: { status: 'ACTIVE', deadline: { lt: new Date() } },
      data: { status: 'EXPIRED', statusChangedAt: new Date() },
    });
    if (res.count) this.logger.log(`[SWEEPER] Marked ${res.count} job(s) EXPIRED (deadline passed)`);
    return res.count;
  }

  /** FR-015: safety net that REMOVEs ACTIVE jobs after 3 consecutive missed cycles. */
  async ghostDetect(): Promise<number> {
    const removed = await this.prisma.job.updateMany({
      where: { status: 'ACTIVE', missedCycles: { gte: 3 } },
      data: { status: 'REMOVED', statusChangedAt: new Date() },
    });
    if (removed.count) this.logger.log(`[GHOST] Marked ${removed.count} job(s) REMOVED (missedCycles >= 3)`);
    return removed.count;
  }

  /** FR-037b / §25.2: archive old orphaned EXPIRED/REMOVED jobs — purge bulky fields, never hard-delete. */
  async retentionArchive(): Promise<number> {
    const days = Number(process.env.RETENTION_DAYS ?? 90);
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const candidates = await this.prisma.job.findMany({
      where: {
        status: { in: ['EXPIRED', 'REMOVED'] },
        statusChangedAt: { lt: cutoff },
        archivedAt: null,
        apps: { none: {} },
        savedBy: { none: {} },
      },
      select: { id: true },
    });
    if (candidates.length) {
      await this.prisma.job.updateMany({
        where: { id: { in: candidates.map((c) => c.id) } },
        data: { archivedAt: new Date(), rawData: Prisma.DbNull, description: null },
      });
      this.logger.log(`[RETENTION] Archived ${candidates.length} orphaned job(s) (purged rawData/description)`);
    }
    return candidates.length;
  }

  /** FR-018/037a: run a match cycle across all users and record a MatchCycle. */
  async runMatchCycle(): Promise<void> {
    const start = Date.now();
    const users = await this.prisma.user.findMany();
    let evaluated = 0;
    let created = 0;
    let above = 0;
    let sent = 0;
    let toInbox = 0;

    for (const u of users) {
      const c = await this.matching.recalculate(u.id);
      created += c;
      const threshold = u.matchThreshold ?? 70;
      const matches = await this.prisma.jobMatch.findMany({
        where: { userId: u.id },
        select: { score: true, jobId: true, summary: true },
      });
      evaluated += matches.length;
      const aboveMatches = matches.filter((m) => m.score >= threshold);
      above += aboveMatches.length;
      for (const m of aboveMatches) {
        const r = await this.notifications.notifyForMatch(u.id, m.jobId, m.score, m.summary || '');
        if (r === 'SENT') sent++;
        if (r === 'WEB') toInbox++;
      }
    }

    await this.prisma.matchCycle.create({
      data: {
        jobsEvaluated: evaluated,
        usersProcessed: users.length,
        matchesCreated: created,
        aboveThreshold: above,
        notificationsSent: sent,
        toInbox,
        finishedAt: new Date(),
        startedAt: new Date(start),
      },
    });
    this.logger.log(`[MATCHER] cycle done: evaluations=${evaluated} above=${above} sent=${sent} inbox=${toInbox}`);
  }

  async latestCycle() {
    return this.prisma.matchCycle.findFirst({ orderBy: { startedAt: 'desc' } });
  }
}
