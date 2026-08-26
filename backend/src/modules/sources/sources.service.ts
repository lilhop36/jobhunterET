import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { normalizeSkill } from '../matching/matching-engine';
import { runFidelityPipeline } from '../jobs/job-fidelity';
import { JobSourceAdapter, RawJob, CollectionResult } from './adapters/job-source.adapter';
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
import { HagereJobsAdapter } from './adapters/hagerejobs.adapter';
import { TELEGRAM_ADAPTERS } from './adapters/telegram-tokens';
import { EventsService } from '../events/events.service';
import { CollectionQueue, QueueResult } from './collection-queue';
import { classifyJob, getAllTags } from './source-classifier';
import { mapSourceCategories } from './categories/category-mapper';
import sourceConfigs from './source-configs.json';
import { SourceConfigs, SourceDefinition, QueueConfig } from './source-configs.types';

const BACKOFF_THRESHOLD = Math.max(1, Number(process.env.SOURCE_BACKOFF_THRESHOLD ?? 3));

/** Config-driven fallback chain (from source-configs.json). */
const FALLBACK_CHAIN: Record<string, string[]> = (sourceConfigs as SourceConfigs).fallbackChains ?? {};

/** Health score: percentage of successful runs over the last HEALTH_WINDOW runs. */
const HEALTH_WINDOW = 10;
const HEALTH_AUTO_DISABLE_THRESHOLD = 50; // percent

