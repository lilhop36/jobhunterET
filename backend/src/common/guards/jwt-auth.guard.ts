import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'USER' | 'ADMIN';
  iat: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice(7);
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // FR-002h: reject tokens issued before the user's invalidation timestamp.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, status: true, tokenInvalidatedAt: true },
    });
    if (!user || user.status === 'DISABLED' || user.status === 'DELETED') {
      throw new UnauthorizedException('Account is not active');
    }
    if (user.tokenInvalidatedAt && payload.iat < Math.floor(user.tokenInvalidatedAt.getTime() / 1000)) {
      throw new UnauthorizedException('Token has been invalidated — please log in again');
    }

    // FR-001a: update lastActiveAt on authenticated activity.
    await this.prisma.user.update({
      where: { id: payload.sub },
      data: { lastActiveAt: new Date() },
    });

    req.user = { id: user.id, email: user.email, role: user.role };
    return true;
  }
}
