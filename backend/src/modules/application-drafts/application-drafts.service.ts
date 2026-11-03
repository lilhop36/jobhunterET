import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DraftContent,
  RequirementEvidence,
  draftHash,
  normalizeContent,
} from './draft-content';
import { validateDraft } from './draft-validation';
import { ApproveDraftDto, CreateDraftDto, UpdateDraftDto } from './dto/application-draft.dto';

export type DraftStatus = 'NEEDS_ATTENTION' | 'READY_FOR_APPROVAL' | 'APPROVED';

interface PackageContent {
  cv: string;
  coverLetter: string;
  screeningAnswers: any[];
  requirementMapping: RequirementEvidence[];
  generatorVersion: string;
}

export interface DraftView {
  id: string;
  status: DraftStatus;
  createdAt: Date;
  updatedAt: Date;
  revision: number;
  contentHash: string;
  content: DraftContent;
  generated: DraftContent;
  edited: boolean;
  job: {
    id: string;
    title: string;
    company: string;
    location: string;
    deadline: Date | null;
    status: string;
    eligibility: string;
  };
  package: { id: string; version: number; generatorVersion: string; createdAt: Date };
  latestPackageVersion: number;
  requirementMapping: RequirementEvidence[];
  artifacts: { id: string; fileId: string; kind: string; label: string | null; originalName: string; sizeBytes: number }[];
  availableDocuments: { id: string; kind: string; label: string | null; originalName: string; uploadedAt: Date }[];
  attestation: { hash: string | null; at: Date | null; current: boolean };
  validation: { valid: boolean; errors: string[]; warnings: string[]; editedFields: string[] };
  approval: {
    approved: boolean;
    invalidated: boolean;
    latestAt: Date | null;
    latestHash: string | null;
    latestNote: string | null;
  };
}

type DraftRow = any;

