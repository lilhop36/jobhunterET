import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SalaryService } from '../salary/salary.service';
import { getAllTags } from '../sources/source-classifier';
import {
  Page,
  decodeCursor,
  encodeCursor,
  keysetAfter,
  pageFrom,
  parseLimit,
} from '../../common/utils/keyset';

export interface JobFilter {
  q?: string;
  tier?: string;
  type?: string;
  workplace?: string;
  source?: string;
  tag?: string;
  sort?: 'newest' | 'deadline';
  showDead?: boolean;
  userId?: string;
  limit?: string;
  cursor?: string;
}

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class JobsService {
  // 60-second in-memory cache for tagCounts() to prevent DoS on unbounded query
  private tagCountsCache: { data: any; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly salary: SalaryService,
  ) {}

  /** Keyset-paginated job list — stable (sortKey, id) ordering. */
  async list(f: JobFilter): Promise<Page<any>> {
    const where: any = f.showDead ? {} : { status: 'ACTIVE' };
    if (f.source) where.sourceId = f.source;
    if (f.type) where.employmentType = f.type;
    if (f.workplace === 'REMOTE') where.locationClass = { contains: 'REMOTE' };
    if (f.workplace === 'ONSITE') where.locationClass = { not: { contains: 'REMOTE' } };
    if (f.tier && f.tier !== 'ALL') where.source = { priorityTier: f.tier };
    if (f.tag) where.tags = { contains: f.tag };
    if (f.q) {
      const q = f.q.toLowerCase();
      // NOTE: mode 'insensitive' is PostgreSQL-only. SQLite uses case-insensitive
      // LIKE by default on ASCII, so lowercase q works for most matches.
      where.OR = [
        { title: { contains: q } },
        { company: { contains: q } },
        { description: { contains: q } },
        { skills: { some: { skill: { name: { contains: q } } } } },
      ];
    }

    const limit = parseLimit(f.limit, PAGE_SIZE, MAX_PAGE_SIZE);
    let sortCol = 'firstSeenAt';
    let dir: 'asc' | 'desc' = 'desc';
    if (f.sort === 'newest') sortCol = 'postedDate';
    if (f.sort === 'deadline') {
      sortCol = 'deadline';
      dir = 'asc';
    }

    const cursor = decodeCursor(f.cursor);
    const cursorWhere = cursor
      ? keysetAfter(sortCol, (cursor[sortCol] ?? null) as string | number | null, cursor.id, dir)
      : null;

    const [total, rows] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where: cursorWhere ? { AND: [where, cursorWhere] } : where,
        orderBy: [{ [sortCol]: dir }, { id: dir }],
        take: limit + 1,
        include: {
          source: true,
          skills: { include: { skill: true } },
          matches: f.userId ? { where: { userId: f.userId } } : false,
          // user-scoped state so the list reflects saved/application status exactly
          // like the detail endpoint (was missing → list always reported saved:false)
          apps: f.userId ? { where: { userId: f.userId } } : false,
        },
      }),
    ]);

    const { items, nextCursor } = pageFrom(rows, limit, (last) =>
      encodeCursor({ [sortCol]: (last[sortCol] as Date | null)?.toISOString() ?? null, id: last.id }),
    );
    return { items: items.map((j) => this.serialize(j)), nextCursor, total };
  }

  /** Tag meta + live active-job counts for the browse-page filter pills (all users). */
  async tagCounts() {
    if (this.tagCountsCache && Date.now() < this.tagCountsCache.expiresAt) {
      return this.tagCountsCache.data;
    }
    const jobs = await this.prisma.job.findMany({
      where: { status: 'ACTIVE' },
      select: { tags: true },
      take: 10000, // safety cap — prevents unbounded load at scale
    });
    const counts: Record<string, number> = {};
    for (const j of jobs) {
      if (!j.tags) continue;
      for (const t of this.prisma.jsonArray(j.tags)) counts[t] = (counts[t] ?? 0) + 1;
    }
    const result = getAllTags()
      .map((t) => ({ ...t, count: counts[t.id] ?? 0 }))
      .sort((a, b) => b.count - a.count);
    this.tagCountsCache = { data: result, expiresAt: Date.now() + 60_000 };
    return result;
  }

  async detail(id: string, userId?: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        source: true,
        skills: { include: { skill: true } },
        matches: userId ? { where: { userId } } : false,
        apps: userId ? { where: { userId } } : false,
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    return this.serialize(job);
  }

  /** Parse JSON string fields back to arrays (SQLite compat). */
  // Deprecated: use this.prisma.jsonArray() / this.prisma.parseJson() instead.

  private serialize(j: any) {
    const match = j.matches && j.matches.length ? j.matches[0] : null;
    return {
      id: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      locationClass: j.locationClass,
      tags: this.prisma.jsonArray(j.tags),
      workPlace: j.workPlace,
      employmentType: j.employmentType,
      experienceLevel: j.experienceLevel,
      salary: j.salary,
      currency: j.currency,
      url: j.url,
      description: j.description,
      skills: j.skills.map((s: any) => s.skill.name),
      source: { id: j.source.id, name: j.source.name, tier: j.source.priorityTier },
      postedDate: j.postedDate,
      deadline: j.deadline,
      firstSeenAt: j.firstSeenAt,
      lastSeenAt: j.lastSeenAt,
      missedCycles: j.missedCycles,
      status: j.status,
      parseConfidence: j.parseConfidence,
      // FR-012d/e: description provenance
      descriptionSource: j.descriptionSource ?? null,
      descriptionQuality: j.descriptionQuality ?? null,
      // FR-012g: apply method
      applyMethod: j.applyMethod ?? 'ONLINE_URL',
      applyUrl: j.applyUrl ?? j.url,
      applyEmail: j.applyEmail ?? null,
      // FR-013/034c: URL liveness
      urlStatus: j.urlStatus ?? null,
      saved: !!(j.apps && j.apps.some((a: any) => a.stage === 'SAVED')),
      application: j.apps && j.apps.length
        ? { stage: j.apps[0].stage, stageSince: j.apps[0].stageSince }
        : null,
      match: match
        ? {
            score: match.score,
            matchedSkills: this.prisma.jsonArray(match.matchedSkills),
            relatedSkills: this.prisma.jsonArray(match.relatedSkills),
            missingSkills: this.prisma.jsonArray(match.missingSkills),
            reasons: this.prisma.jsonArray(match.reasons),
            summary: match.summary,
            parts: {
              role: match.roleScore,
              skill: match.skillScore,
              experience: match.experienceScore,
              location: match.locationScore,
              employment: match.employmentScore,
              freshness: match.freshnessScore,
              salary: match.salaryScore,
            },
          }
        : null,
      // §32.5: Salary benchmark for the Ethiopian market
      salaryBenchmark: this.salary.compareJobSalary(
        j.salary,
        j.currency,
        j.title,
        j.experienceLevel,
      ),
    };
  }
}
