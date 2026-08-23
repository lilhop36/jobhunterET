import { Injectable } from '@nestjs/common';
import { ApplicationsService } from '../applications/applications.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SavedJobsService {
  constructor(private readonly prisma: PrismaService, private readonly applications: ApplicationsService) {}
  async list(userId: string) {
    const rows = await this.prisma.application.findMany({ where: { userId, stage: 'SAVED' }, include: { job: { include: { source: true, skills: { include: { skill: true } } } } }, orderBy: { stageSince: 'desc' } });
    return rows.map((r) => ({ id: r.job.id, title: r.job.title, company: r.job.company, location: r.job.location, locationClass: r.job.locationClass, employmentType: r.job.employmentType, experienceLevel: r.job.experienceLevel, url: r.job.url, status: r.job.status, parseConfidence: r.job.parseConfidence, postedDate: r.job.postedDate, source: r.job.source?.name, skills: r.job.skills.map((s) => s.skill.name) }));
  }
  async toggle(userId: string, jobId: string) {
    const current = await this.prisma.application.findUnique({ where: { userId_jobId: { userId, jobId } } });
    if (current?.stage === 'SAVED') return this.applications.clearSaved(userId, jobId);
    await this.applications.save(userId, jobId, current?.version);
    return { saved: true };
  }
}
