import { Controller, Get, Logger, Query, Req, Sse } from '@nestjs/common';
import { Observable, merge, finalize, map, timer } from 'rxjs';
import { EventsService, SseEvent } from './events.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../../common/guards/jwt-auth.guard';
import { Request } from 'express';

/**
 * SSE controller — the client hits /api/events/stream.
 *
 * SEC-011: token is now read from an HttpOnly cookie (jh_token) set at login,
 * avoiding exposure in browser history, server logs, and referrer headers.
 * EventSource always sends same-origin cookies automatically.
 */
@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  /** How often to send keepalive comments (prevents proxy/LB timeouts). */
  private static readonly KEEPALIVE_MS = 30_000;

  constructor(
    private readonly events: EventsService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('stream')
  @Sse('stream')
  async stream(@Query('token') token: string, @Req() req: Request): Promise<Observable<{ event: string; data: SseEvent }>> {
    // Accept token from cookie (browser) or query param (API clients)
    const resolvedToken = token || req.cookies?.jh_token;
    if (!resolvedToken) {
      throw new Error('Unauthorized');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(resolvedToken);
    } catch {
      throw new Error('Unauthorized');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, tokenInvalidatedAt: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new Error('Unauthorized');
    }
    if (
      user.tokenInvalidatedAt &&
      payload.iat < Math.floor(user.tokenInvalidatedAt.getTime() / 1000)
    ) {
      throw new Error('Unauthorized');
    }

    // ── Register SSE subscription ─────────────────────────────
    const userId = user.id;
    const { stream$, close } = this.events.subscribe(userId);

    // Keepalive: emit a comment every 30s so proxies don't kill the connection.
    const keepalive$ = timer(0, EventsController.KEEPALIVE_MS).pipe(
      map(() => ({ event: 'keepalive', data: { type: 'keepalive' } as any })),
    );

    // Merge match events + keepalive. NestJS auto-unsubscribes when the
    // client disconnects; we use finalize to clean up the EventsService slot.
    return merge(
      stream$.pipe(map((evt) => ({ event: evt.type, data: evt }))),
      keepalive$,
    ).pipe(finalize(() => close()));
  }
}
