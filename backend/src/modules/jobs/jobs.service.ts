import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface JobFilter {
  q?: string;
  tier?: string;
  type?: string;
  workplace?: string;
  source?: string;
  sort?: 'score' | 'newest' | 'deadline';
  showDead?: boolean;
  userId?: string;
}

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(f: JobFilter) {
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

    let orderBy: any = { firstSeenAt: 'desc' };
    if (f.sort === 'newest') orderBy = { postedDate: 'desc' };
    if (f.sort === 'deadline') orderBy = { deadline: 'asc' };

    const jobs = await this.prisma.job.findMany({
      where,
      orderBy,
      include: {
        source: true,
        skills: { include: { skill: true } },
        matches: f.userId ? { where: { userId: f.userId } } : false,
        // user-scoped state so the list reflects saved/application status exactly
        // like the detail endpoint (was missing → list always reported saved:false)
        savedBy: f.userId ? { where: { userId: f.userId } } : false,
        apps: f.userId ? { where: { userId: f.userId } } : false,
      },
    });

    return jobs.map((j) => this.serialize(j));
  }

  async detail(id: string, userId?: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        source: true,
        skills: { include: { skill: true } },
        matches: userId ? { where: { userId } } : false,
        savedBy: userId ? { where: { userId } } : false,
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
      saved: !!(j.savedBy && j.savedBy.length),
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
    };
  }
}
