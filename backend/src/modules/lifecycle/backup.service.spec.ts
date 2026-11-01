/**
 * NFR-008 (SRS §26): "Run a scripted nightly … backup. Copy /uploads … Rotate backups
 * after 7 days. Log backup activity with `[BACKUP]`."
 *
 * The scheduling half of that contract lives in lifecycle.tasks.ts (FR-037b/nightly
 * cadence, already covered there). What is covered here is the service boundary the
 * schedule depends on: `LifecycleService.runBackup()` must invoke the operator's
 * backup script, must report what the script said, must be honest when the script is
 * absent, and must never throw into the scheduler when a backup fails.
 *
 * `child_process` and `fs/promises` are stubbed so no shell and no real backup
 * directory are touched — the assertions are about the contract, not about bash.
 */
jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('fs/promises', () => ({ access: jest.fn() }));
// util.promisify inspects util.promisify.custom on the function it wraps, so the
// stub has to stay a real function object created inside the mock factory.
jest.mock('util', () => {
  const actual = jest.requireActual('util');
  return {
    ...actual,
    promisify: (fn: any) =>
      (...args: any[]) =>
        new Promise((resolve, reject) =>
          fn(...args, (err: Error | null, stdout: string, stderr: string) =>
            err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr }),
          ),
        ),
  };
});

import { execFile } from 'child_process';
import { access } from 'fs/promises';
import { LifecycleService } from './lifecycle.service';

const execFileMock = execFile as unknown as jest.Mock;
const accessMock = access as unknown as jest.Mock;

/** Nest's ConsoleLogger sends log() to stdout and warn()/error() to stderr. */
function captureLogs() {
  const lines: string[] = [];
  const streams = [process.stdout, process.stderr] as const;
  const originals = streams.map((s) => s.write.bind(s) as (...args: any[]) => boolean);
  streams.forEach((stream, i) => {
    (stream as any).write = (...args: any[]) => {
      lines.push(String(args[0]));
      return originals[i](...args);
    };
  });
  return {
    text: () => lines.join(''),
    restore: () => streams.forEach((stream, i) => ((stream as any).write = originals[i])),
  };
}

/** Drives the promisify(execFile) callback the way node's child_process would. */
function respondWith(error: Error | null, stdout = '', stderr = '') {
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (...a: any[]) => void) => {
    if (error) Object.assign(error, { stdout, stderr });
    cb(error, stdout, stderr);
  });
}

describe('LifecycleService.runBackup — NFR-008 nightly backup', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('runs the backup script and logs [BACKUP] when it succeeds', async () => {
    accessMock.mockResolvedValue(undefined);
    respondWith(null, 'SQLite backup complete: ./backups/sqlite/jobhunter_20261030_020000.db.gz\n', '');
    const logged = captureLogs();
    const service = new LifecycleService({} as any, {} as any);

    const result = await service.runBackup();

    expect(result.ok).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileMock.mock.calls[0];
    expect(cmd).toBe('bash');
    expect(args[0]).toMatch(/[\\/]scripts[\\/]backup\.sh$/);
    expect(logged.text()).toContain('[BACKUP] Nightly backup completed');
    logged.restore();
  });

  it('skips with a warning instead of failing when the script is not installed', async () => {
    accessMock.mockRejectedValue(new Error('ENOENT'));
    respondWith(null);
    const logged = captureLogs();
    const service = new LifecycleService({} as any, {} as any);

    const result = await service.runBackup();

    expect(result).toEqual({ ok: false, skipped: true });
    expect(execFileMock).not.toHaveBeenCalled();
    expect(logged.text()).toContain('[BACKUP] Script not found');
    logged.restore();
  });

  it('reports failure and keeps the script output for the operator', async () => {
    accessMock.mockResolvedValue(undefined);
    respondWith(new Error('Command failed: bash scripts/backup.sh'), '', 'pg_dump: could not connect to server');
    const logged = captureLogs();
    const service = new LifecycleService({} as any, {} as any);

    const result = await service.runBackup();

    expect(result.ok).toBe(false);
    expect(result.skipped).toBeUndefined();
    expect(result.output).toContain('pg_dump: could not connect to server');
    expect(logged.text()).toContain('[BACKUP] Nightly backup failed');
    logged.restore();
  });

  it('does not throw, so a failed backup cannot kill the scheduler', async () => {
    accessMock.mockResolvedValue(undefined);
    respondWith(new Error('disk full'));
    const service = new LifecycleService({} as any, {} as any);

    await expect(service.runBackup()).resolves.toMatchObject({ ok: false });
  });

  it('bounds the captured output instead of logging the whole dump', async () => {
    accessMock.mockResolvedValue(undefined);
    respondWith(null, 'x'.repeat(50_000));
    const service = new LifecycleService({} as any, {} as any);

    const result = await service.runBackup();

    expect(result.output!.length).toBeLessThanOrEqual(4000);
  });
});
