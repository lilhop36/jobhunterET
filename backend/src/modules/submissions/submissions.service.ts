import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApplicationDraftsService } from '../application-drafts/application-drafts.service';
import { resolveSubmissionChannel, SubmissionChannel, SubmissionChannelType } from './submission-channel';
import { validateSubmission } from './submission-validation';
import { SUBMISSION_TRANSPORT, SubmissionTransport } from './submission-transport';
import { ConfirmSubmissionDto, SubmitApplicationDto } from './dto/submission.dto';

export type SubmissionStatus = 'AWAITING_MANUAL' | 'SUBMITTED' | 'FAILED' | 'BLOCKED';
export type SubmissionMode = 'AUTOMATED' | 'MANUAL';

export interface SubmissionView {
  id: string;
  draftId: string;
  jobId: string;
  approvalId: string;
  revisionId: string;
  contentHash: string;
  channel: { type: SubmissionChannelType; url: string | null; email: string | null };
  mode: SubmissionMode;
  status: SubmissionStatus;
  receipt: any;
  note: string | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  job?: { id: string; title: string; company: string; location?: string };
}

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drafts: ApplicationDraftsService,
    @Optional() @Inject(SUBMISSION_TRANSPORT) private readonly transport?: SubmissionTransport,
  ) {}

  /**
   * Explain what submitting this draft would do, without changing anything.
   * The candidate sees the official channel, whether automation is available,
   * and every reason submission is currently blocked.
   */
  async prepare(userId: string, draftId: string) {
    const view = await this.drafts.get(userId, draftId);
    const job = await this.loadJob(view.job.id);
    const channel = resolveSubmissionChannel(job);
    const automatedSupported = this.supportsAutomation(channel);
    const existing = await this.prisma.applicationSubmission.findUnique({
      where: { userId_jobId: { userId, jobId: view.job.id } },
    });

    const validation = validateSubmission({
      approved: view.approval.approved,
      approvalHash: view.approval.latestHash,
      contentHash: view.contentHash,
      attestationCurrent: view.attestation.current,
      edited: view.edited,
      validationValid: view.validation.valid,
      validationErrors: view.validation.errors,
      channel,
      automatedSupported,
      existing,
    });

    return {
      draftId,
      jobId: view.job.id,
      revision: view.revision,
      contentHash: view.contentHash,
      approved: view.approval.approved,
      channel,
      mode: automatedSupported ? 'AUTOMATED' : 'MANUAL',
      canSubmit: validation.ok,
      blockers: validation.blockers,
      warnings: validation.warnings,
      existing: existing ? this.view(existing) : null,
    };
  }

  /**
   * Submit the exact approved revision. The caller must echo the content hash,
   * so a version that changed since it was displayed is never sent. A manual
   * channel produces an AWAITING_MANUAL record; an automated one is attempted
   * only through a registered transport.
   */
  async submit(userId: string, draftId: string, dto: SubmitApplicationDto): Promise<SubmissionView> {
    const view = await this.drafts.get(userId, draftId);
    if (dto.contentHash !== view.contentHash) {
      throw new ConflictException(
        'The application changed since you reviewed it — reload and submit the approved version.',
      );
    }

    const job = await this.loadJob(view.job.id);
    const channel = resolveSubmissionChannel(job);
    const automatedSupported = this.supportsAutomation(channel);
    const existing = await this.prisma.applicationSubmission.findUnique({
      where: { userId_jobId: { userId, jobId: view.job.id } },
    });

    if (existing?.status === 'SUBMITTED') {
      throw new ConflictException('This vacancy has already been submitted.');
    }

    const validation = validateSubmission({
      approved: view.approval.approved,
      approvalHash: view.approval.latestHash,
      contentHash: view.contentHash,
      attestationCurrent: view.attestation.current,
      edited: view.edited,
      validationValid: view.validation.valid,
      validationErrors: view.validation.errors,
      channel,
      automatedSupported,
      existing,
    });
    if (!validation.ok) {
      throw new BadRequestException({
        message: 'This application is not ready to submit.',
        blockers: validation.blockers,
        warnings: validation.warnings,
      });
    }

    const [revision, approval] = await Promise.all([
      this.prisma.applicationDraftRevision.findFirst({
        where: { draftId, contentHash: view.contentHash },
        orderBy: { version: 'desc' },
      }),
      this.prisma.applicationApproval.findFirst({
        where: { draftId, contentHash: view.contentHash },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (!revision || !approval || approval.revisionId !== revision.id) {
      throw new ConflictException('The approval for this exact revision is no longer available.');
    }

    const mode: SubmissionMode = automatedSupported ? 'AUTOMATED' : 'MANUAL';

    // Re-preparing the same manual submission is idempotent.
    if (
      existing &&
      existing.status === 'AWAITING_MANUAL' &&
      existing.revisionId === revision.id &&
      existing.contentHash === view.contentHash &&
      existing.mode === mode
    ) {
      return this.get(userId, existing.id);
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      const data = {
        draftId,
        approvalId: approval.id,
        revisionId: revision.id,
        contentHash: view.contentHash,
        channel: channel.type,
        channelUrl: channel.url,
        channelEmail: channel.email,
        mode,
        status: 'AWAITING_MANUAL',
        receipt: null,
        note: dto.note ?? null,
        submittedAt: null,
        confirmedAt: null,
      };
      const row = existing
        ? await tx.applicationSubmission.update({ where: { id: existing.id }, data })
        : await tx.applicationSubmission.create({ data: { userId, jobId: view.job.id, ...data } });

      await tx.submissionEvent.create({
        data: {
          submissionId: row.id,
          userId,
          action: 'SUBMISSION_PREPARED',
          detail: JSON.stringify({
            channel: channel.type,
            mode,
            contentHash: view.contentHash,
            revision: view.revision,
          }),
        },
      });
      return row;
    });

    if (mode === 'MANUAL' || !this.transport) {
      await this.prisma.submissionEvent.create({
        data: {
          submissionId: saved.id,
          userId,
          action: 'MANUAL_REQUIRED',
          detail: JSON.stringify({ channel: channel.type, url: channel.url, email: channel.email }),
        },
      });
      return this.get(userId, saved.id);
    }

    return this.attemptAutomated(userId, saved, view, job, channel, revision.id);
  }

  /** The candidate confirms they sent the prepared application themselves. */
  async confirmManual(userId: string, submissionId: string, dto: ConfirmSubmissionDto): Promise<SubmissionView> {
    const submission = await this.findOwned(userId, submissionId);
    if (submission.status === 'SUBMITTED') return this.get(userId, submission.id);
    if (submission.status !== 'AWAITING_MANUAL' && submission.status !== 'FAILED') {
      throw new ConflictException('This submission cannot be confirmed in its current state.');
    }

    // The exact approved revision must still be the current one. An edit after
    // preparation invalidates the submission just like it invalidates approval.
    const view = await this.drafts.get(userId, submission.draftId);
    if (
      view.contentHash !== submission.contentHash ||
      !view.approval.approved ||
      view.approval.latestHash !== submission.contentHash
    ) {
      throw new ConflictException(
        'The approved application changed after this submission was prepared — prepare it again.',
      );
    }

    const now = new Date();
    const receipt = {
      method: 'MANUAL',
      reference: dto.reference ?? null,
      note: dto.note ?? null,
      at: now.toISOString(),
    };
    await this.prisma.$transaction([
      this.prisma.applicationSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'SUBMITTED',
          mode: 'MANUAL',
          submittedAt: now,
          confirmedAt: now,
          receipt: JSON.stringify(receipt),
        },
      }),
      this.prisma.submissionEvent.create({
        data: {
          submissionId: submission.id,
          userId,
          action: 'MANUAL_CONFIRMED',
          detail: JSON.stringify({ reference: dto.reference ?? null }),
        },
      }),
    ]);
    return this.get(userId, submission.id);
  }

  async list(userId: string): Promise<SubmissionView[]> {
    const rows = await this.prisma.applicationSubmission.findMany({
      where: { userId },
      include: { job: { select: { id: true, title: true, company: true, location: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => this.view(row));
  }

  async get(userId: string, submissionId: string): Promise<SubmissionView> {
    const row = await this.prisma.applicationSubmission.findFirst({
      where: { id: submissionId, userId },
      include: { job: { select: { id: true, title: true, company: true, location: true } } },
    });
    if (!row) throw new NotFoundException('Submission not found.');
    return this.view(row);
  }

  async audit(userId: string, submissionId: string) {
    await this.findOwned(userId, submissionId);
    const rows = await this.prisma.submissionEvent.findMany({
      where: { submissionId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      detail: this.prisma.parseJson(row.detail),
      createdAt: row.createdAt,
    }));
  }

  // ── internals ────────────────────────────────────────────────

  private supportsAutomation(channel: SubmissionChannel): boolean {
    return !!this.transport && this.transport.supports(channel);
  }

  private async loadJob(jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        title: true,
        company: true,
        location: true,
        url: true,
        finalUrl: true,
        applyUrl: true,
        applyEmail: true,
        applyMethod: true,
        source: { select: { type: true, name: true } },
      },
    });
    if (!job) throw new NotFoundException('Job not found.');
    return job;
  }

  private async findOwned(userId: string, submissionId: string) {
    const row = await this.prisma.applicationSubmission.findFirst({
      where: { id: submissionId, userId },
    });
    if (!row) throw new NotFoundException('Submission not found.');
    return row;
  }

  private async attemptAutomated(
    userId: string,
    saved: any,
    view: any,
    job: any,
    channel: SubmissionChannel,
    revisionId: string,
  ): Promise<SubmissionView> {
    const transport = this.transport!;
    try {
      const result = await transport.send({
        channel,
        contentHash: view.contentHash,
        revisionId,
        job: { id: job.id, title: job.title, company: job.company },
        content: {
          cv: view.content.cv,
          coverLetter: view.content.coverLetter,
          screeningAnswers: view.content.screeningAnswers,
        },
        documents: view.artifacts.map((a: any) => ({
          id: a.fileId,
          kind: a.kind,
          originalName: a.originalName,
        })),
      });
      const receipt = {
        method: 'AUTOMATED',
        reference: result.reference,
        detail: result.detail ?? null,
        at: new Date().toISOString(),
      };
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.applicationSubmission.update({
          where: { id: saved.id },
          data: {
            status: 'SUBMITTED',
            submittedAt: now,
            confirmedAt: now,
            receipt: JSON.stringify(receipt),
          },
        }),
        this.prisma.submissionEvent.create({
          data: {
            submissionId: saved.id,
            userId,
            action: 'SUBMITTED',
            detail: JSON.stringify({ reference: result.reference }),
          },
        }),
      ]);
    } catch (error: any) {
      const message = error?.message ?? 'The automated submission failed.';
      const receipt = { method: 'AUTOMATED', error: message, at: new Date().toISOString() };
      await this.prisma.$transaction([
        this.prisma.applicationSubmission.update({
          where: { id: saved.id },
          data: { status: 'FAILED', receipt: JSON.stringify(receipt) },
        }),
        this.prisma.submissionEvent.create({
          data: {
            submissionId: saved.id,
            userId,
            action: 'SUBMISSION_FAILED',
            detail: JSON.stringify({ error: message }),
          },
        }),
      ]);
    }
    return this.get(userId, saved.id);
  }

  private view(row: any): SubmissionView {
    return {
      id: row.id,
      draftId: row.draftId,
      jobId: row.jobId,
      approvalId: row.approvalId,
      revisionId: row.revisionId,
      contentHash: row.contentHash,
      channel: {
        type: row.channel as SubmissionChannelType,
        url: row.channelUrl ?? null,
        email: row.channelEmail ?? null,
      },
      mode: row.mode as SubmissionMode,
      status: row.status as SubmissionStatus,
      receipt: row.receipt ? this.prisma.parseJson(row.receipt) : null,
      note: row.note ?? null,
      submittedAt: row.submittedAt ?? null,
      confirmedAt: row.confirmedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      job: row.job
        ? { id: row.job.id, title: row.job.title, company: row.job.company, location: row.job.location }
        : undefined,
    };
  }
}