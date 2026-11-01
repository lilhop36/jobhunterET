import 'reflect-metadata';
import {
  LifecycleTasks,
  collectIntervalMs,
  deepCollectIntervalMs,
  digestSchedule,
  matchCycleIntervalMs,
  retentionIntervalMs,
  sweepIntervalMs,
} from './lifecycle.tasks';

/**
 * FR-028 (SRS §21): the daily digest is a per-user report whose default send time
 * is 08:00 Africa/Addis_Ababa. The scheduler must fire at that wall-clock time,
 * not a rolling 24 hours measured from process start.
 */
describe('FR-028 — Daily digest schedule (per user)', () => {
  const original = { cron: process.env.DIGEST_CRON, tz: process.env.DIGEST_TIMEZONE };

  afterEach(() => {
    if (original.cron === undefined) delete process.env.DIGEST_CRON;
    else process.env.DIGEST_CRON = original.cron;
    if (original.tz === undefined) delete process.env.DIGEST_TIMEZONE;
    else process.env.DIGEST_TIMEZONE = original.tz;
  });

  it('is scheduled as a cron at 08:00 Africa/Addis_Ababa by default', () => {
    delete process.env.DIGEST_CRON;
    delete process.env.DIGEST_TIMEZONE;
    expect(digestSchedule()).toEqual({ cron: '0 0 8 * * *', timeZone: 'Africa/Addis_Ababa' });

    const options = cronOptions(LifecycleTasks.prototype.digest as any);
    expect(options.cronTime).toBe('0 0 8 * * *');
    expect(options.timeZone).toBe('Africa/Addis_Ababa');
    expect(options.name).toBe('daily-digest');
  });

  it('lets an operator override the send time without redeploying code', () => {
    process.env.DIGEST_CRON = '0 30 7 * * 1-5';
    process.env.DIGEST_TIMEZONE = 'UTC';
    expect(digestSchedule()).toEqual({ cron: '0 30 7 * * 1-5', timeZone: 'UTC' });
  });

  it('runs the per-user digest for everyone when the schedule fires', async () => {
    const digests = { runAll: jest.fn().mockResolvedValue(undefined) } as any;
    const tasks = new LifecycleTasks({} as any, {} as any, digests);
    await tasks.digest();
    expect(digests.runAll).toHaveBeenCalledTimes(1);
  });

  it('keeps the schedule alive when one digest run throws', async () => {
    const digests = { runAll: jest.fn().mockRejectedValue(new Error('telegram timeout')) } as any;
    const logged = captureStderr();
    const tasks = new LifecycleTasks({} as any, {} as any, digests);
    await expect(tasks.digest()).resolves.toBeUndefined();
    expect(logged.text()).toContain('Daily digest failed');
    logged.restore();
  });
});

/** Nest's ConsoleLogger writes errors to stderr, not through console.error. */
function captureStderr() {
  const lines: string[] = [];
  const spy = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: any) => {
      lines.push(String(chunk));
      return true;
    }) as any);
  return { text: () => lines.join('\n'), restore: () => void spy.mockRestore() };
}

/**
 * FR-034 / FR-034a (SRS §23): async processing covers collection, matching,
 * profile recalculation, notifications, digest, lifecycle sweeps, retention and
 * backups on @nestjs/schedule. The expiration sweeper runs every 6 hours by
 * default and is configurable.
 */
