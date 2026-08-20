import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// FR-031a: allowed transitions per stage.
const VALID_TRANSITIONS: Record<string, string[]> = {
  DISCOVERED: ['SAVED', 'APPLIED', 'REJECTED'],
  SAVED: ['APPLIED', 'REJECTED'],
  APPLIED: ['ASSESSMENT', 'INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  ASSESSMENT: ['INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW: ['OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: [],    // terminal
  REJECTED: [], // terminal
  WITHDRAWN: [], // terminal
};

const VALID_STAGES = Object.keys(VALID_TRANSITIONS);

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async board(userId: string) {
    const apps = await this.prisma.application.findMany({
      where: { userId },
      include: { job: { select: { title: true, company: true, location: true } } },
      orderBy: { stageSince: 'desc' },
    });
    const saved = await this.prisma.savedJob.findMany({ where: { userId } });
    const matches = await this.prisma.jobMatch.findMany({
      where: { userId, score: { gte: 70 } },
      include: { job: { select: { id: true, title: true, company: true } } },
    });
    return {
      applications: apps.map((a) => ({
        jobId: a.jobId,
        title: a.job?.title,
        company: a.job?.company,
        location: a.job?.location,
        stage: a.stage,
        stageSince: a.stageSince,
        followUp: a.followUp,
      })),
      savedCount: saved.length,
      discovered: matches
        .filter((m) => !apps.some((a) => a.jobId === m.jobId))
        .map((m) => ({ jobId: m.jobId, title: m.job.title, company: m.job.company })),
    };
  }

  async apply(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    const existing = await this.prisma.application.findUnique({
      where: { userId_jobId: { userId, jobId } },
    });
    if (existing) {
      // FR-031a: validate transition from current stage to APPLIED.
      this.validateTransition(existing.stage, 'APPLIED');
      const updated = await this.prisma.application.update({
        where: { userId_jobId: { userId, jobId } },
        data: { stage: 'APPLIED', stageSince: new Date(), followUp: new Date(Date.now() + 7 * 86_400_000) },
      });
      return { stage: updated.stage };
    }
    const created = await this.prisma.application.create({
      data: {
        userId,
        jobId,
        stage: 'APPLIED',
        stageSince: new Date(),
        followUp: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    return { stage: created.stage };
  }

  async setStage(userId: string, jobId: string, stage: string) {
    if (!VALID_STAGES.includes(stage)) {
      throw new ConflictException(`Invalid stage: ${stage}`);
    }
    const existing = await this.prisma.application.findUnique({
      where: { userId_jobId: { userId, jobId } },
    });

    if (!existing) {
      // Creating a new application — only DISCOVERED → first valid move is allowed.
      // But allow direct creation into SAVED or APPLIED as a convenience.
      const followUp = ['APPLIED', 'ASSESSMENT', 'INTERVIEW'].includes(stage)
        ? new Date(Date.now() + 7 * 86_400_000)
        : null;
      return this.prisma.application.create({
        data: { userId, jobId, stage: stage as any, stageSince: new Date(), followUp },
      });
    }

    // FR-031a: validate transition.
    this.validateTransition(existing.stage, stage);

    const followUp = ['APPLIED', 'ASSESSMENT', 'INTERVIEW'].includes(stage)
      ? new Date(Date.now() + 7 * 86_400_000)
      : null;
    return this.prisma.application.update({
      where: { userId_jobId: { userId, jobId } },
      data: { stage: stage as any, stageSince: new Date(), followUp },
    });
  }

  /** FR-031a: enforce the application transition graph — illegal moves return 409. */
  private validateTransition(from: string, to: string): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new ConflictException(
        `Illegal transition: ${from} → ${to}. Allowed: ${allowed?.join(', ') || '(none — terminal stage)'}`,
      );
    }
  }
}
