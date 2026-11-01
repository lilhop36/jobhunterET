import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import {
  CertificationInput,
  EducationInput,
  ExperienceInput,
  LanguageInput,
  ProjectInput,
  UpdateProfileDto,
} from './dto/profile.dto';
import { normalizeSkill } from '../matching/matching-engine';
import { parseCv } from './cv/cv-parser';
import * as fs from 'fs';

export interface ProfileView {
  personal: {
    fullName: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
    country: string | null;
    linkedinUrl: string | null;
    githubUrl: string | null;
    portfolioUrl: string | null;
  };
  title: string | null;
  summary: string | null;
  years: number;
  remote: boolean;
  minSalary: number;
  excludeOnsite: boolean;
  excludeEntryLevel: boolean;
  employmentTypes: string[];
  onboardDone: boolean;
  skills: string[];
  targetRoles: { role: string; priority: string }[];
  locationTiers: { region: string; tier: string }[];
  education: {
    id: string;
    institution: string;
    degree: string | null;
    field: string | null;
    startYear: number | null;
    endYear: number | null;
    grade: string | null;
  }[];
  experiences: {
    id: string;
    title: string;
    company: string;
    location: string | null;
    startYear: number | null;
    endYear: number | null;
    current: boolean;
    description: string | null;
  }[];
  projects: { id: string; name: string; description: string | null; url: string | null; year: number | null }[];
  certifications: { id: string; name: string; issuer: string | null; year: number | null; credentialUrl: string | null }[];
  languages: { id: string; language: string; proficiency: string }[];
  documents: {
    id: string;
    kind: string;
    label: string | null;
    originalName: string;
    sizeBytes: number;
    uploadedAt: Date;
  }[];
  completion: number;
}

const PERSONAL_KEYS = [
  'fullName',
  'phone',
  'city',
  'country',
  'linkedinUrl',
  'githubUrl',
  'portfolioUrl',
] as const;

/** Trim, drop empties, and coerce years — CV import and hand-typed input share this. */
const text = (v?: string | null): string | null => {
  const s = (v ?? '').toString().trim();
  return s ? s.slice(0, 4000) : null;
};

