import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ApplicationDraftsService } from './application-drafts.service';
import { draftHash, normalizeContent } from './draft-content';

const pkgContent = {
  cv: 'CV body',
  coverLetter: 'Letter body',
  screeningAnswers: [{ question: 'Q', answer: 'A', basis: 'B' }],
  requirementMapping: [],
  warnings: [],
  generatorVersion: 'v1.0-deterministic',
};

const generated = normalizeContent(pkgContent);

function pkgRow(over: any = {}) {
  return {
    id: 'pkg-1',
    userId: 'u1',
    jobId: 'job-1',
    version: 1,
    content: JSON.stringify(pkgContent),
    createdAt: new Date('2026-11-02T00:00:00Z'),
    ...over,
  };
}

function draftRow(over: any = {}) {
  const c = over.contentOverride ?? generated;
  const artifacts =
    over.artifacts ?? [
      { id: 'art-1', fileId: 'file-1', kind: 'CV', label: null, file: { originalName: 'cv.pdf', sizeBytes: 10 } },
    ];
  const pkg = pkgRow(over.pkgOver);
  const hash = draftHash({
    packageId: pkg.id,
    content: c,
    documentIds: artifacts.map((a: any) => a.fileId),
  });
  return {
    id: 'draft-1',
    userId: 'u1',
    jobId: 'job-1',
    packageId: pkg.id,
    attestedHash: over.attestedHash ?? null,
    attestedAt: over.attestedHash ? new Date('2026-11-03T00:00:00Z') : null,
    createdAt: new Date('2026-11-03T00:00:00Z'),
    updatedAt: new Date('2026-11-03T00:00:00Z'),
    job: {
      id: 'job-1',
      title: 'Backend Developer',
      company: 'Acme',
      location: 'Addis Ababa',
      deadline: null,
      status: 'ACTIVE',
      eligibility: 'ELIGIBLE',
      urlStatus: 'OK',
      ...(over.jobOver ?? {}),
    },
    package: pkg,
    revisions: [
      { id: 'rev-1', draftId: 'draft-1', version: over.revisionVersion ?? 1, content: JSON.stringify(c), contentHash: hash },
    ],
    approvals: over.approvals ?? [],
    artifacts,
  };
}

