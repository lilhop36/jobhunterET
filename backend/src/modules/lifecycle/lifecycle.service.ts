import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';

@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
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

  /** FR-018/037a: incremental match cycle — scores only unmatched ACTIVE jobs and records a MatchCycle. */
  async runMatchCycle(): Promise<void> {
    const start = Date.now();
    const o = await this.matching.matchUnmatchedJobs();
    await this.prisma.matchCycle.create({
      data: {
        jobsEvaluated: o.jobsEvaluated,
        usersProcessed: o.usersProcessed,
        matchesCreated: o.matchesCreated,
        aboveThreshold: o.aboveThreshold,
        notificationsSent: o.sent,
        toInbox: o.toInbox,
        finishedAt: new Date(),
        startedAt: new Date(start),
      },
    });
    this.logger.log(
      `[MATCHER] cycle done: jobs=${o.jobsEvaluated} users=${o.usersProcessed} created=${o.matchesCreated} above=${o.aboveThreshold} sent=${o.sent} inbox=${o.toInbox}`,
    );
  }

  async latestCycle() {
    return this.prisma.matchCycle.findFirst({ orderBy: { startedAt: 'desc' } });
  }
}