const year = (v?: number | null): number | null => {
  if (v === undefined || v === null || v === ('' as any)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // No plausible CV has a year outside this window.
  if (n < 1950 || n > 2100) return null;
  return Math.round(n);
};

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
    const [user, skills, roles, locations, education, experiences, projects, certifications, languages, documents] =
      await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
        this.prisma.candidateSkill.findMany({ where: { userId }, include: { skill: true } }),
        this.prisma.targetRole.findMany({ where: { userId } }),
        this.prisma.locationPreference.findMany({ where: { userId } }),
        this.prisma.candidateEducation.findMany({ where: { userId }, orderBy: { endYear: 'desc' } }),
        this.prisma.candidateExperience.findMany({ where: { userId }, orderBy: { startYear: 'desc' } }),
        this.prisma.candidateProject.findMany({ where: { userId }, orderBy: { year: 'desc' } }),
        this.prisma.candidateCertification.findMany({ where: { userId }, orderBy: { year: 'desc' } }),
        this.prisma.candidateLanguage.findMany({ where: { userId } }),
        this.prisma.cvFile.findMany({
          where: { userId, active: this.prisma.bool(true) as any },
          orderBy: { uploadedAt: 'desc' },
          select: { id: true, kind: true, label: true, originalName: true, sizeBytes: true, uploadedAt: true },
        }),
      ]);

    return {
      personal: {
        fullName: p.fullName,
        email: user?.email ?? null,
        phone: p.phone,
        city: p.city,
        country: p.country,
        linkedinUrl: p.linkedinUrl,
        githubUrl: p.githubUrl,
        portfolioUrl: p.portfolioUrl,
      },
      title: p.title,
      summary: p.summary,
      years: p.years,
      // SQLite stores booleans as 0/1, so normalise at the API boundary
      // instead of leaking numeric flags into the JSON response.
      remote: Boolean(p.remote),
      minSalary: p.minSalary,
      excludeOnsite: Boolean(p.excludeOnsite),
      excludeEntryLevel: Boolean(p.excludeEntryLevel),
      employmentTypes: this.prisma.jsonArray(p.employmentTypes),
      onboardDone: Boolean(p.onboardDone),
      skills: skills.map((s) => s.skill.name),
      targetRoles: roles.map((r) => ({ role: r.role, priority: r.priority })),
      locationTiers: locations.map((l) => ({ region: l.region, tier: l.tier })),
      education: education.map((e) => ({
        id: e.id,
        institution: e.institution,
        degree: e.degree,
        field: e.field,
        startYear: e.startYear,
        endYear: e.endYear,
        grade: e.grade,
      })),
      experiences: experiences.map((e) => ({
        id: e.id,
        title: e.title,
        company: e.company,
        location: e.location,
        startYear: e.startYear,
        endYear: e.endYear,
        current: Boolean(e.current),
        description: e.description,
      })),
      projects: projects.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        url: e.url,
        year: e.year,
      })),
      certifications: certifications.map((e) => ({
        id: e.id,
        name: e.name,
        issuer: e.issuer,
        year: e.year,
        credentialUrl: e.credentialUrl,
      })),
      languages: languages.map((e) => ({ id: e.id, language: e.language, proficiency: e.proficiency })),
      documents,
      completion: await this.completion(userId),
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: any = {};
    for (const k of ['title', 'years', 'minSalary', 'remote', 'excludeOnsite', 'excludeEntryLevel', 'employmentTypes', 'onboardDone'] as const) {
      if (dto[k] !== undefined) {
        let val = dto[k];
        if (k === 'employmentTypes' && Array.isArray(val)) val = this.prisma.json(val);
        else if (typeof val === 'boolean') val = this.prisma.bool(val);
        data[k] = val;
      }
    }
    if (dto.title !== undefined) data.title = text(dto.title);
    if (dto.summary !== undefined) data.summary = text(dto.summary);
    for (const k of PERSONAL_KEYS) {
      if (dto[k] !== undefined) data[k] = text(dto[k]);
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
          if (!name) continue;
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
          // Accept both string[] and {role, priority}[] from the frontend
          const role = text(typeof tr === 'string' ? tr : tr.role);
          if (!role) continue;
          const priority = typeof tr === 'string' ? 'MEDIUM' : (tr.priority ?? 'MEDIUM');
          await tx.targetRole.create({ data: { userId, role, priority } });
        }
      }
      if (dto.locationTiers) {
        await tx.locationPreference.deleteMany({ where: { userId } });
        for (const lt of dto.locationTiers) {
          const region = text(typeof lt === 'string' ? lt : lt.region);
          if (!region) continue;
          const tier = typeof lt === 'string' ? 'MEDIUM' : (lt.tier ?? 'MEDIUM');
          await tx.locationPreference.create({ data: { userId, region, tier } });
        }
      }

      // Structured sections replace the stored rows whenever the field is sent —
      // the editor always posts the full list it is showing.
      if (dto.education) {
        await tx.candidateEducation.deleteMany({ where: { userId } });
        for (const e of dto.education) {
          const institution = text(e.institution);
          if (!institution) continue;
          await tx.candidateEducation.create({
            data: {
              userId,
              institution,
              degree: text(e.degree),
              field: text(e.field),
              startYear: year(e.startYear),
              endYear: year(e.endYear),
              grade: text(e.grade),
            },
          });
        }
      }
      if (dto.experiences) {
        await tx.candidateExperience.deleteMany({ where: { userId } });
        for (const e of dto.experiences) {
          const title = text(e.title);
          const company = text(e.company);
          if (!title || !company) continue;
          await tx.candidateExperience.create({
            data: {
              userId,
              title,
              company,
              location: text(e.location),
              startYear: year(e.startYear),
              endYear: year(e.endYear),
              current: this.prisma.bool(Boolean(e.current)) as any,
              description: text(e.description),
            },
          });
        }
      }
      if (dto.projects) {
        await tx.candidateProject.deleteMany({ where: { userId } });
        for (const e of dto.projects) {
          const name = text(e.name);
          if (!name) continue;
          await tx.candidateProject.create({
            data: {
              userId,
              name,
              description: text(e.description),
              url: text(e.url),
              year: year(e.year),
            },
          });
        }
      }
      if (dto.certifications) {
        await tx.candidateCertification.deleteMany({ where: { userId } });
        for (const e of dto.certifications) {
          const name = text(e.name);
          if (!name) continue;
          await tx.candidateCertification.create({
            data: {
              userId,
              name,
              issuer: text(e.issuer),
              year: year(e.year),
              credentialUrl: text(e.credentialUrl),
            },
          });
        }
      }
      if (dto.languages) {
        await tx.candidateLanguage.deleteMany({ where: { userId } });
        const seen = new Set<string>();
        for (const e of dto.languages) {
          const language = text(e.language);
          if (!language) continue;
          const key = language.toLowerCase();
          if (seen.has(key)) continue; // unique(userId, language)
          seen.add(key);
          const proficiency = ['NATIVE', 'FLUENT', 'INTERMEDIATE', 'BASIC'].includes(e.proficiency ?? '')
            ? e.proficiency!
            : 'INTERMEDIATE';
          await tx.candidateLanguage.create({ data: { userId, language, proficiency } });
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
    const [skillCount, roleCount, locCount, cv, education, experiences] = await Promise.all([
      this.prisma.candidateSkill.count({ where: { userId } }),
      this.prisma.targetRole.count({ where: { userId } }),
      this.prisma.locationPreference.count({ where: { userId } }),
      this.prisma.cvFile.findFirst({
        where: { userId, active: this.prisma.bool(true) as any, kind: 'CV' },
      }),
      this.prisma.candidateEducation.count({ where: { userId } }),
      this.prisma.candidateExperience.count({ where: { userId } }),
    ]);
    // Weights sum to exactly 100 so the meter never reads 97% at full profile.
    let v = 0;
    if (p.fullName) v += 5;
    if (p.phone) v += 5;
    if (p.city) v += 5;
    if (p.title) v += 5;
    if (p.summary) v += 5;
    v += Math.min(10, skillCount * 5);
    v += Math.min(10, roleCount * 5);
    if (locCount) v += 10;
    const et = this.prisma.jsonArray(p.employmentTypes);
    if (et.length) v += 5;
    if (p.years > 0) v += 5;
    if (p.minSalary > 0) v += 5;
    if (education) v += 10;
    if (experiences) v += 10;
    if (cv) v += 10;
    return v;
  }

  /** Read the active CV, parse it and return a draft. Nothing is written. */
  async importCv(userId: string) {
    const cv = await this.prisma.cvFile.findFirst({
      where: { userId, active: this.prisma.bool(true) as any, kind: 'CV' },
      orderBy: { uploadedAt: 'desc' },
    });
    if (!cv) throw new BadRequestException('Upload a CV before importing.');
    if (!fs.existsSync(cv.filePath)) {
      throw new NotFoundException('CV file missing on disk — upload it again.');
    }
    const buffer = fs.readFileSync(cv.filePath) as Buffer;
    // Lazy: pdf.js is heavy and only this one endpoint needs it.
    const { extractCvText } = require('./cv/cv-text');
    const text = await extractCvText(buffer, cv.originalName);
    return { source: { id: cv.id, originalName: cv.originalName }, draft: parseCv(text) };
  }

  /** Documents attached to the profile (CV, certificates, portfolio, other). */
  async listDocuments(userId: string) {
    return this.prisma.cvFile.findMany({
      where: { userId, active: this.prisma.bool(true) as any },
      orderBy: { uploadedAt: 'desc' },
      select: { id: true, kind: true, label: true, originalName: true, sizeBytes: true, uploadedAt: true },
    });
  }

  async deleteDocument(userId: string, id: string) {
    // updateMany, not update: ownership is part of the WHERE clause so a guessed
    // id belonging to someone else simply matches nothing.
    const { count } = await this.prisma.cvFile.updateMany({
      where: { id, userId },
      data: { active: this.prisma.bool(false) as any },
    });
    if (!count) throw new NotFoundException('Document not found');
    return { ok: true };
  }
}
