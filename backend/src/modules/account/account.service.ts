import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

const CV_UPLOAD_DIR = process.env.CV_UPLOAD_DIR || './uploads/cv';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * FR-002e: deactivate account — set status DISABLED, invalidate tokens,
   * invalidate Telegram link, immediately log out (client discards token).
   */
  async deactivate(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.status !== 'ACTIVE' && user.status !== 'DORMANT') {
      throw new UnauthorizedException('Account is already deactivated or deleted');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'DISABLED',
          tokenInvalidatedAt: new Date(),
        },
      });
      // Invalidate Telegram link.
      await tx.telegramLink.deleteMany({ where: { userId } });
    });

    this.logger.log(`[AUTH] Account deactivated: userId=${userId}`);
    return { ok: true };
  }

  /**
   * FR-002e: soft-delete account — set status DELETED, pseudonymize email,
   * purge CV files from disk, delete Telegram link, clear profile fields.
   * JobMatch and Application history retained in anonymized form.
   */
  async delete(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.status === 'DELETED') {
      throw new UnauthorizedException('Account is already deleted');
    }

    // Pseudonymize email so it cannot be re-registered or traced.
    const pseudonym = `deleted-${userId.slice(0, 8)}@removed.local`;

    await this.prisma.$transaction(async (tx) => {
      // Delete Telegram link.
      await tx.telegramLink.deleteMany({ where: { userId } });

      // Clear profile fields.
      await tx.candidateProfile.updateMany({
        where: { userId },
        data: {
          title: null,
          summary: null,
          years: 0,
          remote: 0,
          minSalary: 0,
          excludeOnsite: 0,
           employmentTypes: this.prisma.json([]),
        },
      });

      // Delete skills, target roles, locations.
      await tx.candidateSkill.deleteMany({ where: { userId } });
      await tx.targetRole.deleteMany({ where: { userId } });
      await tx.locationPreference.deleteMany({ where: { userId } });

      // Deactivate CV files and purge from disk.
      const cvFiles = await tx.cvFile.findMany({ where: { userId } });
      for (const cv of cvFiles) {
        try {
          if (fs.existsSync(cv.filePath)) {
            fs.unlinkSync(cv.filePath);
          }
        } catch {
          this.logger.warn(`[AUTH] Failed to purge CV file: ${cv.filePath}`);
        }
      }
      await tx.cvFile.deleteMany({ where: { userId } });

      // Soft-delete the user.
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'DELETED',
          email: pseudonym,
          tokenInvalidatedAt: new Date(),
          notificationsPaused: 1,
        },
      });
    });

    this.logger.log(`[AUTH] Account deleted (soft): userId=${userId}`);
    return { ok: true };
  }
}
