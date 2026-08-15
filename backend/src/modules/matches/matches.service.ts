import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(userId: string, filter?: string) {
    // FR-015/FR-018: dead listings never surface in the match feed — only ACTIVE jobs.
    const matches = await this.prisma.jobMatch.findMany({
      where: { userId, job: { status: 'ACTIVE' } },
      include: {
        job: {
          include: { source: true, skills: { include: { skill: true } } },
        },
      },
      orderBy: { score: 'desc' },
    });

    let rows = matches.filter((m) => {
      if (filter === 'ALL' || !filter) return true;
      if (filter === 'EXCELLENT') return m.score >= 90;
      if (filter === 'STRONG') return m.score >= 80 && m.score < 90;
      if (filter === 'GOOD') return m.score >= 70 && m.score < 80;
      return true;
    });

    // §32.4: "Unseen" = matches the user has never been notified about.
    if (filter === 'UNSEEN') {
      const notified = await this.prisma.notification.findMany({
        where: { userId },
        select: { jobId: true },
      });
      const seen = new Set(notified.map((n) => n.jobId));
      rows = rows.filter((m) => !seen.has(m.jobId));
    }

    return rows
      .map((m) => ({
        jobId: m.jobId,
        score: m.score,
        roleTarget: null,
        matchedSkills: m.matchedSkills,
        relatedSkills: m.relatedSkills,
        missingSkills: m.missingSkills,
        reasons: m.reasons,
        summary: m.summary,
        job: {
          id: m.job.id,
          title: m.job.title,
          company: m.job.company,
          location: m.job.location,
          locationClass: m.job.locationClass,
          employmentType: m.job.employmentType,
          experienceLevel: m.job.experienceLevel,
          url: m.job.url,
          parseConfidence: m.job.parseConfidence,
          postedDate: m.job.postedDate,
          status: m.job.status,
          source: m.job.source.name,
          skills: m.job.skills.map((s) => s.skill.name),
        },
      }));
  }

  async recalculate(userId: string) {
    const created = await this.matching.recalculate(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const threshold = user?.matchThreshold ?? 70;
    const matches = await this.prisma.jobMatch.findMany({
      where: { userId, score: { gte: threshold } },
      select: { jobId: true, score: true, summary: true },
    });
    let delivered = 0;
    for (const m of matches) {
      const r = await this.notifications.notifyForMatch(userId, m.jobId, m.score, m.summary || '');
      if (r !== 'SKIPPED') delivered++;
    }
    return { recalculated: true, matchesTouched: created, notificationsDelivered: delivered };
  }
}