function makeService(over: any = {}) {
  const tx = {
    applicationDraft: {
      create: jest.fn(async ({ data }: any) => ({ id: 'draft-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'draft-1', ...data })),
    },
    applicationDraftRevision: {
      create: jest.fn(async ({ data }: any) => ({ id: 'rev-new', ...data })),
    },
    applicationArtifact: {
      create: jest.fn(async ({ data }: any) => data),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    applicationAuditLog: { create: jest.fn(async ({ data }: any) => data) },
  };
  const prisma: any = {
    applicationDraft: {
      findUnique: jest.fn().mockResolvedValue(over.existingDraft ?? null),
      findFirst: jest.fn().mockResolvedValue(over.draft ?? draftRow()),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: any) => ({ id: 'draft-1', ...data })),
    },
    applicationDraftRevision: { create: jest.fn() },
    applicationApproval: { create: jest.fn(async ({ data }: any) => data) },
    applicationArtifact: { create: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    applicationAuditLog: {
      create: jest.fn(async ({ data }: any) => data),
      findMany: jest.fn().mockResolvedValue(over.auditRows ?? []),
    },
    applicationPackage: { findFirst: jest.fn().mockResolvedValue(over.package ?? pkgRow()) },
    cvFile: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          over.files ?? [
            { id: 'file-1', kind: 'CV', label: null, originalName: 'cv.pdf', sizeBytes: 10, uploadedAt: new Date() },
          ],
        ),
    },
    parseJson: (v: any) => (typeof v === 'string' ? JSON.parse(v) : v),
    bool: (v: any) => v,
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
  };
  return { service: new ApplicationDraftsService(prisma), prisma, tx };
}

describe('ApplicationDraftsService.create', () => {
  it('copies the generated package into an immutable first revision and attaches the CV', async () => {
    const { service, prisma, tx } = makeService();

    const view = await service.create('u1', { jobId: 'job-1' });

    expect(prisma.applicationPackage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', jobId: 'job-1' } }),
    );
    const revision = tx.applicationDraftRevision.create.mock.calls[0][0].data;
    expect(revision).toMatchObject({ draftId: 'draft-1', version: 1 });
    expect(JSON.parse(revision.content)).toEqual(generated);
    expect(revision.contentHash).toBe(
      draftHash({ packageId: 'pkg-1', content: generated, documentIds: ['file-1'] }),
    );
    expect(tx.applicationArtifact.create).toHaveBeenCalledWith({
      data: { draftId: 'draft-1', fileId: 'file-1', kind: 'CV', label: null },
    });
    expect(tx.applicationAuditLog.create.mock.calls[0][0].data.action).toBe('DRAFT_CREATED');
    expect(view.status).toBe('READY_FOR_APPROVAL');
    expect(view.content.cv).toBe('CV body');
  });

  it('is one draft per job', async () => {
    const { service } = makeService({ existingDraft: { id: 'draft-9' } });
    await expect(service.create('u1', { jobId: 'job-1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to create without a generated package', async () => {
    const { service, prisma } = makeService({ package: null });
    prisma.applicationPackage.findFirst.mockResolvedValue(null);
    await expect(service.create('u1', { jobId: 'job-1' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ApplicationDraftsService.update', () => {
  it('appends a revision and leaves the earlier one untouched', async () => {
    const { service, tx } = makeService({ draft: draftRow() });

    await service.update('u1', 'draft-1', { cv: 'CV body v2' });

    const revision = tx.applicationDraftRevision.create.mock.calls[0][0].data;
    expect(revision.version).toBe(2);
    expect(revision.contentHash).not.toBe(
      draftHash({ packageId: 'pkg-1', content: generated, documentIds: ['file-1'] }),
    );
    expect(tx.applicationDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { attestedHash: null, attestedAt: null },
    });
    expect(tx.applicationAuditLog.create.mock.calls[0][0].data.action).toBe('DRAFT_EDITED');
  });

  it('records attestation for the new revision hash', async () => {
    const { service, tx } = makeService({ draft: draftRow() });

    await service.update('u1', 'draft-1', { cv: 'CV body v2', attestation: true });

    const revision = tx.applicationDraftRevision.create.mock.calls[0][0].data;
    expect(tx.applicationDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { attestedHash: revision.contentHash, attestedAt: expect.any(Date) },
    });
  });

  it('invalidates an existing approval when content changes', async () => {
    const row = draftRow({
      approvals: [{ id: 'ap-1', revisionId: 'rev-1', contentHash: 'old', createdAt: new Date(), note: null }],
    });
    const { service, tx } = makeService({ draft: row });

    await service.update('u1', 'draft-1', { coverLetter: 'rewritten' });

    expect(tx.applicationAuditLog.create.mock.calls[0][0].data.action).toBe('APPROVAL_INVALIDATED');
  });

  it('does not create a revision when nothing changed', async () => {
    const { service, tx } = makeService({ draft: draftRow() });

    await service.update('u1', 'draft-1', { cv: 'CV body' });

    expect(tx.applicationDraftRevision.create).not.toHaveBeenCalled();
    expect(tx.applicationAuditLog.create).not.toHaveBeenCalled();
  });

  it('records attestation of the current revision without a new revision', async () => {
    const { service, prisma } = makeService({ draft: draftRow() });

    await service.update('u1', 'draft-1', { attestation: true });

    expect(prisma.applicationDraftRevision.create).not.toHaveBeenCalled();
    expect(prisma.applicationDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { attestedHash: draftRow().revisions[0].contentHash, attestedAt: expect.any(Date) },
    });
    expect(prisma.applicationAuditLog.create.mock.calls[0][0].data.action).toBe('ATTESTED');
  });

  it('rejects documents that do not belong to the user', async () => {
    const { service, prisma } = makeService({ draft: draftRow() });
    prisma.cvFile.findMany.mockResolvedValue([]);

    await expect(
      service.update('u1', 'draft-1', { documentIds: ['someone-elses-file'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ApplicationDraftsService.approve', () => {
  const validHash = draftRow().revisions[0].contentHash;

  it('records an approval bound to the reviewed revision', async () => {
    const { service, prisma } = makeService({ draft: draftRow() });

    const view = await service.approve('u1', 'draft-1', { contentHash: validHash });

    expect(prisma.applicationApproval.create).toHaveBeenCalledWith({
      data: {
        draftId: 'draft-1',
        revisionId: 'rev-1',
        userId: 'u1',
        contentHash: validHash,
        note: null,
      },
    });
    expect(view.status).toBe('READY_FOR_APPROVAL'); // mock still returns the unapproved row
  });

  it('refuses to approve content that changed since it was reviewed', async () => {
    const { service, prisma } = makeService({ draft: draftRow() });
    await expect(
      service.approve('u1', 'draft-1', { contentHash: 'stale-hash' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.applicationApproval.create).not.toHaveBeenCalled();
  });

  it('refuses to approve a draft that fails validation', async () => {
    const noCv = draftRow({ artifacts: [{ id: 'a2', fileId: 'f2', kind: 'OTHER', label: null, file: { originalName: 'x', sizeBytes: 1 } }] });
    const { service, prisma } = makeService({ draft: noCv });

    await expect(
      service.approve('u1', 'draft-1', { contentHash: noCv.revisions[0].contentHash }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.applicationApproval.create).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-approved revision', async () => {
    const row = draftRow({
      approvals: [{ id: 'ap-1', revisionId: 'rev-1', contentHash: validHash, createdAt: new Date(), note: null }],
    });
    const { service, prisma } = makeService({ draft: row });

    await service.approve('u1', 'draft-1', { contentHash: validHash });

    expect(prisma.applicationApproval.create).not.toHaveBeenCalled();
  });
});

describe('ApplicationDraftsService.validate and audit', () => {
  it('returns the validation result with the hash and records it', async () => {
    const { service, prisma } = makeService({ draft: draftRow() });

    const result = await service.validate('u1', 'draft-1');

    expect(result.contentHash).toBe(draftRow().revisions[0].contentHash);
    expect(result.valid).toBe(true);
    expect(prisma.applicationAuditLog.create.mock.calls[0][0].data.action).toBe('VALIDATED');
  });

  it('returns parsed audit entries for the caller', async () => {
    const { service, prisma } = makeService({
      draft: draftRow(),
      auditRows: [
        { id: 'log-1', action: 'APPROVED', detail: JSON.stringify({ hash: 'h' }), createdAt: new Date() },
      ],
    });

    const rows = await service.audit('u1', 'draft-1');
    expect(rows).toEqual([
      { id: 'log-1', action: 'APPROVED', detail: { hash: 'h' }, createdAt: expect.any(Date) },
    ]);
    expect(prisma.applicationAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { draftId: 'draft-1' } }),
    );
  });
});
