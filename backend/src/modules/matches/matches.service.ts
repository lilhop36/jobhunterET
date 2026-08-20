import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { NotificationsService } from '../notifications/notifications.service';
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
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly notifications: NotificationsService,
  ) {}

  /** PERF-002: keyset-paginated match feed — band filters push into the DB query. */
  async list(userId: string, filter?: string, limitRaw?: string, cursorRaw?: string): Promise<Page<any>> {
    // FR-015/FR-018: dead listings never surface in the match feed — only ACTIVE jobs.
    const where: any = { userId, job: { status: 'ACTIVE' } };
    if (filter === 'EXCELLENT') where.score = { gte: 90 };
    else if (filter === 'STRONG') where.score = { gte: 80, lt: 90 };
    else if (filter === 'GOOD') where.score = { gte: 70, lt: 80 };
    else if (filter === 'UNSEEN') {
      // §32.4: "Unseen" = matches the user has never been notified about.
      const notified = await this.prisma.notification.findMany({
        where: { userId },
        select: { jobId: true },
      });
      if (notified.length) where.jobId = { notIn: notified.map((n) => n.jobId) };
    }

    const limit = parseLimit(limitRaw, PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeCursor(cursorRaw);
    const cursorWhere = cursor
      ? keysetAfter('score', Number(cursor.score ?? 0), cursor.id, 'desc')
      : null;

    const [total, rows] = await Promise.all([
      this.prisma.jobMatch.count({ where }),
      this.prisma.jobMatch.findMany({
        where: cursorWhere ? { AND: [where, cursorWhere] } : where,
        include: {
          job: {
            include: { source: true, skills: { include: { skill: true } } },
          },
        },
        orderBy: [{ score: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    ]);

    const { items, nextCursor } = pageFrom(rows, limit, (last) =>
      encodeCursor({ score: last.score, id: last.id }),
    );
    return { items: items.map((m) => this.serializeMatch(m)), nextCursor, total };
  }

  private serializeMatch(m: any) {
    return {
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
    };
  }

  async recalculate(userId: string) {
    const created = await this.matching.recalculate(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const threshold = user?.matchThreshold ?? 75;
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
