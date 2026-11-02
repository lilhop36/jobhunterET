import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileService } from '../profile/profile.service';
import {
  ApplicationPackageContent,
  PackageJob,
  PackageMatch,
  PackageProfile,
  generateApplicationPackage,
} from './generator';

export interface PackageSummary {
  version: number;
  createdAt: Date;
  generatorVersion: string;
  warnings: string[];
}

export interface PackageView extends ApplicationPackageContent {
  id: string;
  jobId: string;
  version: number;
  createdAt: Date;
}

@Injectable()
export class ApplicationDocsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
  ) {}

  /**
   * Generate the next version of the package for one job. The profile source is
   * always the authenticated user's own rows — there is no way to point this at
   * another account's data.
   */
  async generate(userId: string, jobId: string): Promise<PackageView> {
    const profileView = await this.profiles.getProfile(userId);
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { skills: { include: { skill: true } } },
    });
    if (!job) throw new NotFoundException('Job not found');

    const matchRow = await this.prisma.jobMatch.findUnique({
      where: { userId_jobId: { userId, jobId } },
    });

    const profile: PackageProfile = {
      personal: profileView.personal,
      title: profileView.title,
      summary: profileView.summary,
      years: profileView.years,
      skills: profileView.skills,
      education: profileView.education,
      experiences: profileView.experiences,
      projects: profileView.projects,
      certifications: profileView.certifications,
      languages: profileView.languages,
      documents: profileView.documents.map((d) => ({ kind: d.kind, originalName: d.originalName })),
    };

    const packageJob: PackageJob = {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description,
      skills: job.skills.map((s) => s.skill.name),
      experienceLevel: job.experienceLevel,
      deadline: job.deadline,
    };

    const match: PackageMatch | null = matchRow
      ? {
          requiredRequirements: this.requirements(matchRow.requiredRequirements),
          preferredRequirements: this.requirements(matchRow.preferredRequirements),
          missingRequirements: this.prisma.jsonArray(matchRow.missingRequirements),
          unknownRequirements: this.prisma.jsonArray(matchRow.unknownRequirements),
        }
      : null;

    const content = generateApplicationPackage(profile, packageJob, match);

    const latest = await this.prisma.applicationPackage.findFirst({
      where: { userId, jobId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const row = await this.prisma.applicationPackage.create({
      data: {
        userId,
        jobId,
        version: (latest?.version ?? 0) + 1,
        // Stored as text on every provider so the shape never depends on the DB.
        content: JSON.stringify(content),
      },
    });

    return { id: row.id, jobId, version: row.version, createdAt: row.createdAt, ...content };
  }

  /** Version history, newest first. Bodies stay in the DB until one is fetched. */
  async list(userId: string, jobId: string): Promise<PackageSummary[]> {
    const rows = await this.prisma.applicationPackage.findMany({
      where: { userId, jobId },
      orderBy: { version: 'desc' },
      select: { version: true, createdAt: true, content: true },
    });
    return rows.map((row) => {
      const content = this.parseContent(row.content);
      return {
        version: row.version,
        createdAt: row.createdAt,
        generatorVersion: content.generatorVersion,
        warnings: content.warnings,
      };
    });
  }

  async get(userId: string, jobId: string, version: number): Promise<PackageView> {
    if (!Number.isInteger(version) || version < 1) {
      throw new BadRequestException('version must be a positive integer');
    }
    const row = await this.prisma.applicationPackage.findFirst({
      where: { userId, jobId, version },
    });
    if (!row) throw new NotFoundException('Application package version not found');
    return {
      id: row.id,
      jobId,
      version: row.version,
      createdAt: row.createdAt,
      ...this.parseContent(row.content),
    };
  }

  private parseContent(raw: string): ApplicationPackageContent {
    return JSON.parse(raw) as ApplicationPackageContent;
  }

  private requirements(value: unknown): PackageMatch['requiredRequirements'] {
    return this.prisma.jsonArray(value) as PackageMatch['requiredRequirements'];
  }
}
