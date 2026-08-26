import { AuthController } from './auth.controller';

describe('AuthController — SEC-005 rate limiting', () => {
  function makeController() {
    const auth: any = {
      register: jest.fn().mockResolvedValue({}),
      login: jest.fn().mockResolvedValue({ accessToken: 't' }),
      changePassword: jest.fn().mockResolvedValue({ ok: true }),
    };
    return { ctrl: new AuthController(auth), auth };
  }

  function fakeRes() {
    return { cookie: jest.fn(), status: jest.fn().mockReturnThis() } as any;
  }

  async function expect429(p: Promise<unknown>) {
    try {
      await p;
      throw new Error('expected an HttpException');
    } catch (e: any) {
      expect(e.getStatus?.()).toBe(429);
    }
  }

  it('rejects login after the per-IP budget (10) is exhausted', async () => {
    const { ctrl } = makeController();
    const req = { ip: '10.0.0.1' } as any;
    // Fresh email per attempt so only the IP budget is consumed.
    for (let i = 0; i < 10; i++) {
      await ctrl.login(req, { email: `u${i}@b.et`, password: 'x'.repeat(8) } as any, fakeRes());
    }
    await expect429(ctrl.login(req, { email: 'final@b.et', password: 'x'.repeat(8) } as any, fakeRes()));
  });

  it('also enforces the per-email budget (5) independently of the IP budget', async () => {
    const { ctrl } = makeController();
    const req = { ip: '10.0.0.2' } as any; // fresh IP with budget remaining
    const dto = { email: 'a@b.et', password: 'x'.repeat(8) } as any;
    for (let i = 0; i < 5; i++) await ctrl.login(req, dto, fakeRes());
    await expect429(ctrl.login(req, dto, fakeRes())); // 6th attempt for this email → 429
  });

  it('rate limits register per IP', async () => {
    const { ctrl } = makeController();
    const req = { ip: '10.0.0.3' } as any;
    const dto = { email: 'new@b.et', password: 'x'.repeat(8) } as any;
    for (let i = 0; i < 10; i++) await ctrl.register(req, dto, fakeRes());
    await expect429(ctrl.register(req, dto, fakeRes()));
  });

  it('does not throttle requests from different IPs (and emails)', async () => {
    const { ctrl } = makeController();
    for (let i = 0; i < 12; i++) {
      await ctrl.login(
        { ip: `10.0.0.${i + 10}` } as any,
        { email: `u${i}@b.et`, password: 'x'.repeat(8) } as any,
        fakeRes(),
      );
    }
    expect(ctrl['auth'].login).toHaveBeenCalledTimes(12);
  });
});
