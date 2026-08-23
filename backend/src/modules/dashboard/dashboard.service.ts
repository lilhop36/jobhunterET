import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileService } from '../profile/profile.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profile: ProfileService,
    private readonly notifications: NotificationsService,
  ) {}

  async summary(userId: string) {
    try {
      const [matches, saved, apps, unread, profileView, latestCycle, latestDigest] = await Promise.all([
        this.prisma.jobMatch.findMany({ where: { userId } }),
        this.prisma.application.count({ where: { userId, stage: 'SAVED' } }),
        this.prisma.application.findMany({ where: { userId } }),
        this.notifications.unreadCount(userId),
        this.profile.getProfile(userId),
        this.prisma.matchCycle.findFirst({ orderBy: { startedAt: 'desc' } }),
        this.prisma.digest.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      ]);

      const new24h = matches.filter(
        (m) => Date.now() - m.createdAt.getTime() < 86_400_000,
      ).length;
      const above = matches.filter((m) => m.score >= 70).length;
      const inFlight = apps.filter((a) =>
        ['APPLIED', 'ASSESSMENT', 'INTERVIEW'].includes(a.stage),
      ).length;
      const recent = await this.prisma.notification.findMany({
        where: { userId, channel: 'WEB' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { job: { select: { title: true, company: true } } },
      });

      return {
        greeting: 'Selam',
        completion: profileView.completion,
        onboardDone: profileView.onboardDone,
        telegramLinked: !!(await this.prisma.telegramLink.findUnique({ where: { userId } })),
        counts: { new24h, above, saved, inFlight, unread },
        applications: apps.map((a) => ({ jobId: a.jobId, stage: a.stage })),
        recentNotifications: recent.map((n) => ({
          id: n.id,
          jobId: n.jobId,
          title: n.job?.title,
          company: n.job?.company,
          score: n.score,
          status: n.status,
          createdAt: n.createdAt,
        })),
        lastCycle: latestCycle
          ? {
              jobsEvaluated: latestCycle.jobsEvaluated,
              matchesCreated: latestCycle.matchesCreated,
              aboveThreshold: latestCycle.aboveThreshold,
              toInbox: latestCycle.toInbox,
              sent: latestCycle.notificationsSent,
              at: latestCycle.startedAt,
            }
          : null,
        digest: latestDigest
          ? {
              at: latestDigest.createdAt,
              status: latestDigest.status,
              deliveredTo: latestDigest.deliveredTo,
              jobsCollected: latestDigest.jobsCollected,
              newJobs: latestDigest.newJobs,
              strongMatches: latestDigest.strongMatches,
              topMatches: latestDigest.topMatches,
              searches: latestDigest.searches,
            }
          : null,
      };
    } catch (err: any) {
      this.logger.warn(`[DASHBOARD] Summary failed for userId=${userId}: ${err.message}`);
      // Return empty defaults so the frontend renders instead of showing 500
      return {
        greeting: 'Selam',
        completion: 0,
        onboardDone: false,
        telegramLinked: false,
        counts: { new24h: 0, above: 0, saved: 0, inFlight: 0, unread: 0 },
        applications: [],
        recentNotifications: [],
        lastCycle: null,
        digest: null,
      };
    }
  }
}
