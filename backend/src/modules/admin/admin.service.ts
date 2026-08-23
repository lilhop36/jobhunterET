import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * §32.12: Admin analytics dashboard — system overview, source health, match cycle metrics.
   */
  async getStats() {
    const [
      totalUsers,
      activeUsers,
      dormantUsers,
      totalJobs,
      activeJobs,
      expiredJobs,
      removedJobs,
      totalMatches,
      aboveThreshold,
      totalNotifications,
      unreadInbox,
      totalApplications,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { status: 'DORMANT' } }),
      this.prisma.job.count(),
      this.prisma.job.count({ where: { status: 'ACTIVE' } }),
      this.prisma.job.count({ where: { status: 'EXPIRED' } }),
      this.prisma.job.count({ where: { status: 'REMOVED' } }),
      this.prisma.jobMatch.count(),
      this.prisma.jobMatch.count({ where: { score: { gte: 75 } } }),
      this.prisma.notification.count(),
      this.prisma.notification.count({ where: { status: 'UNREAD_WEB' } }),
      this.prisma.application.count(),
    ]);

    const sources = await this.prisma.jobSource.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        priorityTier: true,
        healthScore: true,
        consecutiveFailures: true,
        lastSuccessfulRun: true,
        lastFailedRun: true,
        lastError: true,
        runs: {
          select: {
            avgDescriptionQuality: true,
            linkFailures: true,
            linkChecks: true,
          },
          orderBy: { startedAt: 'desc' },
          take: 3,
        },
      },
      orderBy: { name: 'asc' },
    });

    const lastCycle = await this.prisma.matchCycle.findFirst({
      orderBy: { startedAt: 'desc' },
    });

    const recentActivity = await this.prisma.systemLog.findMany({
      orderBy: { at: 'desc' },
      take: 30,
      select: { tag: true, msg: true, at: true },
    });

    return {
      overview: {
        totalUsers,
        activeUsers,
        dormantUsers,
        totalJobs,
        activeJobs,
        expiredJobs,
        removedJobs,
        totalMatches,
        aboveThreshold,
        totalNotifications,
        unreadInbox,
        totalApplications,
      },
      sourceHealth: sources,
      lastCycle,
      recentActivity,
    };
  }

  /** FR-002f: list user metadata — never CV contents, matches, or notifications. */
  async listUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        lastActiveAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** FR-002f: admin enable/disable or role change. */
  async updateUser(
    adminId: string,
    userId: string,
    dto: { status?: string; role?: string },
  ) {
    if (userId === adminId) {
      throw new BadRequestException('Admin cannot self-modify via this endpoint');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Safeguard: the last remaining ADMIN cannot be disabled or demoted.
    if (dto.role && dto.role !== 'ADMIN' && user.role === 'ADMIN') {
      const adminCount = await this.prisma.user.count({ where: { role: 'ADMIN' } });
      if (adminCount <= 1) {
        throw new ConflictException('Cannot demote the last remaining admin');
      }
    }
    if (dto.status && dto.status !== 'ACTIVE' && user.role === 'ADMIN') {
      const adminCount = await this.prisma.user.count({ where: { role: 'ADMIN' } });
      if (adminCount <= 1) {
        throw new ConflictException('Cannot disable the last remaining admin');
      }
    }

    const data: any = {};
    if (dto.status) data.status = dto.status;
    if (dto.role) data.role = dto.role;
    if (dto.status && dto.status !== 'ACTIVE') {
      data.tokenInvalidatedAt = new Date(); // FR-002h: force-logout
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, role: true, status: true },
    });

    this.logger.log(
      `[AUTH] Admin updated user: userId=${userId} by admin=${adminId} changes=${JSON.stringify(dto)}`,
    );
    return updated;
  }

  /**
   * FR-002f: assisted password reset — returns a one-time temporary password.
   * The admin must share it securely with the user.
   */
  async resetPassword(adminId: string, userId: string) {
    if (userId === adminId) {
      throw new BadRequestException('Use the regular password-change endpoint');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const tempPassword = crypto.randomBytes(12).toString('base64url');
    const hash = await bcrypt.hash(tempPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: hash,
        tokenInvalidatedAt: new Date(), // FR-002h: force-logout on reset
      },
    });

    this.logger.log(
      `[AUTH] Admin reset password for userId=${userId} by admin=${adminId}`,
    );
    return { temporaryPassword: tempPassword };
  }
}
