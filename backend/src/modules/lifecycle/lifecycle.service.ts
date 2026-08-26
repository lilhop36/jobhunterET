import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { execFile } from 'child_process';
import { access } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { checkUrlLiveness } from '../jobs/job-fidelity';

const execFileAsync = promisify(execFile);

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
      },
      select: { id: true },
    });
    if (candidates.length) {
      await this.prisma.job.updateMany({
        where: { id: { in: candidates.map((c) => c.id) } },
        data: { archivedAt: new Date(), rawData: null, description: null },
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

  /** FR-034d: mark users inactive beyond DORMANT_AFTER_DAYS as DORMANT. */
  async sweepDormant(): Promise<number> {
    const days = Number(process.env.DORMANT_AFTER_DAYS ?? 30);
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const res = await this.prisma.user.updateMany({
      where: {
        status: 'ACTIVE',
        lastActiveAt: { lt: cutoff },
      },
      data: { status: 'DORMANT' },
    });
    if (res.count) this.logger.log(`[DORMANT] Marked ${res.count} user(s) DORMANT (inactive > ${days} days)`);
    return res.count;
  }

  /** FR-034c: recheck ONLINE_URL apply links for ACTIVE jobs, including recovery from NOT_FOUND. */
  async sweepLinkRot(): Promise<number> {
    const maxPerCycle = Number(process.env.LINK_ROT_MAX_PER_CYCLE ?? 200);
    const jobs = await this.prisma.job.findMany({
      where: {
        status: 'ACTIVE',
        applyMethod: 'ONLINE_URL',
      },
      select: { id: true, url: true, applyUrl: true, urlStatus: true },
      take: maxPerCycle,
    });

    let notFound = 0;
    let recovered = 0;
    for (const job of jobs) {
      const url = job.applyUrl || job.url;
      const result = await checkUrlLiveness(url);
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          urlStatus: result.urlStatus,
          urlCheckedAt: new Date(),
          finalUrl: result.finalUrl ?? null,
        },
      });
      if (result.urlStatus === 'NOT_FOUND') {
        notFound++;
        if (job.urlStatus !== 'NOT_FOUND') {
          this.logger.log(`[LINKCHECK] Job ${job.id}: NOT_FOUND`);
        }
      } else if (result.urlStatus === 'OK' && job.urlStatus === 'NOT_FOUND') {
        recovered++;
        this.logger.log(`[LINKCHECK] Job ${job.id}: recovered`);
      } else if (result.urlStatus === 'ERROR') {
        this.logger.warn(`[LINKCHECK] Job ${job.id}: ERROR`);
      }
    }
    if (notFound || recovered) {
      this.logger.log(`[LINKCHECK] Sweep done: ${notFound} NOT_FOUND, ${recovered} recovered`);
    }
    return notFound;
  }

  /** NFR-008: run the PostgreSQL + uploads backup script. */
  async runBackup(): Promise<{ ok: boolean; skipped?: boolean; output?: string }> {
    const scriptPath = join(process.cwd(), 'scripts', 'backup.sh');
    try {
      await access(scriptPath);
    } catch {
      this.logger.warn(`[BACKUP] Script not found at ${scriptPath}; skipping backup`);
      return { ok: false, skipped: true };
    }

    try {
      const { stdout, stderr } = await execFileAsync('bash', [scriptPath], {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 1024 * 1024,
      });
      const output = [stdout, stderr].filter(Boolean).join('\n').slice(-4000);
      this.logger.log('[BACKUP] Nightly backup completed');
      return { ok: true, output };
    } catch (e: any) {
      const output = [e?.stdout, e?.stderr, e?.message].filter(Boolean).join('\n').slice(-4000);
      this.logger.error('[BACKUP] Nightly backup failed', output);
      return { ok: false, output };
    }
  }

  /** FR-037c: purge SENT/READ notifications older than 90 days; rotate SystemLog older than 30 days. */
  async retentionNotificationsAndLogs(): Promise<{ notifications: number; logs: number }> {
    const notifDays = Number(process.env.NOTIFICATION_RETENTION_DAYS ?? 90);
    const logDays = Number(process.env.LOG_RETENTION_DAYS ?? 30);
    const notifCutoff = new Date(Date.now() - notifDays * 86_400_000);
    const logCutoff = new Date(Date.now() - logDays * 86_400_000);

    const notifRes = await this.prisma.notification.deleteMany({
      where: {
        status: { in: ['SENT', 'READ'] },
        createdAt: { lt: notifCutoff },
      },
    });
    const logRes = await this.prisma.systemLog.deleteMany({
      where: { at: { lt: logCutoff } },
    });

    if (notifRes.count) this.logger.log(`[RETENTION] Purged ${notifRes.count} old notification(s)`);
    if (logRes.count) this.logger.log(`[RETENTION] Rotated ${logRes.count} old SystemLog entry/entries)`);
    return { notifications: notifRes.count, logs: logRes.count };
  }
}
