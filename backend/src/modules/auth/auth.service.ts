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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private async hash(pw: string): Promise<string> {
    return bcrypt.hash(pw, 10);
  }

  /**
   * FR-001 role-assignment precedence:
   * - If ADMIN_EMAILS is non-empty, only emails in that list become ADMIN.
   * - If ADMIN_EMAILS is empty, the first user ever registered becomes ADMIN.
   * - All other registrations become USER.
   */
  private decideRole(email: string, isFirstUser: boolean): 'USER' | 'ADMIN' {
    const list = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (list.length > 0) {
      // When the list is configured, only listed emails become ADMIN.
      return list.includes(email.toLowerCase()) ? 'ADMIN' : 'USER';
    }
    // Empty list: first user is ADMIN, rest are USER.
    return isFirstUser ? 'ADMIN' : 'USER';
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

    const count = await this.prisma.user.count();
    const role = this.decideRole(dto.email, count === 0);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await this.hash(dto.password),
        role,
        profile: { create: {} },
      },
    });

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
      // Background recalc is triggered by the profile module or login hook.
    } else {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() },
      });
    }

    return this.tokenFor(user);
  }

  private tokenFor(user: { id: string; email: string; role: 'USER' | 'ADMIN' }) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      accessToken: this.jwt.sign(payload),
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