@Injectable()
export class ApplicationDraftsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create the draft for (user, job) from a generated package version. */
  async create(userId: string, dto: CreateDraftDto): Promise<DraftView> {
    const jobId = dto.jobId;
    const existing = await this.prisma.applicationDraft.findUnique({
      where: { userId_jobId: { userId, jobId } },
    });
    if (existing) {
      throw new ConflictException(`A draft already exists for this job (${existing.id}).`);
    }

    const pkg = await this.prisma.applicationPackage.findFirst({
      where: { userId, jobId, ...(dto.packageVersion ? { version: dto.packageVersion } : {}) },
      orderBy: { version: 'desc' },
    });
    if (!pkg) {
      throw new NotFoundException('No application package found — generate one first.');
    }

    const generated = normalizeContent(this.parsePackage(pkg.content));
    const documents = await this.prisma.cvFile.findMany({
      where: { userId, kind: 'CV', active: this.prisma.bool(true) as any },
      orderBy: { uploadedAt: 'desc' },
    });
    const documentIds = documents.map((d) => d.id);
    const hash = draftHash({ packageId: pkg.id, content: generated, documentIds });

    const draftId = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.applicationDraft.create({
        data: { userId, jobId, packageId: pkg.id },
      });
      await tx.applicationDraftRevision.create({
        data: {
          draftId: draft.id,
          version: 1,
          content: JSON.stringify(generated),
          contentHash: hash,
        },
      });
      for (const file of documents) {
        await tx.applicationArtifact.create({
          data: { draftId: draft.id, fileId: file.id, kind: file.kind, label: file.label },
        });
      }
      await tx.applicationAuditLog.create({
        data: {
          draftId: draft.id,
          userId,
          action: 'DRAFT_CREATED',
          detail: JSON.stringify({ packageId: pkg.id, packageVersion: pkg.version, hash }),
        },
      });
      return draft.id;
    });

    return this.get(userId, draftId);
  }

  async list(userId: string): Promise<DraftView[]> {
    const drafts = await this.prisma.applicationDraft.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    const views: DraftView[] = [];
    for (const draft of drafts) {
      views.push(await this.get(userId, draft.id));
    }
    return views;
  }

  async get(userId: string, draftId: string): Promise<DraftView> {
    const draft = await this.load(userId, draftId);
    return this.buildView(draft);
  }

  /**
   * Apply an edit as a new immutable revision. Previous revisions stay put.
   *
   * Saving and attesting are separate requests by design: any change to the
   * prose or the attached documents creates a revision and clears the previous
   * attestation, and such a request may not also attest the new revision.
   */
  async update(userId: string, draftId: string, dto: UpdateDraftDto): Promise<DraftView> {
    const draft = await this.load(userId, draftId);
    const latest = draft.revisions[0];
    if (!latest) throw new NotFoundException('Draft has no revision');

    const generated = normalizeContent(this.parsePackage(draft.package.content));
    const content = normalizeContent(this.prisma.parseJson(latest.content));

    if (dto.cv !== undefined) content.cv = dto.cv;
    if (dto.coverLetter !== undefined) content.coverLetter = dto.coverLetter;
    if (dto.screeningAnswers !== undefined) content.screeningAnswers = normalizeContent({ screeningAnswers: dto.screeningAnswers }).screeningAnswers;

    let documentIds = draft.artifacts.map((a: any) => a.fileId);
    let selectedFiles: { id: string; kind: string; label: string | null }[] | null = null;
    if (dto.documentIds !== undefined) {
      const unique = [...new Set(dto.documentIds)];
      const files = await this.prisma.cvFile.findMany({
        where: { userId, id: { in: unique } },
        select: { id: true, kind: true, label: true },
      });
      if (files.length !== unique.length) {
        throw new BadRequestException('One or more selected documents do not belong to you.');
      }
      selectedFiles = files;
      documentIds = files.map((f) => f.id);
    }

    const hash = draftHash({ packageId: draft.packageId, content, documentIds });
    if (hash === latest.contentHash) {
      // Nothing changed byte-for-byte: no new revision and no approval churn.
      // The only thing this request may do is attach or withdraw the
      // candidate's confirmation of the revision that already exists.
      if (dto.attestation === true && draft.attestedHash !== hash) {
        await this.prisma.$transaction([
          this.prisma.applicationDraft.update({
            where: { id: draft.id },
            data: { attestedHash: hash, attestedAt: new Date() },
          }),
          this.prisma.applicationAuditLog.create({
            data: {
              draftId: draft.id,
              userId,
              action: 'ATTESTED',
              detail: JSON.stringify({ revision: latest.version, hash }),
            },
          }),
        ]);
        return this.get(userId, draft.id);
      }
      if (dto.attestation === false && draft.attestedHash) {
        // Withdrawing a confirmation cannot stand next to an approval: the
        // approval is the human decision for this exact revision, so the only
        // way to change anything now is to edit it.
        if ((draft.approvals[0]?.revisionId ?? null) === latest.id) {
          throw new ConflictException(
            'This revision is already approved; edit it to change anything.',
          );
        }
        await this.prisma.$transaction([
          this.prisma.applicationDraft.update({
            where: { id: draft.id },
            data: { attestedHash: null, attestedAt: null },
          }),
          this.prisma.applicationAuditLog.create({
            data: {
              draftId: draft.id,
              userId,
              action: 'ATTESTATION_CLEARED',
              detail: JSON.stringify({ revision: latest.version }),
            },
          }),
        ]);
        return this.get(userId, draft.id);
      }
      return this.buildView(draft);
    }

    // The prose or the attached documents changed. Saving an edit and
    // confirming it are deliberately separate acts: an edit always creates a
    // new revision and always clears the previous attestation, so a request
    // that changes content can never carry a confirmation for the revision it
    // creates. The candidate must review what was saved and then confirm it.
    if (dto.attestation === true) {
      throw new BadRequestException(
        'Save your edits first, then confirm the saved version.',
      );
    }

    const approvedRevisionId = draft.approvals[0]?.revisionId ?? null;
    const wasApproved = approvedRevisionId === latest.id;
    const revisionVersion = latest.version + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.applicationDraftRevision.create({
        data: {
          draftId: draft.id,
          version: revisionVersion,
          content: JSON.stringify(content),
          contentHash: hash,
        },
      });
      if (selectedFiles) {
        await tx.applicationArtifact.deleteMany({ where: { draftId: draft.id } });
        for (const file of selectedFiles) {
          await tx.applicationArtifact.create({
            data: { draftId: draft.id, fileId: file.id, kind: file.kind, label: file.label },
          });
        }
      }
      await tx.applicationDraft.update({
        where: { id: draft.id },
        data: { attestedHash: null, attestedAt: null },
      });
      await tx.applicationAuditLog.create({
        data: {
          draftId: draft.id,
          userId,
          action: wasApproved ? 'APPROVAL_INVALIDATED' : 'DRAFT_EDITED',
          detail: JSON.stringify({
            revision: revisionVersion,
            hash,
            attested: false,
            invalidatedApproval: wasApproved,
          }),
        },
      });
    });

    return this.get(userId, draft.id);
  }

  /** Record that validation ran and return its result. */
  async validate(userId: string, draftId: string): Promise<DraftView['validation'] & { contentHash: string }> {
    const draft = await this.load(userId, draftId);
    const view = await this.buildView(draft);
    await this.prisma.applicationAuditLog.create({
      data: {
        draftId,
        userId,
        action: 'VALIDATED',
        detail: JSON.stringify({ valid: view.validation.valid, errors: view.validation.errors.length }),
      },
    });
    return { ...view.validation, contentHash: view.contentHash };
  }

  /**
   * Explicit human approval of the exact revision the candidate reviewed. The
   * caller must echo the content hash, so approving content that has changed
   * since it was displayed fails instead of silently approving something else.
   */
  async approve(userId: string, draftId: string, dto: ApproveDraftDto): Promise<DraftView> {
    const draft = await this.load(userId, draftId);
    const view = await this.buildView(draft);

    if (view.approval.approved && view.contentHash === dto.contentHash) {
      return view; // idempotent: this exact revision is already approved
    }
    if (dto.contentHash !== view.contentHash) {
      throw new ConflictException(
        'The application changed since you reviewed it — reload and approve again.',
      );
    }
    if (!view.validation.valid) {
      throw new BadRequestException({
        message: 'This application is not ready for approval.',
        errors: view.validation.errors,
      });
    }

    await this.prisma.$transaction([
      this.prisma.applicationApproval.create({
        data: {
          draftId,
          revisionId: draft.revisions[0].id,
          userId,
          contentHash: view.contentHash,
          note: dto.note ?? null,
        },
      }),
      this.prisma.applicationAuditLog.create({
        data: {
          draftId,
          userId,
          action: 'APPROVED',
          detail: JSON.stringify({ hash: view.contentHash, revision: view.revision }),
        },
      }),
    ]);

    return this.get(userId, draftId);
  }

  async audit(userId: string, draftId: string) {
    await this.load(userId, draftId); // ownership check
    const rows = await this.prisma.applicationAuditLog.findMany({
      where: { draftId },
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

  private parsePackage(raw: string): PackageContent {
    const parsed = JSON.parse(raw) as PackageContent;
    return {
      cv: parsed.cv ?? '',
      coverLetter: parsed.coverLetter ?? '',
      screeningAnswers: Array.isArray(parsed.screeningAnswers) ? parsed.screeningAnswers : [],
      requirementMapping: Array.isArray(parsed.requirementMapping) ? parsed.requirementMapping : [],
      generatorVersion: parsed.generatorVersion ?? 'unknown',
    };
  }

  private async load(userId: string, draftId: string): Promise<DraftRow> {
    const draft = await this.prisma.applicationDraft.findFirst({
      where: { id: draftId, userId },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            company: true,
            location: true,
            deadline: true,
            status: true,
            eligibility: true,
            urlStatus: true,
          },
        },
        package: true,
        revisions: { orderBy: { version: 'desc' }, take: 1 },
        approvals: { orderBy: { createdAt: 'desc' }, take: 1 },
        artifacts: { include: { file: true } },
      },
    });
    if (!draft) throw new NotFoundException('Application draft not found');
    return draft;
  }

  private async buildView(draft: DraftRow): Promise<DraftView> {
    const parsedPackage = this.parsePackage(draft.package.content);
    const generated = normalizeContent(parsedPackage);
    const latest = draft.revisions[0];
    const content = normalizeContent(this.prisma.parseJson(latest.content));
    const documentIds = draft.artifacts.map((a: any) => a.fileId);

    const [latestPackage, availableDocuments] = await Promise.all([
      this.prisma.applicationPackage.findFirst({
        where: { userId: draft.userId, jobId: draft.jobId },
        orderBy: { version: 'desc' },
        select: { version: true },
      }),
      this.prisma.cvFile.findMany({
        where: { userId: draft.userId },
        orderBy: { uploadedAt: 'desc' },
      }),
    ]);

    const validation = validateDraft({
      content,
      generated,
      requirementMapping: parsedPackage.requirementMapping,
      artifacts: draft.artifacts.map((a: any) => ({ kind: a.kind })),
      attestedHash: draft.attestedHash ?? null,
      contentHash: latest.contentHash,
      job: {
        eligibility: draft.job.eligibility,
        status: draft.job.status,
        deadline: draft.job.deadline,
        urlStatus: draft.job.urlStatus ?? null,
      },
      packageVersion: draft.package.version,
      latestPackageVersion: latestPackage?.version ?? draft.package.version,
    });

    const latestApproval = draft.approvals[0] ?? null;
    const approved = !!latestApproval && latestApproval.revisionId === latest.id;

    let status: DraftStatus;
    if (!validation.valid) status = 'NEEDS_ATTENTION';
    else if (approved) status = 'APPROVED';
    else status = 'READY_FOR_APPROVAL';

    return {
      id: draft.id,
      status,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      revision: latest.version,
      contentHash: latest.contentHash,
      content,
      generated,
      edited: validation.edited,
      job: {
        id: draft.job.id,
        title: draft.job.title,
        company: draft.job.company,
        location: draft.job.location,
        deadline: draft.job.deadline,
        status: draft.job.status,
        eligibility: draft.job.eligibility,
      },
      package: {
        id: draft.package.id,
        version: draft.package.version,
        generatorVersion: parsedPackage.generatorVersion,
        createdAt: draft.package.createdAt,
      },
      latestPackageVersion: latestPackage?.version ?? draft.package.version,
      requirementMapping: parsedPackage.requirementMapping,
      artifacts: draft.artifacts.map((a: any) => ({
        id: a.id,
        fileId: a.fileId,
        kind: a.kind,
        label: a.label,
        originalName: a.file.originalName,
        sizeBytes: a.file.sizeBytes,
      })),
      availableDocuments: availableDocuments.map((d) => ({
        id: d.id,
        kind: d.kind,
        label: d.label,
        originalName: d.originalName,
        uploadedAt: d.uploadedAt,
      })),
      attestation: {
        hash: draft.attestedHash ?? null,
        at: draft.attestedAt ?? null,
        current: draft.attestedHash === latest.contentHash,
      },
      validation: {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        editedFields: validation.editedFields,
      },
      approval: {
        approved,
        invalidated: !!latestApproval && !approved,
        latestAt: latestApproval?.createdAt ?? null,
        latestHash: latestApproval?.contentHash ?? null,
        latestNote: latestApproval?.note ?? null,
      },
    };
  }
}
