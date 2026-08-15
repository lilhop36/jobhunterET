import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LifecycleService } from './lifecycle.service';
import { SourcesService } from '../sources/sources.service';
import { DigestService } from '../digest/digest.service';

/** FR-034a: sweep interval in ms — reads EXPIRATION_SWEEP_INTERVAL (default 6h). */
function sweepIntervalMs(): number {
  const raw = process.env.EXPIRATION_SWEEP_INTERVAL;
  if (!raw) return 6 * 60 * 60 * 1000;
  const n = Number(raw);
  if (!Number.isNaN(n)) return n; // plain milliseconds
  const h = raw.trim().match(/^(\d+)\s*h$/);
  return h ? Number(h[1]) * 60 * 60 * 1000 : 6 * 60 * 60 * 1000; // "6h"
}

/** FR-028: digest interval in ms — reads DIGEST_INTERVAL (default 24h). */
function digestIntervalMs(): number {
  const raw = process.env.DIGEST_INTERVAL;
  if (!raw) return 24 * 60 * 60 * 1000;
  const n = Number(raw);
  if (!Number.isNaN(n)) return n; // plain milliseconds
  const h = raw.trim().match(/^(\d+)\s*h$/);
  return h ? Number(h[1]) * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // "24h"
}

/** FR-018/037a: match-cycle interval in ms — reads MATCH_CYCLE_INTERVAL (default 10m). */
function matchCycleIntervalMs(): number {
  const raw = process.env.MATCH_CYCLE_INTERVAL;
  if (!raw) return 10 * 60 * 1000;
  const n = Number(raw);
  if (!Number.isNaN(n)) return n; // plain milliseconds
  const m = raw.trim().match(/^(\d+)\s*m$/);
  if (m) return Number(m[1]) * 60 * 1000; // "10m"
  const h = raw.trim().match(/^(\d+)\s*h$/);
  return h ? Number(h[1]) * 60 * 60 * 1000 : 10 * 60 * 1000; // "1h"
}

/** FR-037b: retention interval in ms — reads RETENTION_INTERVAL (default 24h = nightly). */
function retentionIntervalMs(): number {
  const raw = process.env.RETENTION_INTERVAL;
  if (!raw) return 24 * 60 * 60 * 1000;
  const n = Number(raw);
  if (!Number.isNaN(n)) return n; // plain milliseconds
  const h = raw.trim().match(/^(\d+)\s*h$/);
  return h ? Number(h[1]) * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // "24h"
}

/** FR-035: collection interval in ms — reads JOB_COLLECTION_INTERVAL (default 30m). */
function collectIntervalMs(): number {
  const raw = process.env.JOB_COLLECTION_INTERVAL;
  if (!raw) return 30 * 60 * 1000;
  const n = Number(raw);
  if (!Number.isNaN(n)) return n; // plain milliseconds
  const m = raw.trim().match(/^(\d+)\s*m$/);
  if (m) return Number(m[1]) * 60 * 1000; // "30m"
  const h = raw.trim().match(/^(\d+)\s*h$/);
  return h ? Number(h[1]) * 60 * 60 * 1000 : 30 * 60 * 1000; // "2h"
}

@Injectable()
export class LifecycleTasks {
  private readonly logger = new Logger(LifecycleTasks.name);

  constructor(
    private readonly lifecycle: LifecycleService,
    private readonly sources: SourcesService,
    private readonly digests: DigestService,
  ) {}

  @Interval(sweepIntervalMs()) // FR-034a: configurable via EXPIRATION_SWEEP_INTERVAL (default 6h)
  async sweep() {
    try {
      await this.lifecycle.sweepExpired();
    } catch (e) {
      this.logger.error('Expiration sweep failed', e);
    }
  }

  @Interval(retentionIntervalMs()) // FR-037b: nightly retention archiver (RETENTION_INTERVAL, default 24h)
  async retain() {
    try {
      await this.lifecycle.retentionArchive();
    } catch (e) {
      this.logger.error('Retention archive failed', e);
    }
  }

  @Interval(matchCycleIntervalMs()) // FR-018/FR-037a: per-user match cycle (MATCH_CYCLE_INTERVAL, default 10 min)
  async cycle() {
    try {
      await this.lifecycle.ghostDetect();
      await this.lifecycle.runMatchCycle();
    } catch (e) {
      this.logger.error('Match cycle failed', e);
    }
  }

  @Interval(collectIntervalMs()) // FR-035: scheduled collection (JOB_COLLECTION_INTERVAL, default 30 min)
  async collect() {
    try {
      const sources = await this.sources.listActive();
      for (const s of sources) {
        await this.sources.collect(s.id);
      }
    } catch (e) {
      this.logger.error('Scheduled collection failed', e);
    }
  }

  @Interval(digestIntervalMs()) // FR-028: daily digest (configurable via DIGEST_INTERVAL, default 24h)
  async digest() {
    try {
      await this.digests.runAll();
    } catch (e) {
      this.logger.error('Daily digest failed', e);
    }
  }
}
