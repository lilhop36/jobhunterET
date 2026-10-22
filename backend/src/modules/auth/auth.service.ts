import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto, LoginDto, ChangePasswordDto } from './dto/auth.dto';
import { MatchingService } from '../matching/matching.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly matching: MatchingService,
  ) {}

  private async hash(pw: string): Promise<string> {
    return bcrypt.hash(pw, 12);
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    // FR-002g: optional invite code gate.
    const requiredCode = process.env.REGISTRATION_INVITE_CODE;
    if (requiredCode && dto.inviteCode !== requiredCode) {
      throw new ForbiddenException('Invalid invite code');
    }

    // Determine role atomically to avoid a race on "first user".
    const role = await this.prisma.$transaction(async (tx) => {
      const count = await tx.user.count();
      const list = (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      if (list.length > 0) return list.includes(dto.email.toLowerCase()) ? 'ADMIN' : 'USER';
      if (count === 0) {
        if (!requiredCode) {
          this.logger.warn('[AUTH] First user becoming ADMIN with no invite code configured — set ADMIN_EMAILS or REGISTRATION_INVITE_CODE for production.');
        }
        return 'ADMIN';
      }
      return 'USER';
    });

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash: await this.hash(dto.password),
          role,
          profile: { create: {} },
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('Email already registered');
      }
      this.logger.warn(`[AUTH] Nested profile create failed: ${err.message} — creating user without profile`);
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash: await this.hash(dto.password),
          role,
        },
      });
    }

    this.logger.log(`[AUTH] User registered: userId=${user.id} role=${role}`);
    return this.tokenFor(user);
  }

  /** FR-002c: authenticated password change — current password must verify. */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    // FR-002h: invalidate existing tokens on password change.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.hash(dto.newPassword),
        tokenInvalidatedAt: new Date(),
      },
    });
    this.logger.log(`[AUTH] Password changed: userId=${userId}`);
    return { ok: true };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    // FR-001a: disabled/deleted users cannot log in.
    if (user.status === 'DISABLED' || user.status === 'DELETED') {
      throw new UnauthorizedException('Account is not active');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // FR-003e2: dormant user reactivation — set ACTIVE, update lastActiveAt, enqueue recalc.
    if (user.status === 'DORMANT') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', lastActiveAt: new Date() },
      });
      this.logger.log(`[AUTH] Dormant user reactivated: userId=${user.id}`);
      this.matching.recalculate(user.id).catch((err) => {
        this.logger.error(`[RECALC] dormant login recalc failed for userId=${user.id}`, err);
      });
    } else {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() },
      });
    }

    return this.tokenFor(user);
  }

  private tokenFor(user: { id: string; email: string; role: string }) {
    const payload = { sub: user.id, email: user.email, role: user.role as 'USER' | 'ADMIN' };
    return {
      accessToken: this.jwt.sign(payload),
      user: { id: user.id, email: user.email, role: user.role as 'USER' | 'ADMIN' },
    };
  }
}
