import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SavedJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.savedJob.findMany({
      where: { userId },
      include: { job: { include: { source: true, skills: { include: { skill: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.serialize(r.job));
  }

  async toggle(userId: string, jobId: string) {
    const existing = await this.prisma.savedJob.findUnique({
      where: { userId_jobId: { userId, jobId } },
    });
    if (existing) {
      await this.prisma.savedJob.delete({ where: { userId_jobId: { userId, jobId } } });
      return { saved: false };
    }
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.prisma.savedJob.create({ data: { userId, jobId } });
    return { saved: true };
  }

  private serialize(j: any) {
    return {
      id: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      locationClass: j.locationClass,
      employmentType: j.employmentType,
      experienceLevel: j.experienceLevel,
      url: j.url,
      status: j.status,
      parseConfidence: j.parseConfidence,
      postedDate: j.postedDate,
      source: j.source?.name,
      skills: j.skills?.map((s: any) => s.skill.name) || [],
    };
  }
}
