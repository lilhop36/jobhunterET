import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';

const WINDOW_MS = 24 * 60 * 60 * 1000; // FR-028: daily report window

interface DigestReport {
  jobsCollected: number;
  newJobs: number;
  strongMatches: number;
  topMatches: {
    jobId: string;
    title: string;
    company: string;
    score: number;
    summary: string | null;
  }[];
  searches: { name: string; hits: number }[];
}

/** FR-028 / FR-033: per-user daily digest — runs saved searches over the last 24h of collected jobs. */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  async latestFor(userId: string) {
    const [user, last] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { digestEnabled: true } }),
      this.prisma.digest.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      enabled: user?.digestEnabled ?? true,
      last: last
        ? {
            at: last.createdAt,
            status: last.status,
            deliveredTo: last.deliveredTo,
            jobsCollected: last.jobsCollected,
            newJobs: last.newJobs,
            strongMatches: last.strongMatches,
            topMatches: last.topMatches,
            searches: last.searches,
          }
        : null,
    };
  }

  /** Scheduled (FR-028) + manual (POST /digest/run) entry point for one user. */
  async runForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { telegramLink: true, searches: true },
    });
    if (!user) return null;

    const report = await this.buildReport(user.id, user.searches);
    const hasContent = report.newJobs > 0 || report.strongMatches > 0 || report.searches.length > 0;

    // Always record the run so the dashboard card / Searches page can show last-run status.
    let digest = await this.prisma.digest.create({
      data: {
        userId: user.id,
        jobsCollected: report.jobsCollected,
        newJobs: report.newJobs,
        strongMatches: report.strongMatches,
        topMatches: report.topMatches,
        searches: report.searches,
        deliveredTo: 'WEB',
        status: hasContent ? 'SENT' : 'NO_CONTENT',
      },
    });

    if (!hasContent) return this.serialize(digest);

    // Telegram-first (FR-028); on failure fall back to the Web Inbox (FR-024c).
    if (user.telegramLink && this.telegram.configured) {
      const text = this.buildDigestText(report);
      const result = await this.telegram.sendMessage(user.telegramLink.chatId, text);
      if (result === 'SENT') {
        digest = await this.prisma.digest.update({
          where: { id: digest.id },
          data: { deliveredTo: 'TELEGRAM', status: 'SENT' },
        });
        this.logger.log(`[DIGEST] sent to Telegram userId=${userId}`);
        return this.serialize(digest);
      }
      this.logger.warn(`[DIGEST] Telegram failed for userId=${userId} — falling back to Web Inbox`);
    }

    // Web: push only QUALIFYING top matches into the Inbox (FR-024: score >= the
    // user's threshold; FR-027 dedup: no repeats). Sub-threshold matches are report
    // content only — they must never surface as alerts.
    for (const m of report.topMatches) {
      if (m.score >= user.matchThreshold) {
        await this.ensureWebNotification(user.id, m);
      }
    }
    this.logger.log(`[DIGEST] recorded userId=${userId} newJobs=${report.newJobs} strong=${report.strongMatches}`);
    return this.serialize(digest);
  }

  /** Scheduled entry point: every user with the digest on and notifications not paused. */
  async runAll() {
    const users = await this.prisma.user.findMany({
      where: { digestEnabled: true, notificationsPaused: false },
      select: { id: true },
    });
    let ok = 0;
    for (const u of users) {
      try {
        await this.runForUser(u.id);
        ok++;
      } catch (e) {
        this.logger.error(`[DIGEST] failed for userId=${u.id}`, e as Error);
      }
    }
    this.logger.log(`[DIGEST] run complete: ${ok}/${users.length} users processed`);
  }

  /* ------------------------------------------------------------------ */
  /* Report construction                                                */
  /* ------------------------------------------------------------------ */

  private async buildReport(
    userId: string,
    searches: { id: string; name: string; q: string | null; tier: string; remote: boolean }[],
  ): Promise<DigestReport> {
    const since = new Date(Date.now() - WINDOW_MS);
    const windowJobs = await this.prisma.job.findMany({
      where: { firstSeenAt: { gte: since } },
      include: { skills: { include: { skill: true } }, source: { select: { name: true } } },
    });
    const active = windowJobs.filter((j) => j.status === 'ACTIVE');
    const jobIds = active.map((j) => j.id);

    const matches = await this.prisma.jobMatch.findMany({
      where: { userId, jobId: { in: jobIds } },
    });
    const byJob = new Map(matches.map((m) => [m.jobId, m]));
    const strongMatches = matches.filter((m) => m.score >= 80).length;

    const topMatches = [...matches]
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((m) => {
        const job = active.find((j) => j.id === m.jobId);
        return {
          jobId: m.jobId,
          title: job?.title ?? 'Job',
          company: job?.company ?? '',
          score: m.score,
          summary: m.summary,
        };
      });

    // FR-033: auto-execute each saved search over the window's job pool.
    const searchHits: { name: string; hits: number }[] = [];
    for (const s of searches) {
      const hits = active.filter((job) => this.matchesSearch(job, s, byJob)).length;
      if (hits > 0) searchHits.push({ name: s.name, hits });
    }

    return { jobsCollected: windowJobs.length, newJobs: active.length, strongMatches, topMatches, searches: searchHits };
  }

  /** Keyword (title/company/skills) + remote flag + tier-as-score-band (HIGH≥80, MEDIUM≥70, LOW≥60). */
  private matchesSearch(
    job: { id: string; title: string; company: string; skills: { skill: { name: string } }[]; workPlace: string },
    search: { q: string | null; tier: string; remote: boolean },
    byJob: Map<string, { score: number }>,
  ): boolean {
    if (search.remote && job.workPlace !== 'REMOTE') return false;
    const q = (search.q ?? '').trim().toLowerCase();
    if (q) {
      const haystack = [job.title, job.company, ...job.skills.map((s) => s.skill.name)].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    const tier = search.tier.toUpperCase();
    if (tier === 'ALL') return true;
    const score = byJob.get(job.id)?.score ?? 0;
    if (tier === 'HIGH') return score >= 80;
    if (tier === 'MEDIUM') return score >= 70;
    if (tier === 'LOW') return score >= 60;
    return true;
  }

  /** FR-027: no repeat (userId, jobId) Web Inbox rows. */
  private async ensureWebNotification(
    userId: string,
    m: { jobId: string; score: number; summary: string | null },
  ) {
    const existing = await this.prisma.notification.findFirst({
      where: { userId, jobId: m.jobId, status: { in: ['SENT', 'UNREAD_WEB'] } },
    });
    if (existing) return;
    await this.prisma.notification.create({
      data: { userId, jobId: m.jobId, channel: 'WEB', status: 'UNREAD_WEB', score: m.score, summary: m.summary },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Formatting                                                         */
  /* ------------------------------------------------------------------ */

  private buildDigestText(report: DigestReport): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const appUrl = process.env.APP_URL || 'https://app.jobhunter.et';
    const lines = [
      `📅 JobHunter daily digest — ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
      ``,
      `Jobs collected: ${report.jobsCollected} · New jobs: ${report.newJobs} · Strong/excellent matches: ${report.strongMatches}`,
    ];
    if (report.searches.length) {
      lines.push(``, `Saved searches:`);
      for (const s of report.searches) lines.push(`• ${esc(s.name)} → ${s.hits} new hit${s.hits === 1 ? '' : 's'}`);
    }
    if (report.topMatches.length) {
      lines.push(``, `Top matches:`);
      report.topMatches.forEach((m, i) => {
        lines.push(`${i + 1}. ${esc(m.title)} — ${esc(m.company)} · ${m.score}%`);
      });
    }
    lines.push(``, `Full report: ${appUrl}/dashboard`);
    return lines.join('\n');
  }

  private serialize(digest: any) {
    return {
      id: digest.id,
      at: digest.createdAt,
      status: digest.status,
      deliveredTo: digest.deliveredTo,
      jobsCollected: digest.jobsCollected,
      newJobs: digest.newJobs,
      strongMatches: digest.strongMatches,
      topMatches: digest.topMatches,
      searches: digest.searches,
    };
  }
}
