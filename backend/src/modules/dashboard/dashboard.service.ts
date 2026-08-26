import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
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
    const oneDayAgo = new Date(Date.now() - 86_400_000);

    try {
      // FIX #1: Use DB-level count() instead of fetching all rows into memory.
      // FIX #5: Moved telegramLink query into Promise.all (was a sequential 8th query).
      const [
        new24h,
        above,
        saved,
        inFlight,
        unread,
        profileView,
        latestCycle,
        latestDigest,
        telegramLink,
        recentNotifications,
        applications,
      ] = await Promise.all([
        // 1. DB-level count for new matches (24h)
        this.prisma.jobMatch.count({
          where: { userId, createdAt: { gte: oneDayAgo } },
        }),
        // 2. DB-level count for strong matches (score >= 70)
        this.prisma.jobMatch.count({
          where: { userId, score: { gte: 70 } },
        }),
        // 3. DB-level count for saved apps
        this.prisma.application.count({
          where: { userId, stage: 'SAVED' },
        }),
        // 4. DB-level count for in-flight apps
        this.prisma.application.count({
          where: { userId, stage: { in: ['APPLIED', 'ASSESSMENT', 'INTERVIEW'] } },
        }),
        // 5. Unread notifications
        this.notifications.unreadCount(userId),
        // 6. User profile
        this.profile.getProfile(userId),
        // 7. Latest global match cycle (only needed fields)
        this.prisma.matchCycle.findFirst({
          orderBy: { startedAt: 'desc' },
          select: {
            jobsEvaluated: true,
            matchesCreated: true,
            aboveThreshold: true,
            toInbox: true,
            notificationsSent: true,
            startedAt: true,
          },
        }),
        // 8. Latest user digest
        this.prisma.digest.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        }),
        // 9. Telegram link status (moved into parallel query)
        this.prisma.telegramLink.findUnique({ where: { userId } }),
        // 10. Recent notifications (only needed fields)
        this.prisma.notification.findMany({
          where: { userId, channel: 'WEB' },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            jobId: true,
            score: true,
            status: true,
            createdAt: true,
            job: { select: { title: true, company: true } },
          },
        }),
        // 11. Applications (only needed fields)
        this.prisma.application.findMany({
          where: { userId },
          select: { jobId: true, stage: true },
        }),
      ]);

      // FIX #3: Safely parse SQLite JSON fields and always return arrays
      const parseJson = (val: any): any[] => Array.isArray(val) ? val : this.prisma.parseJson(val) ?? [];

      return {
        greeting: 'Selam',
        // FIX #2: Optional chaining — profile may be null for new users
        completion: profileView?.completion ?? 0,
        onboardDone: profileView?.onboardDone ?? false,
        telegramLinked: !!telegramLink,
        counts: { new24h, above, saved, inFlight, unread },
        applications: applications.map((a) => ({ jobId: a.jobId, stage: a.stage })),
        recentNotifications: recentNotifications.map((n) => ({
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
              topMatches: parseJson(latestDigest.topMatches),
              searches: parseJson(latestDigest.searches),
            }
          : null,
      };
    } catch (err: any) {
      // FIX #4: Log with stack trace and throw HTTP 500 so frontend <ErrorBox onRetry> works
      this.logger.error(
        `[DASHBOARD] Summary failed for userId=${userId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException('Failed to load dashboard summary.');
    }
  }
}
