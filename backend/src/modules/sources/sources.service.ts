import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException, Logger, OnModuleInit } from '@nestjs/common';
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
import { JobicyAdapter } from './adapters/jobicy.adapter';
import { RemoteOKAdapter } from './adapters/remoteok.adapter';
import { LandingJobsAdapter } from './adapters/landingjobs.adapter';
import { EtcareersAdapter } from './adapters/etcareers.adapter';
import { TELEGRAM_ADAPTERS } from './adapters/telegram-tokens';
import { EventsService } from '../events/events.service';
import { CollectionQueue, QueueResult } from './collection-queue';
import { classifyJob, getAllTags, type SourceConfig } from './source-classifier';
import * as sourceConfigs from './source-configs.json';

const BACKOFF_THRESHOLD = Math.max(1, Number(process.env.SOURCE_BACKOFF_THRESHOLD ?? 3));

/** Config-driven fallback chain (from source-configs.json). */
const FALLBACK_CHAIN: Record<string, string[]> = (sourceConfigs as any).fallbackChains ?? {};

/** Health score: percentage of successful runs over the last HEALTH_WINDOW runs. */
const HEALTH_WINDOW = 10;
const HEALTH_AUTO_DISABLE_THRESHOLD = 50; // percent

@Injectable()
export class SourcesService implements OnModuleInit {
  private readonly logger = new Logger(SourcesService.name);
  private readonly adapters: Record<string, JobSourceAdapter>;
  private readonly queue: CollectionQueue;
  private readonly sourceConfigMap: Record<string, SourceConfig> = {};

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly events: EventsService,
    reliefweb: ReliefWebAdapter,
    remotive: RemotiveAdapter,
    arbeitnow: ArbeitnowAdapter,
    ethiongojobs: EthioNgoJobsAdapter,
    geezjobs: GeezJobsAdapter,
    ethiojobs: EthiojobsAdapter,
    jobicy: JobicyAdapter,
    remoteok: RemoteOKAdapter,
    landingjobs: LandingJobsAdapter,
    etcareers: EtcareersAdapter,
    @Inject(TELEGRAM_ADAPTERS) telegramAdapters: JobSourceAdapter[],
  ) {
    this.adapters = {};
    for (const a of [reliefweb, remotive, arbeitnow, ethiongojobs, geezjobs, ethiojobs, jobicy, remoteok, landingjobs, etcareers]) {
      this.adapters[a.sourceId] = a;
    }
    // FR-008: register dynamically-configured Telegram channel adapters
    for (const a of telegramAdapters) {
      this.adapters[a.sourceId] = a;
      this.logger.log(`[ADAPTER] Registered Telegram channel: ${a.sourceId}`);
    }

    // Load config-driven source definitions
    const cfg = (sourceConfigs as any).queue ?? {};
    this.queue = new CollectionQueue(
      cfg.concurrency ?? 3,
      cfg.maxRetries ?? 2,
      cfg.retryDelayMs ?? 5000,
      cfg.backoffMultiplier ?? 2,
      cfg.maxBackoffMs ?? 600000,
    );
    for (const src of (sourceConfigs as any).sources ?? []) {
      this.sourceConfigMap[src.id] = src;
    }
  }

  async onModuleInit() {
    // Log queue events
    this.queue.on('batch:completed', (stats) => {
      this.logger.log(`[QUEUE] Batch completed: ${stats.completed} OK, ${stats.failed} failed`);
    });
    this.logger.log(`[QUEUE] Initialized with concurrency=${(sourceConfigs as any).queue?.concurrency ?? 3}`);
    this.logger.log(`[CONFIG] Loaded ${Object.keys(this.sourceConfigMap).length} source configs`);

    // Auto-create Telegram source rows if missing
    await this.ensureTelegramSources();
  }

  /** Create JobSource rows for dynamically-registered Telegram channels. */
  private async ensureTelegramSources() {
    for (const [id, adapter] of Object.entries(this.adapters)) {
      if (!id.startsWith('tg-')) continue;
      const exists = await this.prisma.jobSource.findUnique({ where: { id } });
      if (!exists) {
        await this.prisma.jobSource.create({
          data: {
            id,
            name: (adapter as any).name ?? id,
            type: 'TELEGRAM',
            baseUrl: `https://t.me/s/${id.replace('tg-', '')}`,
            status: 'ACTIVE',
            priorityTier: 'ETHIOPIA',
            collectionFrequency: '30 min',
          },
        });
        this.logger.log(`[CONFIG] Auto-created Telegram source: ${id}`);
      }
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

    // A source without a registered adapter is a configuration gap, not an
    // upstream failure (FR-008): record the run for traceability but do NOT
    // accumulate a transient failure streak — nothing to retry, so backoff
    // and the "will retry" alarm would be misleading.
    if (!adapter) {
      const message = 'No adapter registered for this source — add one in SourcesService (FR-008)';
      await this.prisma.jobSource.update({
        where: { id },
        data: { lastError: message, lastFailedRun: new Date() },
      });
      await this.prisma.sourceRun.create({
        data: { sourceId: id, startedAt, finishedAt: new Date(), status: 'FAIL', jobsFetched: 0, errors: 1, errorMessage: message },
      });
      this.logger.warn(`[COLLECTOR] ${source.name} has no registered adapter (FR-008)`);
      return { status: 'FAIL', message };
    }

    let raw: RawJob[];
    try {
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

    // Push collection event to all connected SSE clients
    if (created > 0) {
      const users = await this.prisma.user.findMany({ select: { id: true } });
      const duration = Date.now() - startedAt.getTime();
      for (const u of users) {
        this.events.pushToUser(u.id, {
          type: 'collection',
          sourceId: source.id,
          sourceName: source.name,
          status: 'OK',
          jobsFetched: valid.length,
          jobsCreated: created,
          duplicates,
          duration,
          createdAt: new Date().toISOString(),
        });
      }
    }

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
      deadline: j.deadline,
      postedDate: j.postedDate,
    });

    await this.prisma.job.create({
      data: {
        title: fidelity.title,
        company: fidelity.company,
        location: fidelity.location,
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
        rawData: this.prisma.isSQLite ? JSON.stringify(j.rawData ?? null) : j.rawData as any,
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
        // Classification: auto-tag based on source config + job attributes
        ...this.classifySourceJob(sourceId, j),
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

  /**
   * Classify a job using source config defaults + per-job analysis.
   * Returns { tags, locationClass } to merge into the create payload.
   */
  private classifySourceJob(sourceId: string, j: RawJob) {
    const cfg = this.sourceConfigMap[sourceId];
    if (!cfg) return { locationClass: j.locationClass, tags: '[]' };
    const result = classifyJob(cfg, {
      title: j.title,
      location: j.location,
      locationClass: j.locationClass,
      workPlace: j.workPlace,
    });
    return {
      locationClass: result.locationClass,
      tags: this.prisma.isSQLite ? JSON.stringify(result.tags) : result.tags as any,
    };
  }

  // ── Source Resilience: health scoring ──────────────────────────────────────

  /**
   * Compute health score for a source based on the last HEALTH_WINDOW runs.
   * Score = percentage of OK runs. Persists to JobSource.healthScore.
   * If score < threshold, auto-disables the source (FR-037 + resilience).
   */
  async computeHealthScore(sourceId: string): Promise<number | null> {
    const runs = await this.prisma.sourceRun.findMany({
      where: { sourceId },
      orderBy: { startedAt: 'desc' },
      take: HEALTH_WINDOW,
      select: { status: true },
    });
    if (!runs.length) return null;

    const okCount = runs.filter((r) => r.status === 'OK').length;
    const score = Math.round((okCount / runs.length) * 100);

    await this.prisma.jobSource.update({
      where: { id: sourceId },
      data: { healthScore: score, lastHealthCheckAt: new Date() },
    });

    // Auto-disable sources below threshold (skip Telegram channel adapters
    // — those are dynamically configured and shouldn't be auto-disabled)
    if (score < HEALTH_AUTO_DISABLE_THRESHOLD && !sourceId.startsWith('telegram:')) {
      this.logger.warn(
        `[HEALTH] Source ${sourceId} health score ${score}% < ${HEALTH_AUTO_DISABLE_THRESHOLD}% — auto-disabling`,
      );
      await this.prisma.jobSource.update({
        where: { id: sourceId },
        data: { status: 'DISABLED', lastError: `Auto-disabled: health score ${score}% below ${HEALTH_AUTO_DISABLE_THRESHOLD}%` },
      });
    }

    return score;
  }

  /**
   * FR-037 + Source Resilience: get health summary for all sources.
   * Used by the admin dashboard.
   */
  async getSourceHealthSummary() {
    const sources = await this.prisma.jobSource.findMany({
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: HEALTH_WINDOW,
          select: { status: true, startedAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return sources.map((s) => {
      const okCount = s.runs.filter((r) => r.status === 'OK').length;
      const totalRuns = s.runs.length;
      const score = totalRuns > 0 ? Math.round((okCount / totalRuns) * 100) : null;
      const hasAdapter = !!this.adapters[s.id];
      const fallbacks = FALLBACK_CHAIN[s.id] ?? [];

      return {
        id: s.id,
        name: s.name,
        status: s.status,
        priorityTier: s.priorityTier,
        healthScore: s.healthScore ?? score,
        recentRuns: totalRuns,
        lastSuccessfulRun: s.lastSuccessfulRun,
        lastFailedRun: s.lastFailedRun,
        lastError: s.lastError,
        hasAdapter,
        selectorVersion: hasAdapter ? this.adapters[s.id].selectorVersion ?? null : null,
        fallbacks,
      };
    });
  }

  // ── Source Resilience: fallback chain ───────────────────────────────────────

  /**
   * Collect from a source, and if it fails, automatically retry with
   * fallback sources from the same priority tier (FR-037, resilience).
   */
  async collectWithFallback(id: string) {
    // Try the primary source first
    const primaryResult = await this.collect(id);
    if (primaryResult.status === 'OK') {
      // Also compute health score after a successful run
      await this.computeHealthScore(id);
      return primaryResult;
    }

    // Primary failed — try fallback chain
    const fallbacks = FALLBACK_CHAIN[id] ?? [];
    if (!fallbacks.length) {
      await this.computeHealthScore(id);
      return primaryResult;
    }

    this.logger.log(
      `[FALLBACK] Source ${id} failed (status=${primaryResult.status}), trying fallbacks: ${fallbacks.join(', ')}`,
    );

    for (const fallbackId of fallbacks) {
      const fallbackSource = await this.prisma.jobSource.findUnique({ where: { id: fallbackId } });
      if (!fallbackSource || fallbackSource.status !== 'ACTIVE') {
        this.logger.log(`[FALLBACK] Skipping ${fallbackId} — status=${fallbackSource?.status ?? 'NOT_FOUND'}`);
        continue;
      }
      if (!this.adapters[fallbackId]) {
        this.logger.log(`[FALLBACK] Skipping ${fallbackId} — no adapter registered`);
        continue;
      }

      try {
        this.logger.log(`[FALLBACK] Attempting ${fallbackId} as fallback for ${id}`);
        const fallbackResult = await this.collect(fallbackId);
        if (fallbackResult.status === 'OK') {
          this.logger.log(`[FALLBACK] ${fallbackId} succeeded as fallback — fetched ${fallbackResult.jobsFetched} jobs`);
          return {
            ...fallbackResult,
            fallbackUsed: fallbackId,
            primaryStatus: primaryResult.status,
          };
        }
      } catch (err: any) {
        this.logger.warn(`[FALLBACK] ${fallbackId} also failed: ${err?.message}`);
      }
    }

    // All fallbacks exhausted — still report the primary failure
    await this.computeHealthScore(id);
    return { ...primaryResult, fallbacksExhausted: true };
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

  // ── Config-driven collection ──────────────────────────────────────────────

  /** Get the config for a source (from source-configs.json). */
  getSourceConfig(sourceId: string): SourceConfig | undefined {
    return this.sourceConfigMap[sourceId];
  }

  /** Enqueue collection for a single source (non-blocking). */
  enqueueCollect(sourceId: string): { enqueued: boolean; message: string } {
    const source = this.adapters[sourceId];
    if (!source) {
      return { enqueued: false, message: `No adapter registered for ${sourceId}` };
    }
    this.queue.enqueue(sourceId, () => this.collectWithFallback(sourceId));
    return { enqueued: true, message: `${sourceId} queued for collection` };
  }

  /** Enqueue collection for ALL active sources (non-blocking). */
  collectAll(): { enqueued: number; sources: string[] } {
    const activeSources = Object.keys(this.adapters)
      .filter((id) => !id.startsWith('telegram:')) // skip Telegram for bulk
      .map((id) => ({
        id,
        priorityTier: this.sourceConfigMap[id]?.priorityTier ?? 'INTERNATIONAL',
        execute: () => this.collectWithFallback(id),
      }));
    const count = this.queue.enqueueAll(activeSources);
    this.logger.log(`[QUEUE] Enqueued ${count} sources for collection`);
    return { enqueued: count, sources: activeSources.map((s) => s.id) };
  }

  /** Get current queue statistics. */
  getQueueStats() {
    return this.queue.stats;
  }

  /** Get all source configs (for frontend category management). */
  getAllSourceConfigs() {
    return (sourceConfigs as any).sources ?? [];
  }

  /** Get classification tag definitions (for frontend category filter). */
  getClassificationTags() {
    return (sourceConfigs as any).classification?.tags ?? {};
  }

  /** Get all tags with job counts for the category browsing page. */
  async getTagCounts() {
    const jobs = await this.prisma.job.findMany({
      where: { status: 'ACTIVE' },
      select: { tags: true, id: true },
    });
    const tagCounts: Record<string, number> = {};
    for (const j of jobs) {
      if (!j.tags) continue;
      try {
        const tags: string[] = typeof j.tags === 'string' ? JSON.parse(j.tags) : j.tags;
        for (const t of tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
      } catch {}
    }
    // Merge with tag metadata from getAllTags
    const allTags = getAllTags();
    return allTags.map((t) => ({
      ...t,
      count: tagCounts[t.id] ?? 0,
    })).sort((a, b) => b.count - a.count);
  }

}
