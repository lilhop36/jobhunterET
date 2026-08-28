import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
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

/** Result of one incremental matching pass (FR-018). */
export interface UnmatchedOutcome {
  jobsEvaluated: number;
  usersProcessed: number;
  matchesCreated: number;
  aboveThreshold: number;
  sent: number;
  toInbox: number;
  skipped: number;
}

@Injectable()
export class MatchingService extends MatchingEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
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
      targetRoles: roles.map((r) => ({ role: r.role, priority: r.priority as 'HIGH' | 'MEDIUM' | 'LOW' })),
      locationTiers,
      remote: !!profile?.remote,
      employmentTypes: (this.prisma.jsonArray(profile?.employmentTypes) as string[]).filter(Boolean),
      years: profile?.years ?? 0,
      minSalary: profile?.minSalary ?? 0,
      excludeOnsite: !!profile?.excludeOnsite,
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

  /**
   * FR-018 incremental matching: score only ACTIVE jobs that have never been
   * matched (matchedAt IS NULL) against every user with a non-empty profile,
   * persist with one bulk upsert, and notify for new above-threshold matches.
   */
  async matchUnmatchedJobs(
    limit = Number(process.env.INCREMENTAL_MATCH_LIMIT ?? 250),
  ): Promise<UnmatchedOutcome> {
    const empty = { jobsEvaluated: 0, usersProcessed: 0, matchesCreated: 0, aboveThreshold: 0, sent: 0, toInbox: 0, skipped: 0 };
    const jobs = (await this.prisma.job.findMany({
      where: { status: 'ACTIVE', matchedAt: null },
      orderBy: { firstSeenAt: 'asc' },
      take: limit,
      include: { skills: { include: { skill: true } } },
    })) as unknown as JobWithSkills[];

    if (!jobs.length) return empty;
    const jobIds = jobs.map((j) => j.id);

    const users = await this.prisma.user.findMany({
      where: { OR: [{ skills: { some: {} } }, { targetRoles: { some: {} } }] },
      select: { id: true, matchThreshold: true },
    });
    if (!users.length) {
      await this.prisma.job.updateMany({
        where: { id: { in: jobIds } },
        data: { matchedAt: new Date() },
      });
      return { ...empty, jobsEvaluated: jobs.length };
    }

    const profiles = await this.buildProfilesForUsers(users.map((u) => u.id));
    const thresholds = new Map(users.map((u) => [u.id, u.matchThreshold ?? 65]));

    const existing = await this.prisma.jobMatch.findMany({
      where: { jobId: { in: jobIds } },
      select: { userId: true, jobId: true },
    });
    const existingKeys = new Set(existing.map((e) => `${e.userId}:${e.jobId}`));

    const rows: Prisma.JobMatchCreateManyInput[] = [];
    const notifyCandidates: { userId: string; jobId: string; score: number; summary: string }[] = [];
    let above = 0;

    // Yield to event loop periodically during CPU-bound scoring
    // Process users in chunks to prevent blocking other requests/SSE streams.
    const USER_CHUNK = 50;
    for (let ui = 0; ui < users.length; ui += USER_CHUNK) {
      const chunk = users.slice(ui, ui + USER_CHUNK);
      for (const user of chunk) {
        const prof = profiles.get(user.id);
        if (!prof) continue;
        for (const job of jobs) {
          const key = `${user.id}:${job.id}`;
          if (existingKeys.has(key)) continue;
          const result = this.scoreJob(this.toJobInput(job), prof);
          rows.push({
            userId: user.id,
            jobId: job.id,
            score: result.score,
            ...this.toMatchData(result),
          });
          if (result.score >= (thresholds.get(user.id) ?? 65)) {
            above++;
            notifyCandidates.push({ userId: user.id, jobId: job.id, score: result.score, summary: result.summary });
          }
        }
      }
      // Yield to event loop after each chunk
      if (ui + USER_CHUNK < users.length) {
        await new Promise((r) => setImmediate(r));
      }
    }

    let createdCount = 0;
    if (rows.length) {
      createdCount = await this.safeCreateMany(rows);
    }

    await this.prisma.job.updateMany({
      where: { id: { in: jobIds } },
      data: { matchedAt: new Date() },
    });

    let sent = 0;
    let toInbox = 0;
    let skipped = 0;
    for (const c of notifyCandidates) {
      const r = await this.notifications.notifyForMatch(c.userId, c.jobId, c.score, c.summary);
      if (r === 'SENT') sent++;
      else if (r === 'WEB') toInbox++;
      else skipped++;
    }

    return {
      jobsEvaluated: jobs.length,
      usersProcessed: users.length,
      matchesCreated: createdCount,
      aboveThreshold: above,
      sent,
      toInbox,
      skipped,
    };
  }

  /** Load profiles for many users with 4 batched queries (FR-018 prefilter pass). */
  private async buildProfilesForUsers(userIds: string[]): Promise<Map<string, ProfileInput>> {
    const [profiles, skills, roles, locations] = await Promise.all([
      this.prisma.candidateProfile.findMany({ where: { userId: { in: userIds } } }),
      this.prisma.candidateSkill.findMany({ where: { userId: { in: userIds } }, include: { skill: true } }),
      this.prisma.targetRole.findMany({ where: { userId: { in: userIds } } }),
      this.prisma.locationPreference.findMany({ where: { userId: { in: userIds } } }),
    ]);

    const skillsByUser = new Map<string, string[]>();
    for (const s of skills) {
      const list = skillsByUser.get(s.userId) ?? [];
      list.push(s.skill.name);
      skillsByUser.set(s.userId, list);
    }
    const rolesByUser = new Map<string, { role: string; priority: 'HIGH' | 'MEDIUM' | 'LOW' }[]>();
    for (const r of roles) {
      const list = rolesByUser.get(r.userId) ?? [];
      list.push({ role: r.role, priority: r.priority as 'HIGH' | 'MEDIUM' | 'LOW' });
      rolesByUser.set(r.userId, list);
    }
    const locationsByUser = new Map<string, Record<string, TierPriority>>();
    for (const l of locations) {
      const map = locationsByUser.get(l.userId) ?? {};
      map[l.region] = l.tier as TierPriority;
      locationsByUser.set(l.userId, map);
    }

    const out = new Map<string, ProfileInput>();
    for (const p of profiles) {
      out.set(p.userId, {
        skills: skillsByUser.get(p.userId) ?? [],
        targetRoles: rolesByUser.get(p.userId) ?? [],
        locationTiers: locationsByUser.get(p.userId) ?? {},
        remote: !!p.remote,
        employmentTypes: (this.prisma.jsonArray(p.employmentTypes) as string[]).filter(Boolean),
        years: p.years,
        minSalary: p.minSalary,
        excludeOnsite: !!p.excludeOnsite,
      });
    }
    return out;
  }

  /**
   * FR-018: Persist/upsert matches for a user against the latest ACTIVE jobs.
   * Batch existing-pair updates in a single transaction (eliminates N+1 loop).
   */
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

    const scored = jobs.map((job) => ({
      jobId: job.id,
      result: this.scoreJob(this.toJobInput(job), prof),
    }));

    const existing = await this.prisma.jobMatch.findMany({
      where: { userId, jobId: { in: jobs.map((j) => j.id) } },
      select: { jobId: true },
    });
    const existingIds = new Set(existing.map((e) => e.jobId));

    const newRows: Prisma.JobMatchCreateManyInput[] = [];
    const updateOps: { jobId: string; data: any }[] = [];

    for (const { jobId, result } of scored) {
      const data = this.toMatchData(result);
      if (existingIds.has(jobId)) {
        updateOps.push({ jobId, data });
      } else {
        newRows.push({ userId, jobId, score: result.score, ...data });
      }
    }

    // Batch all updates in a single transaction
    if (updateOps.length) {
      const updateTx = updateOps.map((op) =>
        this.prisma.jobMatch.update({
          where: { userId_jobId: { userId, jobId: op.jobId } },
          data: op.data,
        })
      );
      await this.prisma.$transaction(updateTx);
    }

    if (newRows.length) {
      await this.safeCreateMany(newRows);
    }

    return newRows.length;
  }

  /** createMany wrapper: skipDuplicates isn't supported on SQLite, so we catch P2002. */
  private async safeCreateMany(rows: Prisma.JobMatchCreateManyInput[]): Promise<number> {
    if (!this.prisma.isSQLite) {
      // skipDuplicates isn't supported on SQLite — that branch is handled separately
      return (await (this.prisma.jobMatch as any).createMany({ data: rows, skipDuplicates: true })).count;
    }
    // Batch SQLite inserts in a single transaction
    const BATCH = 50;
    let count = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      await this.prisma.$transaction(async (tx) => {
        for (const row of batch) {
          try {
            await tx.jobMatch.create({ data: row });
            count++;
          } catch {
            // swallow P2002 duplicates
          }
        }
      });
    }
    return count;
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
      matchedSkills: this.prisma.json(r.matchedSkills),
      relatedSkills: this.prisma.json(r.relatedSkills),
      missingSkills: this.prisma.json(r.missingSkills),
      reasons: this.prisma.json(r.reasons),
      summary: r.summary,
    };
  }
}
