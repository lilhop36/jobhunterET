import { Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface QueueJob {
  id: string;
  /** Priority: lower = runs first */
  priority: number;
  /** Function that does the actual work */
  execute: () => Promise<QueueResult>;
  retries: number;
  maxRetries: number;
}

export interface QueueResult {
  status: 'OK' | 'FAIL' | 'SKIPPED';
  jobsFetched?: number;
  jobsCreated?: number;
  duplicates?: number;
  delivered?: number;
  message?: string;
}

export interface QueueStats {
  running: number;
  pending: number;
  completed: number;
  failed: number;
  history: QueueHistoryEntry[];
}

export interface QueueHistoryEntry {
  sourceId: string;
  status: string;
  jobsFetched: number;
  jobsCreated: number;
  duration: number;
  timestamp: Date;
  error?: string;
}

/**
 * Lightweight in-process collection queue.
 * Concurrency-limited, with retry + exponential backoff.
 * Emits events: 'job:completed', 'job:failed', 'batch:completed'.
 */
export class CollectionQueue extends EventEmitter {
  private readonly logger = new Logger(CollectionQueue.name);
  private queue: QueueJob[] = [];
  private running = 0;
  private _completed = 0;
  private _failed = 0;
  private history: QueueHistoryEntry[] = [];
  private readonly maxHistory = 100;

  constructor(
    private readonly concurrency: number,
    private readonly maxRetries: number,
    private readonly retryDelayMs: number,
    private readonly backoffMultiplier: number,
    private readonly maxBackoffMs: number,
  ) {
    super();
  }

  /** Enqueue a source collection job. */
  enqueue(
    sourceId: string,
    execute: () => Promise<QueueResult>,
    priority = 5,
  ): void {
    const job: QueueJob = {
      id: `${sourceId}-${Date.now()}`,
      priority,
      execute,
      retries: 0,
      maxRetries: this.maxRetries,
    };
    this.queue.push(job);
    this.logger.debug(`[QUEUE] Enqueued ${sourceId} (pending: ${this.queue.length})`);
    this.processNext();
  }

  /** Enqueue all sources in priority order. Returns total enqueued. */
  enqueueAll(
    sources: { id: string; priorityTier: string; execute: () => Promise<QueueResult> }[],
  ): number {
    const tierPriority: Record<string, number> = {
      ETHIOPIA: 1,
      INTERNATIONAL: 3,
      DEEP: 5,
    };
    // Sort: Ethiopia sources first, then international
    const sorted = [...sources].sort(
      (a, b) => (tierPriority[a.priorityTier] ?? 5) - (tierPriority[b.priorityTier] ?? 5),
    );
    for (const s of sorted) {
      this.enqueue(s.id, s.execute, tierPriority[s.priorityTier] ?? 5);
    }
    return sorted.length;
  }

  private async processNext(): Promise<void> {
    if (this.running >= this.concurrency || this.queue.length === 0) return;

    this.queue.sort((a, b) => a.priority - b.priority);
    const job = this.queue.shift()!;
    this.running++;
    const startTime = Date.now();

    try {
      const result = await job.execute();
      const duration = Date.now() - startTime;
      this._completed++;

      this.history.unshift({
        sourceId: job.id.replace(/-\d+$/, ''),
        status: result.status,
        jobsFetched: result.jobsFetched ?? 0,
        jobsCreated: result.jobsCreated ?? 0,
        duration,
        timestamp: new Date(),
      });
      if (this.history.length > this.maxHistory) {
        this.history = this.history.slice(0, this.maxHistory);
      }

      this.logger.log(
        `[QUEUE] ${job.id.replace(/-\d+$/, '')} completed in ${duration}ms — ${result.status} (fetched: ${result.jobsFetched ?? 0}, created: ${result.jobsCreated ?? 0})`,
      );
      this.emit('job:completed', { sourceId: job.id.replace(/-\d+$/, ''), result, duration });
    } catch (err: any) {
      const duration = Date.now() - startTime;

      if (job.retries < job.maxRetries) {
        job.retries++;
        const delay = Math.min(
          this.retryDelayMs * Math.pow(this.backoffMultiplier, job.retries - 1),
          this.maxBackoffMs,
        );
        const sourceId = job.id.replace(/-\d+$/, '');
        this.logger.warn(
          `[QUEUE] ${sourceId} failed (attempt ${job.retries}/${job.maxRetries}), retrying in ${delay}ms`,
        );
        // Don't decrement running here — the job is still 'in flight' (pending retry)
        setTimeout(() => {
          this.queue.push(job);
          this.processNext();
        }, delay);
        return;
      }

      this._failed++;
      this.history.unshift({
        sourceId: job.id.replace(/-\d+$/, ''),
        status: 'FAIL',
        jobsFetched: 0,
        jobsCreated: 0,
        duration,
        timestamp: new Date(),
        error: String(err?.message ?? err).slice(0, 200),
      });

      this.logger.error(`[QUEUE] ${job.id.replace(/-\d+$/, '')} failed permanently: ${err?.message}`);
      this.emit('job:failed', { sourceId: job.id.replace(/-\d+$/, ''), error: err?.message });
    } finally {
      this.running--;
      this.processNext();

      // Emit batch completion when queue is drained
      if (this.running === 0 && this.queue.length === 0) {
        this.emit('batch:completed', {
          completed: this._completed,
          failed: this._failed,
        });
      }
    }
  }

  get stats(): QueueStats {
    return {
      running: this.running,
      pending: this.queue.length,
      completed: this._completed,
      failed: this._failed,
      history: [...this.history],
    };
  }

  /** Reset counters (useful between cycles). */
  reset(): void {
    this._completed = 0;
    this._failed = 0;
    this.history = [];
  }
}
