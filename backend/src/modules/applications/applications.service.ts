import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ApplicationStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';

// FR-031a: allowed transitions per stage.
export const VALID_TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  DISCOVERED: ['SAVED', 'APPLIED', 'REJECTED'],
  SAVED: ['APPLIED', 'REJECTED'],
  APPLIED: ['ASSESSMENT', 'INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  ASSESSMENT: ['INTERVIEW', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW: ['OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: [],
  REJECTED: [],
  WITHDRAWN: [],
};

const FOLLOW_UP_STAGES: ApplicationStage[] = ['APPLIED', 'ASSESSMENT', 'INTERVIEW'];

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(EventsService) private readonly events?: EventsService,
  ) {}

  allowedTransitions(stage: ApplicationStage | null): ApplicationStage[] {
    return VALID_TRANSITIONS[stage ?? 'DISCOVERED'];
  }

  /** Serialize an application (or the DISCOVERED pseudo-state) for API responses. */
  private view(application: any) {
    if (application) {
      return {
        stage: application.stage,
        stageSince: application.stageSince,
        followUp: application.followUp,
        version: application.version,
        allowedTransitions: this.allowedTransitions(application.stage),
      };
    }
    return {
      stage: 'DISCOVERED',
      stageSince: null,
      followUp: null,
      version: null,
      allowedTransitions: this.allowedTransitions(null),
    };
  }

  async board(userId: string) {
    const [apps, matches] = await Promise.all([
      this.prisma.application.findMany({
        where: { userId },
        include: { job: { select: { title: true, company: true, location: true } } },
        orderBy: { stageSince: 'desc' },
      }),
      this.prisma.jobMatch.findMany({
        where: { userId, score: { gte: 70 } },
        include: { job: { select: { id: true, title: true, company: true } } },
      }),
    ]);

    return {
      applications: apps.map((a) => ({
        jobId: a.jobId,
        title: a.job.title,
        company: a.job.company,
        location: a.job.location,
        ...this.view(a),
      })),
      savedCount: apps.filter((a) => a.stage === 'SAVED').length,
      discovered: matches
        .filter((m) => !apps.some((a) => a.jobId === m.jobId))
        .map((m) => ({
          jobId: m.jobId,
          title: m.job.title,
          company: m.job.company,
          ...this.view(null),
        })),
    };
  }

  async apply(userId: string, jobId: string, expectedVersion?: number) {
    return this.transition(userId, jobId, 'APPLIED', expectedVersion);
  }

  async save(userId: string, jobId: string, expectedVersion?: number) {
    return this.transition(userId, jobId, 'SAVED', expectedVersion);
  }

  async clearSaved(userId: string, jobId: string) {
    const app = await this.prisma.application.findUnique({ where: { userId_jobId: { userId, jobId } } });
    if (!app || app.stage !== 'SAVED') throw new ConflictException('Only saved jobs can be removed from saved jobs');
    await this.prisma.application.delete({ where: { userId_jobId: { userId, jobId } } });
    return { saved: false };
  }

  async setStage(userId: string, jobId: string, stage: ApplicationStage, expectedVersion?: number) {
    return this.transition(userId, jobId, stage, expectedVersion);
  }

  /**
   * FR-031a: enforce the application transition graph — illegal moves return 409.
   * Uses optimistic locking via `expectedVersion` for concurrent-safety.
   */
  async transition(userId: string, jobId: string, to: ApplicationStage, expectedVersion?: number) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');

    const existing = await this.prisma.application.findUnique({ where: { userId_jobId: { userId, jobId } } });
    const from = existing?.stage ?? 'DISCOVERED';

    if (from === to) return this.view(existing);
    if (!this.allowedTransitions(existing?.stage ?? null).includes(to)) {
      throw new ConflictException(`Illegal transition: ${from} → ${to}`);
    }
    if (expectedVersion !== undefined && existing && expectedVersion !== existing.version) {
      throw new ConflictException('Application changed; refresh and try again');
    }

    const now = new Date();
    const followUp = FOLLOW_UP_STAGES.includes(to) ? new Date(now.getTime() + 7 * 86_400_000) : null;

    const application = await this.prisma.$transaction(async (tx) => {
      if (!existing) {
        return tx.application.create({
          data: {
            userId,
            jobId,
            stage: to,
            stageSince: now,
            followUp,
            transitions: { create: { fromStage: 'DISCOVERED', toStage: to, transitionedAt: now } },
          },
        });
      }

      const updated = await tx.application.updateMany({
        where: { id: existing.id, version: existing.version },
        data: { stage: to, stageSince: now, followUp, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Application changed; refresh and try again');

      await tx.applicationTransition.create({
        data: { applicationId: existing.id, fromStage: existing.stage, toStage: to, transitionedAt: now },
      });

      return tx.application.findUniqueOrThrow({ where: { id: existing.id } });
    });

    // SSE: notify the connected client of the stage change.
    this.emitApplicationEvent(userId, jobId, from, to);

    return this.view(application);
  }

  private emitApplicationEvent(userId: string, jobId: string, from: string, to: string) {
    if (!this.events) return;
    this.prisma.job
      .findUnique({ where: { id: jobId }, select: { title: true, company: true } })
      .then((job) => {
        if (!job) return;
        this.events!.pushToUser(userId, {
          type: 'application',
          jobId,
          title: job.title,
          company: job.company,
          from,
          to,
          createdAt: new Date().toISOString(),
        });
      })
      .catch(() => {});
  }
}
