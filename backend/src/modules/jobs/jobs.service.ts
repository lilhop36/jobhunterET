import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SalaryService } from '../salary/salary.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly salary: SalaryService,
  ) {}

  /** PERF-002: keyset-paginated job list — stable (sortKey, id) ordering, total count. */
  async list(f: JobFilter): Promise<Page<any>> {
    const where: any = f.showDead ? {} : { status: 'ACTIVE' };
    if (f.source) where.sourceId = f.source;
    if (f.type) where.employmentType = f.type;
    if (f.workplace === 'REMOTE') where.locationClass = { contains: 'REMOTE' };
    if (f.workplace === 'ONSITE') where.locationClass = { not: { contains: 'REMOTE' } };
    if (f.tier && f.tier !== 'ALL') where.source = { priorityTier: f.tier };
    if (f.q) {
      const q = f.q.toLowerCase();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { skills: { some: { skill: { name: { contains: q, mode: 'insensitive' } } } } },
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

  private serialize(j: any) {
    const match = j.matches && j.matches.length ? j.matches[0] : null;
    return {
      id: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      locationClass: j.locationClass,
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
            matchedSkills: match.matchedSkills,
            relatedSkills: match.relatedSkills,
            missingSkills: match.missingSkills,
            reasons: match.reasons,
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