@Injectable()
export class SourcesService implements OnModuleInit {
  private readonly logger = new Logger(SourcesService.name);
  private readonly adapters: Record<string, JobSourceAdapter>;
  private readonly queue: CollectionQueue;
  private readonly sourceConfigMap: Record<string, SourceDefinition> = {};

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
    hagerejobs: HagereJobsAdapter,
    @Inject(TELEGRAM_ADAPTERS) telegramAdapters: JobSourceAdapter[],
  ) {
    this.adapters = {};
    for (const a of [reliefweb, remotive, arbeitnow, ethiongojobs, geezjobs, ethiojobs, jobicy, remoteok, landingjobs, etcareers, hagerejobs]) {
      this.adapters[a.sourceId] = a;
    }
    // FR-008: register dynamically-configured Telegram channel adapters
    for (const a of telegramAdapters) {
      this.adapters[a.sourceId] = a;
      this.logger.log(`[ADAPTER] Registered Telegram channel: ${a.sourceId}`);
    }

    // Load config-driven source definitions
    const cfg = (sourceConfigs as SourceConfigs).queue ?? {};
    this.queue = new CollectionQueue(
      cfg.concurrency ?? 3,
      cfg.maxRetries ?? 2,
      cfg.retryDelayMs ?? 5000,
      cfg.backoffMultiplier ?? 2,
      cfg.maxBackoffMs ?? 600000,
    );
    for (const src of (sourceConfigs as SourceConfigs).sources ?? []) {
      this.sourceConfigMap[src.id] = src;
    }
  }

  async onModuleInit() {
    // Log queue events
    this.queue.on('batch:completed', (stats) => {
      this.logger.log(`[QUEUE] Batch completed: ${stats.completed} OK, ${stats.failed} failed`);
    });
    this.logger.log(`[QUEUE] Initialized with concurrency=${(sourceConfigs as SourceConfigs).queue?.concurrency ?? 3}`);
    this.logger.log(`[CONFIG] Loaded ${Object.keys(this.sourceConfigMap).length} source configs`);

    // Auto-create Telegram source rows if missing
    await this.ensureTelegramSources();

    // Auto-create config-driven sources that don't exist yet
    await this.ensureConfigDrivenSources();
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

  /** Create JobSource rows for config-driven sources that don't exist yet. */
  private async ensureConfigDrivenSources() {
    const configs = (sourceConfigs as SourceConfigs).sources ?? [];
    for (const cfg of configs) {
      const exists = await this.prisma.jobSource.findUnique({ where: { id: cfg.id } });
      if (!exists) {
        await this.prisma.jobSource.create({
          data: {
            id: cfg.id,
            name: cfg.name,
            type: cfg.type ?? 'HTML',
            baseUrl: cfg.baseUrl,
            status: 'ACTIVE',
            priorityTier: cfg.priorityTier ?? 'ETHIOPIA',
            collectionFrequency: `${cfg.frequency ?? 60} min`,
          },
        });
        this.logger.log(`[CONFIG] Auto-created source: ${cfg.id} (${cfg.name})`);
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

  async create(dto: Prisma.JobSourceCreateInput) {
    try {
      return await this.prisma.jobSource.create({ data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A source with that id already exists');
      }
      throw e;
    }
  }

  async update(id: string, dto: Prisma.JobSourceUpdateInput) {
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
  async collect(id: string, opts: { mode?: 'FAST' | 'DEEP' } = {}): Promise<{
    status: 'OK' | 'FAIL' | 'SKIPPED';
    reason?: string;
    message?: string;
    jobsFetched?: number;
    jobsCreated?: number;
    duplicates?: number;
    delivered?: number;
  }> {
    const mode = opts.mode ?? 'FAST';
    const source = await this.prisma.jobSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('Source not found');
    if (source.status !== 'ACTIVE') throw new BadRequestException('Source is not ACTIVE');

    // SEC-006: skip this cycle while the source is in backoff.
    const failures = source.consecutiveFailures ?? 0;
    if (failures >= BACKOFF_THRESHOLD && source.lastFailedRun) {
      const waitedMs = Date.now() - source.lastFailedRun.getTime();
      if (waitedMs < this.backoffMs(failures)) {
        return { status: 'SKIPPED', reason: `backoff after ${failures} consecutive failures` };
      }
    }

    const startedAt = new Date();
    const adapter = this.adapters[source.id];

    if (!adapter) {
      const message = 'No adapter registered for this source — add one in SourcesService (FR-008)';
      await this.prisma.jobSource.update({
        where: { id },
        data: { lastError: message, lastFailedRun: new Date() },
      });
      await this.prisma.sourceRun.create({
        data: { sourceId: id, startedAt, finishedAt: new Date(), status: 'FAIL', jobsFetched: 0, errors: 1, errorMessage: message, mode },
      });
      this.logger.warn(`[COLLECTOR] ${source.name} has no registered adapter (FR-008)`);
      return { status: 'FAIL', message };
    }

    const cfg = this.sourceConfigMap[source.id];
    const collectionCfg = cfg?.collection;
    const since = this.resolveSince(cfg, mode);
    const maxPages = collectionCfg?.[mode.toLowerCase() as 'fast' | 'deep']?.maxPages;
    const maxRequests = collectionCfg?.[mode.toLowerCase() as 'fast' | 'deep']?.maxRequests;
    const requestDelayMs = collectionCfg?.requestDelayMs;
    const categories = collectionCfg?.[mode.toLowerCase() as 'fast' | 'deep']?.categories ?? [];
    const knownSourceJobIds = mode === 'DEEP' ? await this.getKnownSourceJobIds(source.id) : undefined;

    let result: CollectionResult;
    try {
      if (adapter.collect) {
        result = await adapter.collect({
          mode,
          since,
          categories: categories.length ? categories : undefined,
          maxPages,
          maxRequests,
          requestDelayMs,
          knownSourceJobIds,
        });
      } else {
        const raw = await adapter.fetchJobs({ since });
        result = {
          jobs: raw,
          pagesFetched: 1,
          requestsMade: 1,
          categories: [{ category: 'latest', pagesFetched: 1, jobsFetched: raw.length, errors: 0, stoppedReason: 'LAST_PAGE' }],
          errors: [],
        };
      }
    } catch (err: any) {
      const message = String(err?.message ?? err).slice(0, 500);
      await this.prisma.jobSource.update({
        where: { id },
        data: { consecutiveFailures: { increment: 1 }, lastFailedRun: new Date(), lastError: message },
      });
      await this.prisma.sourceRun.create({
        data: { sourceId: id, startedAt, finishedAt: new Date(), status: 'FAIL', jobsFetched: 0, errors: 1, errorMessage: message, mode },
      });
      this.logger.warn(`[COLLECTOR] ${source.name} failed (transient, will retry): ${message}`);
      return { status: 'FAIL', message: 'Source failed (transient — will retry on the next cycle).' };
    }

    /* Within-run deduplication: first occurrence wins, merge sourceCategories/discoveredVia. */
    const { unique: valid, crossCategoryDuplicates } = this.dedupeWithinRun(result.jobs);
    const invalid = result.jobs.length - valid.length;

    let created = 0;
    let duplicates = 0;
    let descFailures = 0;
    let totalDescQuality = 0;
    let linkChecks = 0;
    let linkFailures = 0;
    const seenIds = new Set<string>();
    for (const j of valid) {
      seenIds.add(j.sourceJobId);
      const persistResult = await this.persist(source.id, j, source.baseUrl);
      if (persistResult.status === 'CREATED') created++;
      else duplicates++;
      if (persistResult.descQuality !== null) totalDescQuality += persistResult.descQuality;
      if (persistResult.descQuality !== null && persistResult.descQuality < 40) descFailures++;
      if (persistResult.linkChecked) linkChecks++;
      if (persistResult.urlStatus === 'NOT_FOUND') linkFailures++;
    }

    /* FR-015: coverage-aware ghost reconciliation. */
    const complete = result.categories.every((c) => c.stoppedReason === 'LAST_PAGE' || c.stoppedReason === 'EMPTY_PAGE');
    await this.reconcileGhosts(id, seenIds, { since, complete });

    const avgDescQuality = created > 0 ? totalDescQuality / created : null;
    await this.prisma.jobSource.update({
      where: { id },
      data: { status: 'ACTIVE', consecutiveFailures: 0, lastSuccessfulRun: new Date(), lastError: null },
    });

    const categoryStatsData = result.categories.map((c) => ({
      sourceId: id,
      category: c.category,
      categoryLabel: c.categoryLabel,
      pagesFetched: c.pagesFetched,
      jobsFetched: c.jobsFetched,
      errors: c.errors,
      stoppedReason: c.stoppedReason,
    }));

    await this.prisma.sourceRun.create({
      data: {
        sourceId: id,
        startedAt,
        finishedAt: new Date(),
        status: 'OK',
        jobsFetched: valid.length,
        jobsCreated: created,
        duplicates,
        errors: invalid + result.errors.length,
        descriptionFailures: descFailures,
        avgDescriptionQuality: avgDescQuality,
        linkChecks,
        linkFailures,
        mode,
        pagesFetched: result.pagesFetched,
        categoriesSearched: result.categories.length,
        crossCategoryDuplicates,
        unmappedCategories: 0,
        categoryStats: { create: categoryStatsData },
      },
    });

    this.logger.log(`[COLLECTOR] Source: ${source.name} — Retrieved: ${valid.length} (created ${created}, dupes ${duplicates}, cross-cat ${crossCategoryDuplicates})`);

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
        rawData: this.prisma.json(j.rawData ?? null),
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
        // Canonical categories
        categories: this.prisma.json(mapSourceCategories(sourceId, j.sourceCategories ?? [], j)),
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
      tags: this.prisma.json(result.tags),
    };
  }

  /** Resolve the `since` boundary from the source's collection config for a given mode. */
  private resolveSince(cfg: SourceDefinition | undefined, mode: 'FAST' | 'DEEP'): Date {
    const collection = cfg?.collection;
    if (!collection) {
      return new Date(Date.now() - (cfg?.freshnessWindowDays ?? 14) * 86_400_000);
    }
    const modeCfg = collection[mode.toLowerCase() as 'fast' | 'deep'];
    if (mode === 'FAST' && 'freshnessHours' in modeCfg) {
      return new Date(Date.now() - modeCfg.freshnessHours * 60 * 60 * 1000);
    }
    if (mode === 'DEEP' && 'freshnessDays' in modeCfg) {
      return new Date(Date.now() - modeCfg.freshnessDays * 86_400_000);
    }
    return new Date(Date.now() - (cfg?.freshnessWindowDays ?? 14) * 86_400_000);
  }

  /** Within-run deduplication: first occurrence wins, merge sourceCategories + discoveredVia. */
  private dedupeWithinRun(jobs: RawJob[]): { unique: RawJob[]; crossCategoryDuplicates: number } {
    const seen = new Map<string, RawJob>();
    let crossCategoryDuplicates = 0;
    for (const j of jobs) {
      const existing = seen.get(j.sourceJobId);
      if (existing) {
        crossCategoryDuplicates++;
        existing.sourceCategories = [...new Set([...(existing.sourceCategories ?? []), ...(j.sourceCategories ?? [])])];
        existing.discoveredVia = [...new Set([...(existing.discoveredVia ?? []), ...(j.discoveredVia ?? [])])].join(',');
      } else {
        seen.set(j.sourceJobId, { ...j });
      }
    }
    return { unique: [...seen.values()], crossCategoryDuplicates };
  }

  /** Build a Set of known sourceJobIds for a source — used by DEEP sweeps to skip detail fetches. */
  private async getKnownSourceJobIds(sourceId: string): Promise<Set<string>> {
    const jobs = await this.prisma.job.findMany({
      where: { sourceId },
      select: { sourceJobId: true },
    });
    return new Set(jobs.map((j) => j.sourceJobId).filter((id): id is string => id !== null));
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

    // Only auto-disable when we have a full window AND zero successes — a
    // partial sample must not kill a source that demonstrably works.
    if (runs.length >= HEALTH_WINDOW && okCount === 0 && !sourceId.startsWith('telegram:')) {
      this.logger.warn(
        `[HEALTH] Source ${sourceId} health score ${score}% — ${runs.length} consecutive failures, auto-disabling`,
      );
      await this.prisma.jobSource.update({
        where: { id: sourceId },
        data: { status: 'DISABLED', lastError: `Auto-disabled: ${runs.length} consecutive failures` },
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
  private async reconcileGhosts(
    sourceId: string,
    seenIds: Set<string>,
    coverage: { since: Date; complete: boolean },
  ) {
    const where: any = { sourceId, status: 'ACTIVE', sourceJobId: { not: null } };
    if (!coverage.complete) {
      where.postedDate = { gte: coverage.since };
    }
    const stored = await this.prisma.job.findMany({
      where,
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
  getSourceConfig(sourceId: string): SourceDefinition | undefined {
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

  /**
   * FR-035: frequency-aware collection — only enqueue sources whose configured
   * interval has elapsed since their last successful run. This prevents
   * low-frequency sources (e.g. RemoteOK every 120min) from being hammered
   * by a 30-minute scheduler tick.
   */
  async collectDue(): Promise<{ enqueued: number; skipped: string[]; due: string[] }> {
    const now = Date.now();
    const sources = await this.prisma.jobSource.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, lastSuccessfulRun: true },
    });

    const dueIds: string[] = [];
    const skippedIds: string[] = [];

    for (const src of sources) {
      if (!this.adapters[src.id]) continue;

      // Get configured frequency (minutes) from source config
      const freqMinutes = this.sourceConfigMap[src.id]?.frequency ?? 60;
      const freqMs = freqMinutes * 60_000;

      // If never collected, it's due
      if (!src.lastSuccessfulRun) {
        dueIds.push(src.id);
        continue;
      }

      const elapsed = now - src.lastSuccessfulRun.getTime();
      if (elapsed >= freqMs) {
        dueIds.push(src.id);
      } else {
        skippedIds.push(src.id);
      }
    }

    if (dueIds.length === 0) {
      this.logger.log(`[SCHEDULER] No sources due for collection (all within frequency window)`);
      return { enqueued: 0, skipped: skippedIds, due: [] };
    }

    // Enqueue only due sources, prioritized by tier
    const activeSources = dueIds.map((id) => ({
      id,
      priorityTier: this.sourceConfigMap[id]?.priorityTier ?? 'INTERNATIONAL',
      execute: () => this.collectWithFallback(id),
    }));

    const count = this.queue.enqueueAll(activeSources);
    this.logger.log(
      `[SCHEDULER] Enqueued ${count}/${sources.length} due sources: [${dueIds.join(', ')}]` +
      (skippedIds.length ? ` — skipped: [${skippedIds.join(', ')}]` : ''),
    );

    return { enqueued: count, skipped: skippedIds, due: dueIds };
  }

  /** Get current queue statistics. */
  getQueueStats() {
    return this.queue.stats;
  }

  /** Get all source configs (for frontend category management). */
  getAllSourceConfigs() {
    return (sourceConfigs as SourceConfigs).sources ?? [];
  }

  /** Get classification tag definitions (for frontend category filter). */
  getClassificationTags() {
    return (sourceConfigs as SourceConfigs).classification?.tags ?? {};
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

  /** Collect deep sweeps for sources whose deep interval has elapsed. */
  async collectDeepDue(): Promise<{ enqueued: number; skipped: string[]; due: string[] }> {
    const now = Date.now();
    const sources = await this.prisma.jobSource.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, lastSuccessfulRun: true },
    });

    const dueIds: string[] = [];
    const skippedIds: string[] = [];

    for (const src of sources) {
      if (!this.adapters[src.id]) continue;
      const cfg = this.sourceConfigMap[src.id];
      const deepCfg = cfg?.collection?.deep;
      if (!deepCfg?.everyMinutes) continue;

      const freqMs = deepCfg.everyMinutes * 60_000;
      const lastDeepRun = await this.prisma.sourceRun.findFirst({
        where: { sourceId: src.id, mode: 'DEEP' },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      });

      if (!lastDeepRun) {
        dueIds.push(src.id);
        continue;
      }

      const elapsed = now - lastDeepRun.startedAt.getTime();
      if (elapsed >= freqMs) {
        dueIds.push(src.id);
      } else {
        skippedIds.push(src.id);
      }
    }

    if (dueIds.length === 0) {
      return { enqueued: 0, skipped: skippedIds, due: [] };
    }

    const activeSources = dueIds.map((id) => ({
      id,
      priorityTier: 'DEEP',
      execute: () => this.collectWithFallback(id),
    }));

    const count = this.queue.enqueueAll(activeSources);
    this.logger.log(`[DEEP] Enqueued ${count} sources for deep collection: [${dueIds.join(', ')}]`);
    return { enqueued: count, skipped: skippedIds, due: dueIds };
  }

  /** Aggregate coverage report per source × category. */
  async getCoverageReport() {
    const sources = await this.prisma.jobSource.findMany({
      where: { status: 'ACTIVE' },
      include: {
        runs: {
          where: { mode: 'DEEP' },
          orderBy: { startedAt: 'desc' },
          take: 1,
          include: { categoryStats: true },
        },
      },
    });

    const report: any[] = [];
    for (const s of sources) {
      const activeCount = await this.prisma.job.count({
        where: { sourceId: s.id, status: 'ACTIVE' },
      });
      const lastRun = s.runs[0];
      report.push({
        id: s.id,
        name: s.name,
        activeJobs: activeCount,
        lastDeepRun: lastRun?.startedAt ?? null,
        categories: (lastRun?.categoryStats ?? []).map((cs: any) => ({
          category: cs.category,
          label: cs.categoryLabel,
          pages: cs.pagesFetched,
          fetched: cs.jobsFetched,
          newJobs: cs.newJobs,
          duplicates: cs.duplicates,
          errors: cs.errors,
          stoppedReason: cs.stoppedReason,
        })),
      });
    }
    return report;
  }

}
