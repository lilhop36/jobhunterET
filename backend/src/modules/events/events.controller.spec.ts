import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { Observable, of } from 'rxjs';

/**
 * SEC-011 — the SSE stream authenticates like every other protected route.
 *
 * EventSource cannot set an Authorization header, so the token reaches this endpoint as the
 * HttpOnly `jh_token` cookie that login writes (or a query parameter for non-browser clients).
 * Either way the stream must not open for a token that would be refused elsewhere: forged,
 * expired-by-invalidation, or belonging to a deactivated account.
 */
function build(opts: {
  user?: any;
  verify?: (token: string) => any;
}) {
  const subscribe = jest.fn().mockReturnValue({
    stream$: of({ type: 'match', jobId: 'j1', score: 90 } as any),
    close: jest.fn(),
  });
  const events = { subscribe } as unknown as EventsService;
  const jwt = { verify: opts.verify ?? ((t: string) => (t === 'good' ? { sub: 'u1', iat: 1000 } : (() => { throw new Error('bad jwt'); })())) } as unknown as JwtService;
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(opts.user === undefined ? { id: 'u1', status: 'ACTIVE', tokenInvalidatedAt: null } : opts.user) },
  } as unknown as PrismaService;

  return { controller: new EventsController(events, jwt, prisma), subscribe };
}

const reqWith = (cookies?: Record<string, string>) => ({ cookies }) as any;

describe('SEC-011 — SSE stream authentication', () => {
  it('accepts the HttpOnly cookie when no query token is present', async () => {
    const { controller, subscribe } = build({});
    await expect(controller.stream('', reqWith({ jh_token: 'good' }))).resolves.toBeInstanceOf(Observable);
    expect(subscribe).toHaveBeenCalledWith('u1');
  });

  it('still accepts a query token for non-browser clients', async () => {
    const { controller } = build({});
    await expect(controller.stream('good', reqWith({}))).resolves.toBeInstanceOf(Observable);
  });

  it('refuses a stream with no token at all', async () => {
    const { controller, subscribe } = build({});
    await expect(controller.stream('', reqWith({}))).rejects.toThrow('Unauthorized');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('refuses a token that does not verify', async () => {
    const { controller, subscribe } = build({});
    await expect(controller.stream('forged', reqWith({ jh_token: 'forged' }))).rejects.toThrow('Unauthorized');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('refuses a token from an account that is no longer ACTIVE', async () => {
    const { controller, subscribe } = build({ user: { id: 'u1', status: 'DORMANT', tokenInvalidatedAt: null } });
    await expect(controller.stream('good', reqWith({}))).rejects.toThrow('Unauthorized');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('refuses a token issued before the account was logged out everywhere', async () => {
    const { controller, subscribe } = build({
      user: { id: 'u1', status: 'ACTIVE', tokenInvalidatedAt: new Date(2000 * 1000) },
    });
    await expect(controller.stream('good', reqWith({}))).rejects.toThrow('Unauthorized');
    expect(subscribe).not.toHaveBeenCalled();
  });
});