describe('FR-034 — Background jobs', () => {
  const HOUR = 60 * 60 * 1000;

  function makeTasks() {
    const lifecycle: any = {
      sweepExpired: jest.fn().mockResolvedValue(0),
      ghostDetect: jest.fn().mockResolvedValue(0),
      runMatchCycle: jest.fn().mockResolvedValue(undefined),
      retentionArchive: jest.fn().mockResolvedValue(0),
      retentionNotificationsAndLogs: jest.fn().mockResolvedValue({ notifications: 0, logs: 0 }),
      sweepDormant: jest.fn().mockResolvedValue(0),
      sweepLinkRot: jest.fn().mockResolvedValue(0),
      runBackup: jest.fn().mockResolvedValue({ ok: true }),
    };
    const sources: any = {
      collectDue: jest.fn().mockResolvedValue({ enqueued: 0, skipped: [], due: [] }),
      collectDeepDue: jest.fn().mockResolvedValue({ enqueued: 0, skipped: [], due: [] }),
    };
    const digests: any = { runAll: jest.fn().mockResolvedValue(undefined) };
    return { tasks: new LifecycleTasks(lifecycle, sources, digests), lifecycle, sources, digests };
  }

  it('routes every documented background job to its service', async () => {
    const { tasks, lifecycle, sources, digests } = makeTasks();
    const routes: [string, () => Promise<unknown>, jest.Mock][] = [
      ['expiration sweep', () => tasks.sweep(), lifecycle.sweepExpired],
      ['retention archiver', () => tasks.retain(), lifecycle.retentionArchive],
      ['ghost detection', () => tasks.cycle(), lifecycle.ghostDetect],
      ['match cycle', () => tasks.cycle(), lifecycle.runMatchCycle],
      ['scheduled collection', () => tasks.collect(), sources.collectDue],
      ['deep collection', () => tasks.collectDeep(), sources.collectDeepDue],
      ['daily digest', () => tasks.digest(), digests.runAll],
      ['dormancy sweep', () => tasks.dormancySweep(), lifecycle.sweepDormant],
      ['link-rot sweep', () => tasks.linkRotSweep(), lifecycle.sweepLinkRot],
      ['notification & log retention', () => tasks.notificationRetention(), lifecycle.retentionNotificationsAndLogs],
      ['nightly backup', () => tasks.backup(), lifecycle.runBackup],
    ];
    for (const [, run] of routes) await run();
    for (const [label, , target] of routes) expect(target).toHaveBeenCalled();
  });

  it('a failing job is logged and never escapes into the scheduler', async () => {
    const { tasks, lifecycle } = makeTasks();
    lifecycle.sweepExpired.mockRejectedValue(new Error('db locked'));
    const logged = captureStderr();
    await expect(tasks.sweep()).resolves.toBeUndefined();
    expect(logged.text()).toContain('Expiration sweep failed');
    logged.restore();
  });

  it('a job that outruns its tick is skipped rather than stacked (BUG-003)', async () => {
    const { tasks, lifecycle } = makeTasks();
    let release!: (value?: unknown) => void;
    lifecycle.sweepExpired.mockImplementation(
      () => new Promise<number>((r) => (release = () => r(0))),
    );

    const first = tasks.sweep();
    await tasks.sweep(); // the next tick sees the lock held and does nothing
    expect(lifecycle.sweepExpired).toHaveBeenCalledTimes(1);

    release();
    await first;

    lifecycle.sweepExpired.mockResolvedValue(0); // the run finished; the lock released
    await tasks.sweep();
    expect(lifecycle.sweepExpired).toHaveBeenCalledTimes(2);
  });

  it('FR-034a: the expiration sweeper defaults to every 6 hours and honours EXPIRATION_SWEEP_INTERVAL', () => {
    const original = process.env.EXPIRATION_SWEEP_INTERVAL;
    delete process.env.EXPIRATION_SWEEP_INTERVAL;
    expect(sweepIntervalMs()).toBe(6 * HOUR);
    process.env.EXPIRATION_SWEEP_INTERVAL = '12h';
    expect(sweepIntervalMs()).toBe(12 * HOUR);
    process.env.EXPIRATION_SWEEP_INTERVAL = '900000';
    expect(sweepIntervalMs()).toBe(15 * 60 * 1000);
    if (original === undefined) delete process.env.EXPIRATION_SWEEP_INTERVAL;
    else process.env.EXPIRATION_SWEEP_INTERVAL = original;
  });

  it('matches the documented cadences for the other recurring jobs', () => {
    const original = {
      match: process.env.MATCH_CYCLE_INTERVAL,
      retention: process.env.RETENTION_INTERVAL,
      collect: process.env.JOB_COLLECTION_INTERVAL,
      deep: process.env.DEEP_COLLECTION_INTERVAL,
    };
    for (const key of Object.keys(original)) delete process.env[key as keyof typeof original];
    expect(matchCycleIntervalMs()).toBe(10 * 60 * 1000); // overview: every 10 minutes
    expect(retentionIntervalMs()).toBe(24 * HOUR); // nightly
    expect(collectIntervalMs()).toBe(30 * 60 * 1000); // FR-035
    expect(deepCollectIntervalMs()).toBe(60 * 60 * 1000); // FR-035b

    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key as keyof typeof original];
      else process.env[key as keyof typeof original] = value;
    }
  });
});

/** Reads the @Cron options Nest stored on the handler. */
function cronOptions(handler: any): { cronTime: string; timeZone?: string; name?: string } {
  for (const key of Reflect.getMetadataKeys(handler)) {
    const value: any = Reflect.getMetadata(key, handler);
    if (value && typeof value === 'object' && 'cronTime' in value) return value;
  }
  throw new Error('no @Cron metadata on handler');
}
