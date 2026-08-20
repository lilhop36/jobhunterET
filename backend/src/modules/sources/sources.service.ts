import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { normalizeSkill } from '../matching/matching-engine';
import { runFidelityPipeline } from '../jobs/job-fidelity';
import { JobSourceAdapter, RawJob } from './adapters/job-source.adapter';
import { ReliefWebAdapter } from './adapters/reliefweb.adapter';
import { RemotiveAdapter } from './adapters/remotive.adapter';
import { ArbeitnowAdapter } from './adapters/arbeitnow.adapter';
import { EthioNgoJobsAdapter } from './adapters/ethiongojobs.adapter';
import { GeezJobsAdapter } from './adapters/geezjobs.adapter';
import { EthiojobsAdapter } from './adapters/ethiojobs.adapter';

const BACKOFF_THRESHOLD = Math.max(1, Number(process.env.SOURCE_BACKOFF_THRESHOLD ?? 3));

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);
  private readonly adapters: Record<string, JobSourceAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
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

  /**
   * SEC-006: exponential backoff after repeated failures — failures are counted,
   * never treated as a permanent state. Once `consecutiveFailures` reaches the
   * threshold, attempts are skipped until the backoff window (doubling per
   * failure, capped) has elapsed; a successful run resets the counter.
   */
  private backoffMs(failures: number): number {
    const excess = Math.max(0, failures - BACKOFF_THRESHOLD);
    return Math.min(2 ** excess, 24) * 60 * 60 * 1000; // 1h → 2h → 4h → … cap 24h
  }

  /** FR-009/010: connect → fetch → validate → normalize → dedupe → store, then reconcile ghosts (FR-015). */
  async collect(id: string) {
    const source = await this.prisma.jobSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('Source not found');
    if (source.status !== 'ACTIVE') throw new BadRequestException('Source is not ACTIVE');

    // SEC-006: skip this cycle while the source is in backoff (scheduler keeps
    // polling, so a recovered source resumes automatically on the next window).
    const failures = source.consecutiveFailures ?? 0;
    if (failures >= BACKOFF_THRESHOLD && source.lastFailedRun) {
      const waitedMs = Date.now() - source.lastFailedRun.getTime();
      if (waitedMs < this.backoffMs(failures)) {
        return { status: 'SKIPPED', reason: `backoff after ${failures} consecutive failures` };
      }
    }

    const startedAt = new Date();
    const adapter = this.adapters[source.id];

    let raw: RawJob[];
    try {
      // A source without a registered adapter is a configuration error, not a
      // a missing adapter is a configuration error, not a fallback opportunity (FR-008).
      if (!adapter) throw new Error('No adapter registered for this source — add one in SourcesService (FR-008)');
      raw = await adapter.fetchJobs({ since: new Date(Date.now() - 14 * 86_400_000) });
    } catch (err: any) {
      /* FR-036 + SEC-006: the failure is isolated (never blocks other sources or
       * matching) and transient — the source stays ACTIVE so the next scheduled
       * cycle can retry it. The counter drives backoff, not a permanent ERROR. */
      const message = String(err?.message ?? err).slice(0, 500);
      await this.prisma.jobSource.update({
        where: { id },
        data: { consecutiveFailures: { increment: 1 }, lastFailedRun: new Date(), lastError: message },
      });
      await this.prisma.sourceRun.create({
        data: { sourceId: id, startedAt, finishedAt: new Date(), status: 'FAIL', jobsFetched: 0, errors: 1, errorMessage: message },
      });
      this.logger.warn(`[COLLECTOR] ${source.name} failed (transient, will retry): ${message}`);
      return { status: 'FAIL', message: 'Source failed (transient — will retry on the next cycle).' };
    }

    /* FR-013: invalid postings never enter the primary table. */
    const valid = raw.filter((j) => j.title && j.company && j.url);
    const invalid = raw.length - valid.length;

    let created = 0;
    let duplicates = 0;
    let descFailures = 0;
    let totalDescQuality = 0;
    let linkChecks = 0;
    let linkFailures = 0;
    const seenIds = new Set<string>();
    for (const j of valid) {
      seenIds.add(j.sourceJobId);
      const result = await this.persist(source.id, j, source.baseUrl);
      if (result.status === 'CREATED') created++;
      else duplicates++;
      if (result.descQuality !== null) totalDescQuality += result.descQuality;
      if (result.descQuality !== null && result.descQuality < 40) descFailures++;
      if (result.linkChecked) linkChecks++;
      if (result.urlStatus === 'NOT_FOUND') linkFailures++;
    }

    /* FR-015: jobs absent from the latest fetch accrue missedCycles; >= 3 → REMOVED. */
    await this.reconcileGhosts(id, seenIds);

    // SEC-006: a successful run clears the failure streak so backoff restarts fresh.
    const avgDescQuality = created > 0 ? totalDescQuality / created : null;
    await this.prisma.jobSource.update({
      where: { id },
      data: { status: 'ACTIVE', consecutiveFailures: 0, lastSuccessfulRun: new Date(), lastError: null },
    });
    await this.prisma.sourceRun.create({
      data: {
        sourceId: id,
        startedAt,
        finishedAt: new Date(),
        status: 'OK',
        jobsFetched: valid.length,
        jobsCreated: created,
        duplicates,
        errors: invalid,
        descriptionFailures: descFailures,
        avgDescriptionQuality: avgDescQuality,
        linkChecks,
        linkFailures,
      },
    });
    this.logger.log(`[COLLECTOR] Source: ${source.name} — Retrieved: ${valid.length} (created ${created}, dupes ${duplicates})`);

    // FR-018: score the newly created jobs against every user's profile once
    // (incremental pass — no full re-score of the pool on every cycle).
    let delivered = 0;
    if (created > 0) {
      const outcome = await this.matching.matchUnmatchedJobs();
      delivered = outcome.sent + outcome.toInbox;
    }
    return { status: 'OK', jobsFetched: valid.length, jobsCreated: created, duplicates, delivered };
  }

  /** Upsert a raw job: create new, or refresh lastSeenAt / reset missedCycles / reactivate REMOVED. */
  private async persist(
    sourceId: string,
    j: RawJob,
    baseUrl?: string,
  ): Promise<{
    status: 'CREATED' | 'DUPLICATE';
    descQuality: number | null;
    linkChecked: boolean;
    urlStatus: string;
  }> {
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
      return { status: 'DUPLICATE', descQuality: null, linkChecked: false, urlStatus: 'OK' };
    }

    // FR-012d through FR-013: run the full fidelity pipeline.
    const fidelity = await runFidelityPipeline({
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      baseUrl,
      description: j.description,
      salary: j.salary,
      currency: j.currency,
      deadline: j.deadline as any,
      postedDate: j.postedDate,
    });

    await this.prisma.job.create({
      data: {
        title: j.title,
        company: j.company,
        location: j.location,
        locationClass: j.locationClass,
        employmentType: j.employmentType,
        experienceLevel: j.experienceLevel,
        workPlace: j.workPlace,
        salary: fidelity.salary,
        currency: fidelity.currency,
        url: j.url,
        sourceId,
        sourceJobId: j.sourceJobId,
        postedDate: j.postedDate,
        deadline: fidelity.deadline,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        status: 'ACTIVE',
        parseConfidence: j.parseConfidence ?? 80,
        rawData: j.rawData as any,
        country: j.country ?? null,
        description: fidelity.description,
        // FR-012d/e: description provenance
        descriptionSource: fidelity.descriptionSource as any,
        descriptionQuality: fidelity.descriptionQuality ?? null,
        // FR-012g: apply method
        applyMethod: fidelity.applyMethod as any,
        applyUrl: fidelity.applyUrl,
        applyEmail: fidelity.applyEmail,
        // FR-013/034c: URL liveness
        urlStatus: fidelity.urlStatus,
        urlCheckedAt: fidelity.urlCheckedAt ?? null,
        finalUrl: fidelity.finalUrl,
        // FR-014: fingerprint for dedup
        fingerprint: fidelity.fingerprint,
        skills: skillIds.length ? { create: skillIds.map((skillId) => ({ skillId })) } : undefined,
      },
    });

    return {
      status: 'CREATED',
      descQuality: fidelity.descriptionQuality,
      linkChecked: fidelity.urlCheckedAt !== null,
      urlStatus: fidelity.urlStatus,
    };
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

}
