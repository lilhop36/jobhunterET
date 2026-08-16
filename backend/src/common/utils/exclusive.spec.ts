import { createExclusive } from './exclusive';

const tick = () => new Promise((r) => setTimeout(r, 20));

describe('createExclusive', () => {
  it('skips an overlapping call while the first is still running', async () => {
    const exclusive = createExclusive();
    const fn = jest.fn(async () => {
      await tick();
    });
    const [r1, r2] = await Promise.all([exclusive('job', fn), exclusive('job', fn)]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();
  });

  it('allows the same name to run again after completion', async () => {
    const exclusive = createExclusive();
    const fn = jest.fn().mockResolvedValue(7);
    expect(await exclusive('job', fn)).toBe(7);
    expect(await exclusive('job', fn)).toBe(7);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs different names concurrently', async () => {
    const exclusive = createExclusive();
    const a = jest.fn(async () => {
      await tick();
    });
    const b = jest.fn(async () => {
      await tick();
    });
    await Promise.all([exclusive('a', a), exclusive('b', b)]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('releases the lock even when fn throws', async () => {
    const exclusive = createExclusive();
    const boom = jest.fn(async () => {
      throw new Error('boom');
    });
    await expect(exclusive('job', boom)).rejects.toThrow('boom');
    const ok = jest.fn().mockResolvedValue(1);
    await expect(exclusive('job', ok)).resolves.toBe(1); // lock was released
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
