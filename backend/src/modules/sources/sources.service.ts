import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { NotificationsService } from '../notifications/notifications.service';
import { normalizeSkill } from '../matching/matching-engine';
import { JobSourceAdapter, RawJob } from './adapters/job-source.adapter';
import { ReliefWebAdapter } from './adapters/reliefweb.adapter';
import { RemotiveAdapter } from './adapters/remotive.adapter';
import { ArbeitnowAdapter } from './adapters/arbeitnow.adapter';
import { EthioNgoJobsAdapter } from './adapters/ethiongojobs.adapter';
import { GeezJobsAdapter } from './adapters/geezjobs.adapter';
import { EthiojobsAdapter } from './adapters/ethiojobs.adapter';

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);
  private readonly adapters: Record<string, JobSourceAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly notifications: NotificationsService,
    reliefweb: ReliefWebAdapter,
    remotive: RemotiveAdapter,
    arbeitnow: ArbeitnowAdapter,
    ethiongojobs: EthioNgoJobsAdapter,
    geezjobs: GeezJobsAdapter,
    ethiojobs: EthiojobsAdapter,
  ) {
    this.adapters = {};
    for (const a of [reliefweb, remotive, arbeitnow, ethiongojobs, geezjobs, ethiojobs]) {
      this.adapters[a.sourceId] = a;
    }
  }

  list() {
    return this.prisma.jobSource.findMany({
      include: { runs: { orderBy: { startedAt: 'desc' }, take: 5 } },
      orderBy: { createdAt: 'asc' },
    });
  }

  listActive() {
    return this.prisma.jobSource.findMany({ where: { status: 'ACTIVE' } });
  }

  async create(dto: any) {
    try {
      return await this.prisma.jobSource.create({ data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A source with that id already exists');
      }
      throw e;
    }
  }

  async update(id: string, dto: any) {
    try {
      return await this.prisma.jobSource.update({ where: { id }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException('Source not found');
      }
      throw e;
    }
  }

  /** FR-009/010: connect → fetch → validate → normalize → dedupe → store, then reconcile ghosts (FR-015). */
  async collect(id: string) {
    const source = await this.prisma.jobSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('Source not found');
    if (source.status !== 'ACTIVE') throw new BadRequestException('Source is not ACTIVE');

    const startedAt = new Date();
    const adapter = this.adapters[source.id];

    let raw: RawJob[];
    try {
      // A source without a registered adapter is a configuration error, not a
      // a missing adapter is a configuration error, not a fallback opportunity (FR-008).
      if (!adapter) throw new Error('No adapter registered for this source — add one in SourcesService (FR-008)');
      raw = await adapter.fetchJobs({ since: new Date(Date.now() - 14 * 86_400_000) });
    } catch (err: any) {
      /* FR-036: a failing source is isolated — it never blocks other sources or matching. */
      const message = String(err?.message ?? err).slice(0, 500);
      await this.prisma.jobSource.update({
        where: { id },
        data: { status: 'ERROR', lastFailedRun: new Date(), lastError: message },
      });
      await this.prisma.sourceRun.create({
        data: { sourceId: id, startedAt, finishedAt: new Date(), status: 'FAIL', jobsFetched: 0, errors: 1, errorMessage: message },
      });
      this.logger.warn(`[COLLECTOR] ${source.name} failed (isolated): ${message}`);
      return { status: 'FAIL', message: 'Source failed (isolated). See SourceRun for details.' };
    }

    /* FR-013: invalid postings never enter the primary table. */
    const valid = raw.filter((j) => j.title && j.company && j.url);
    const invalid = raw.length - valid.length;

    let created = 0;
    let duplicates = 0;
    const seenIds = new Set<string>();
    for (const j of valid) {
      seenIds.add(j.sourceJobId);
      const createdJob = await this.persist(source.id, j);
      if (createdJob === 'CREATED') created++;
      else duplicates++;
    }

    /* FR-015: jobs absent from the latest fetch accrue missedCycles; >= 3 → REMOVED. */
    await this.reconcileGhosts(id, seenIds);

    await this.prisma.jobSource.update({
      where: { id },
      data: { status: 'ACTIVE', lastSuccessfulRun: new Date(), lastError: null },
    });
    await this.prisma.sourceRun.create({
      data: { sourceId: id, startedAt, finishedAt: new Date(), status: 'OK', jobsFetched: valid.length, jobsCreated: created, duplicates, errors: invalid },
    });
    this.logger.log(`[COLLECTOR] Source: ${source.name} — Retrieved: ${valid.length} (created ${created}, dupes ${duplicates})`);

    const delivered = await this.matchAndNotify();
    return { status: 'OK', jobsFetched: valid.length, jobsCreated: created, duplicates, delivered };
  }

  /** Upsert a raw job: create new, or refresh lastSeenAt / reset missedCycles / reactivate REMOVED. */
  private async persist(sourceId: string, j: RawJob): Promise<'CREATED' | 'DUPLICATE'> {
    const skills = [...new Set(j.skills.map(normalizeSkill))].filter(Boolean);
    const skillIds: string[] = [];
    for (const name of skills) {
      const s = await this.prisma.skill.upsert({ where: { name }, create: { name }, update: {} });
      skillIds.push(s.id);
    }

    const existing = await this.prisma.job.findUnique({
      where: { sourceId_sourceJobId: { sourceId, sourceJobId: j.sourceJobId } },
      select: { id: true, status: true },
    });

    if (existing) {
      const wasRemoved = existing.status === 'REMOVED';
      await this.prisma.job.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          missedCycles: 0,
          status: wasRemoved ? 'ACTIVE' : existing.status, // FR-015: reappeared job returns to ACTIVE
          statusChangedAt: wasRemoved ? null : undefined,
        },
      });
      return 'DUPLICATE';
    }

    await this.prisma.job.create({
      data: {
        title: j.title,
        company: j.company,
        location: j.location,
        locationClass: j.locationClass,
        employmentType: j.employmentType,
        experienceLevel: j.experienceLevel,
        workPlace: j.workPlace,
        salary: j.salary ?? null,
        currency: j.currency ?? 'USD',
        url: j.url,
        sourceId,
        sourceJobId: j.sourceJobId,
        postedDate: j.postedDate,
        deadline: j.deadline,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        status: 'ACTIVE',
        parseConfidence: j.parseConfidence ?? 80,
        rawData: j.rawData as any,
        country: j.country ?? null,
        description: j.description ?? null,
        skills: skillIds.length ? { create: skillIds.map((skillId) => ({ skillId })) } : undefined,
      },
    });
    return 'CREATED';
  }

  /** FR-015 ghost detection: increment missedCycles for unseen ACTIVE jobs; REMOVE at the limit. */
  private async reconcileGhosts(sourceId: string, seenIds: Set<string>) {
    const stored = await this.prisma.job.findMany({
      where: { sourceId, status: 'ACTIVE', sourceJobId: { not: null } },
      select: { id: true, sourceJobId: true, missedCycles: true },
    });
    const unseen = stored.filter((j) => !seenIds.has(j.sourceJobId!));
    if (!unseen.length) return;

    await this.prisma.job.updateMany({
      where: { id: { in: unseen.map((j) => j.id) } },
      data: { missedCycles: { increment: 1 } },
    });
    const doomed = unseen.filter((j) => j.missedCycles + 1 >= 3);
    if (doomed.length) {
      await this.prisma.job.updateMany({
        where: { id: { in: doomed.map((j) => j.id) } },
        data: { status: 'REMOVED', statusChangedAt: new Date() },
      });
      this.logger.log(`[GHOST] Marked ${doomed.length} job(s) REMOVED (missedCycles >= 3)`);
    }
  }

  /** Recalculate matches for every user and deliver notifications for qualifying matches. */
  private async matchAndNotify(): Promise<number> {
    const users = await this.prisma.user.findMany();
    let delivered = 0;
    for (const u of users) {
      await this.matching.recalculate(u.id);
      const threshold = u.matchThreshold ?? 70;
      const matches = await this.prisma.jobMatch.findMany({
        where: { userId: u.id, score: { gte: threshold } },
        select: { jobId: true, score: true, summary: true },
      });
      for (const m of matches) {
        const r = await this.notifications.notifyForMatch(u.id, m.jobId, m.score, m.summary || '');
        if (r !== 'SKIPPED') delivered++;
      }
    }
    return delivered;
  }

}
