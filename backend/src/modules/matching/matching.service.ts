import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MatchingEngine,
  MatchResult,
  ProfileInput,
  JobInput,
  TierPriority,
} from './matching-engine';

type JobWithSkills = {
  id: string;
  title: string;
  location: string;
  locationClass: string;
  country: string | null;
  employmentType: string;
  experienceLevel: string;
  salary: number | null;
  workPlace: string;
  parseConfidence: number;
  postedDate: Date;
  skills: { skill: { name: string } }[];
};

@Injectable()
export class MatchingService extends MatchingEngine {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async buildProfileInput(userId: string): Promise<ProfileInput> {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId },
    });
    const [skills, roles, locations] = await Promise.all([
      this.prisma.candidateSkill.findMany({
        where: { userId },
        include: { skill: true },
      }),
      this.prisma.targetRole.findMany({ where: { userId } }),
      this.prisma.locationPreference.findMany({ where: { userId } }),
    ]);

    const locationTiers: Record<string, TierPriority> = {};
    for (const l of locations) locationTiers[l.region] = l.tier as TierPriority;

    return {
      skills: skills.map((s) => s.skill.name),
      targetRoles: roles.map((r) => ({ role: r.role, priority: r.priority })),
      locationTiers,
      remote: profile?.remote ?? false,
      employmentTypes: profile?.employmentTypes ?? [],
      years: profile?.years ?? 0,
      minSalary: profile?.minSalary ?? 0,
      excludeOnsite: profile?.excludeOnsite ?? false,
    };
  }

  private toJobInput(job: JobWithSkills): JobInput {
    return {
      title: job.title,
      skills: job.skills.map((s) => s.skill.name),
      locationClass: job.locationClass,
      location: job.location,
      country: job.country ?? undefined,
      employmentType: job.employmentType,
      experienceLevel: job.experienceLevel,
      salary: job.salary,
      workPlace: job.workPlace,
      parseConfidence: job.parseConfidence,
      postedAt: job.postedDate,
    };
  }

  /** Compute (without persisting) match results for a set of active jobs. */
  async scoreJobsForUser(
    userId: string,
    jobs: JobWithSkills[],
  ): Promise<Map<string, MatchResult>> {
    const prof = await this.buildProfileInput(userId);
    const out = new Map<string, MatchResult>();
    for (const job of jobs) {
      out.set(job.id, this.scoreJob(this.toJobInput(job), prof));
    }
    return out;
  }

  /** Persist/upsert matches for a user against the latest ACTIVE jobs. */
  async recalculate(
    userId: string,
    limit = Number(process.env.RECALC_JOB_LIMIT ?? 1000),
  ): Promise<number> {
    const prof = await this.buildProfileInput(userId);
    const jobs = (await this.prisma.job.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { firstSeenAt: 'desc' },
      take: limit,
      include: { skills: { include: { skill: true } } },
    })) as unknown as JobWithSkills[];

    let created = 0;
    for (const job of jobs) {
      const result = this.scoreJob(this.toJobInput(job), prof);
      const existing = await this.prisma.jobMatch.findUnique({
        where: { userId_jobId: { userId, jobId: job.id } },
      });
      if (existing) {
        await this.prisma.jobMatch.update({
          where: { userId_jobId: { userId, jobId: job.id } },
          data: this.toMatchData(result),
        });
      } else {
        await this.prisma.jobMatch.create({
          data: { userId, jobId: job.id, score: result.score, ...this.toMatchData(result) },
        });
        created++;
      }
    }
    return created;
  }

  private toMatchData(r: MatchResult) {
    const find = (l: string) => r.parts.find((p) => p.label === l)!;
    const role = find('Role');
    const skill = find('Skills');
    const exp = find('Experience');
    const loc = find('Location');
    const emp = find('Employment');
    const fresh = find('Freshness');
    const sal = find('Salary');
    return {
      roleScore: role.weight * role.fraction,
      skillScore: skill.weight * skill.fraction,
      experienceScore: exp.weight * exp.fraction,
      locationScore: loc.weight * loc.fraction,
      employmentScore: emp.weight * emp.fraction,
      freshnessScore: fresh.weight * fresh.fraction,
      salaryScore: sal.weight * sal.fraction,
      matchedSkills: r.matchedSkills,
      relatedSkills: r.relatedSkills,
      missingSkills: r.missingSkills,
      reasons: r.reasons,
      summary: r.summary,
    };
  }
}
