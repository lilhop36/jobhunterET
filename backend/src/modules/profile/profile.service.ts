import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { UpdateProfileDto } from './dto/profile.dto';
import { normalizeSkill } from '../matching/matching-engine';

export interface ProfileView {
  title: string | null;
  summary: string | null;
  years: number;
  remote: boolean;
  minSalary: number;
  excludeOnsite: boolean;
  employmentTypes: string[];
  onboardDone: boolean;
  skills: string[];
  targetRoles: { role: string; priority: string }[];
  locationTiers: { region: string; tier: string }[];
  completion: number;
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
  ) {}

  async getProfile(userId: string): Promise<ProfileView> {
    const p = await this.prisma.candidateProfile.findUnique({
      where: { userId },
    });
    if (!p) throw new NotFoundException('Profile not found');
    const [skills, roles, locations] = await Promise.all([
      this.prisma.candidateSkill.findMany({ where: { userId }, include: { skill: true } }),
      this.prisma.targetRole.findMany({ where: { userId } }),
      this.prisma.locationPreference.findMany({ where: { userId } }),
    ]);
    return {
      title: p.title,
      summary: p.summary,
      years: p.years,
      remote: p.remote,
      minSalary: p.minSalary,
      excludeOnsite: p.excludeOnsite,
      employmentTypes: this.prisma.isSQLite && typeof p.employmentTypes === 'string' ? (() => { try { return JSON.parse(p.employmentTypes); } catch { return []; } })() : p.employmentTypes,
      onboardDone: p.onboardDone,
      skills: skills.map((s) => s.skill.name),
      targetRoles: roles.map((r) => ({ role: r.role, priority: r.priority })),
      locationTiers: locations.map((l) => ({ region: l.region, tier: l.tier })),
      completion: await this.completion(userId),
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: any = {};
    for (const k of ['title', 'summary', 'years', 'remote', 'minSalary', 'excludeOnsite', 'employmentTypes', 'onboardDone'] as const) {
      if (dto[k] !== undefined) {
        // SQLite compat: stringify arrays and convert booleans to int
        let val = dto[k];
        if (this.prisma.isSQLite) {
          if (k === 'employmentTypes' && Array.isArray(val)) val = JSON.stringify(val);
          if (typeof val === 'boolean') val = val ? 1 : 0;
        }
        data[k] = val;
      }
    }

    const touchedCore = UpdateProfileDto.CORE_KEYS.some((k) => (dto as any)[k] !== undefined);

    await this.prisma.$transaction(async (tx) => {
      await tx.candidateProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });

      if (dto.skills) {
        await tx.candidateSkill.deleteMany({ where: { userId } });
        for (const raw of dto.skills) {
          const name = normalizeSkill(raw);
          const skill = await tx.skill.upsert({
            where: { name },
            create: { name },
            update: {},
          });
          await tx.candidateSkill.create({ data: { userId, skillId: skill.id } });
        }
      }
      if (dto.targetRoles) {
        await tx.targetRole.deleteMany({ where: { userId } });
        for (const tr of dto.targetRoles) {
          await tx.targetRole.create({ data: { userId, role: tr.role, priority: tr.priority } });
        }
      }
      if (dto.locationTiers) {
        await tx.locationPreference.deleteMany({ where: { userId } });
        for (const lt of dto.locationTiers) {
          await tx.locationPreference.create({ data: { userId, region: lt.region, tier: lt.tier } });
        }
      }
    });

    if (touchedCore) {
      // FR-003e: recalc is a background task — return immediately (non-blocking),
      // recalc against the most recent ACTIVE jobs in the background.
      this.matching.recalculate(userId).catch((err) => {
        console.error(`[RECALC] background recalc failed for userId=${userId}`, err);
      });
    }

    return this.getProfile(userId);
  }

  /** Completion meter — computed directly, NOT via getProfile (which itself calls completion). */
  async completion(userId: string): Promise<number> {
    const p = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!p) return 0;
    const [skillCount, roleCount, locCount, cv] = await Promise.all([
      this.prisma.candidateSkill.count({ where: { userId } }),
      this.prisma.targetRole.count({ where: { userId } }),
      this.prisma.locationPreference.count({ where: { userId } }),
      this.prisma.cvFile.findFirst({ where: { userId, active: this.prisma.bool(true) as any } }),
    ]);
    let v = 0;
    if (p.title) v += 10;
    if (p.summary) v += 5;
    v += Math.min(15, skillCount * 5);
    v += Math.min(20, roleCount * 7);
    if (locCount) v += 15;
    const et = this.prisma.isSQLite && typeof p.employmentTypes === 'string' ? (() => { try { return JSON.parse(p.employmentTypes); } catch { return []; } })() : p.employmentTypes;
    if (et.length) v += 10;
    if (p.years > 0) v += 5;
    if (p.minSalary > 0) v += 5;
    if (cv) v += 15;
    return v;
  }
}
