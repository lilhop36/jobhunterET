import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LifecycleService } from './lifecycle.service';
import { SourcesService } from '../sources/sources.service';
import { DigestService } from '../digest/digest.service';
import { createExclusive } from '../../common/utils/exclusive';

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
function backupIntervalMs(): number {
  const raw = process.env.BACKUP_INTERVAL;
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
  // BUG-003: skip a tick when the previous run is still in flight, so a slow
  // cycle (hung fetch, backlog of jobs) can never stack concurrent runs.
  private readonly runExclusive = createExclusive();

  constructor(
    private readonly lifecycle: LifecycleService,
    private readonly sources: SourcesService,
    private readonly digests: DigestService,
  ) {}

  @Interval(sweepIntervalMs()) // FR-034a: configurable via EXPIRATION_SWEEP_INTERVAL (default 6h)
  async sweep() {
    await this.runExclusive('sweep', async () => {
      try {
        await this.lifecycle.sweepExpired();
      } catch (e) {
        this.logger.error('Expiration sweep failed', e);
      }
    });
  }

  @Interval(retentionIntervalMs()) // FR-037b: nightly retention archiver (RETENTION_INTERVAL, default 24h)
  async retain() {
    await this.runExclusive('retain', async () => {
      try {
        await this.lifecycle.retentionArchive();
      } catch (e) {
        this.logger.error('Retention archive failed', e);
      }
    });
  }

  @Interval(matchCycleIntervalMs()) // FR-018/FR-037a: per-user match cycle (MATCH_CYCLE_INTERVAL, default 10 min)
  async cycle() {
    await this.runExclusive('cycle', async () => {
      try {
        await this.lifecycle.ghostDetect();
        await this.lifecycle.runMatchCycle();
      } catch (e) {
        this.logger.error('Match cycle failed', e);
      }
    });
  }

  @Interval(collectIntervalMs()) // FR-035: scheduled collection via queue (JOB_COLLECTION_INTERVAL, default 30 min)
  async collect() {
    await this.runExclusive('collect', async () => {
      try {
        const result = this.sources.collectAll();
        this.logger.log(`Scheduled collection: enqueued ${result.enqueued} sources`);
      } catch (e) {
        this.logger.error('Scheduled collection failed', e);
      }
    });
  }

  @Interval(digestIntervalMs()) // FR-028: daily digest (configurable via DIGEST_INTERVAL, default 24h)
  async digest() {
    await this.runExclusive('digest', async () => {
      try {
        await this.digests.runAll();
      } catch (e) {
        this.logger.error('Daily digest failed', e);
      }
    });
  }

  /** FR-034d: nightly dormancy sweep — mark inactive users as DORMANT. */
  @Interval(24 * 60 * 60 * 1000) // nightly (24h)
  async dormancySweep() {
    await this.runExclusive('dormancy', async () => {
      try {
        await this.lifecycle.sweepDormant();
      } catch (e) {
        this.logger.error('Dormancy sweep failed', e);
      }
    });
  }

  /** FR-034c: daily link-rot sweep — recheck apply URLs for active jobs. */
  @Interval(24 * 60 * 60 * 1000) // daily (24h)
  async linkRotSweep() {
    await this.runExclusive('linkrot', async () => {
      try {
        await this.lifecycle.sweepLinkRot();
      } catch (e) {
        this.logger.error('Link-rot sweep failed', e);
      }
    });
  }

  /** FR-037c: nightly notification & log retention. */
  @Interval(24 * 60 * 60 * 1000) // nightly (24h)
  async notificationRetention() {
    await this.runExclusive('retention-notify', async () => {
      try {
        await this.lifecycle.retentionNotificationsAndLogs();
      } catch (e) {
        this.logger.error('Notification retention failed', e);
      }
    });
  }

  /** NFR-008: nightly PostgreSQL + uploads backup. */
  @Interval(backupIntervalMs())
  async backup() {
    await this.runExclusive('backup', async () => {
      await this.lifecycle.runBackup();
    });
  }
}
