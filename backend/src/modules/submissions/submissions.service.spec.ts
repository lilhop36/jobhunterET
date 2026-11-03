import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SubmissionsService } from './submissions.service';
import { SubmissionTransport } from './submission-transport';

function draftView(over: any = {}) {
  const contentHash = over.contentHash ?? 'hash-1';
  return {
    id: 'draft-1',
    status: 'APPROVED',
    createdAt: new Date('2026-11-03T00:00:00Z'),
    updatedAt: new Date('2026-11-03T00:00:00Z'),
    revision: 3,
    contentHash,
    content: {
      cv: 'CV body',
      coverLetter: 'Letter body',
      screeningAnswers: [{ question: 'Q', answer: 'A', basis: 'B' }],
    },
    generated: { cv: 'CV body', coverLetter: 'Letter body', screeningAnswers: [] },
    edited: false,
    job: {
      id: 'job-1',
      title: 'Backend Developer',
      company: 'Acme',
      location: 'Addis Ababa',
      deadline: null,
      status: 'ACTIVE',
      eligibility: 'ELIGIBLE',
    },
    package: { id: 'pkg-1', version: 1, generatorVersion: 'v1', createdAt: new Date() },
    latestPackageVersion: 1,
    requirementMapping: [],
    artifacts: [
      { id: 'art-1', fileId: 'file-1', kind: 'CV', label: null, originalName: 'cv.pdf', sizeBytes: 10 },
    ],
    availableDocuments: [],
    attestation: { hash: contentHash, at: new Date(), current: true },
    validation: { valid: true, errors: [], warnings: [], editedFields: [] },
    approval: {
      approved: true,
      invalidated: false,
      latestAt: new Date(),
      latestHash: contentHash,
      latestNote: null,
    },
    ...over,
  };
}

function makeService(over: any = {}) {
  const state: { submissions: any[]; events: any[] } = { submissions: [], events: [] };
  let seq = 0;
  const job = {
    id: 'job-1',
    title: 'Backend Developer',
    company: 'Acme',
    location: 'Addis Ababa',
    url: 'https://acme.et/jobs/1',
    finalUrl: null,
    applyUrl: 'https://acme.et/jobs/1/apply',
    applyEmail: null,
    applyMethod: 'ONLINE_URL',
    source: { type: 'HTML', name: 'EthioJobs' },
    ...(over.job ?? {}),
  };

  const prisma: any = {
    job: { findUnique: jest.fn().mockResolvedValue(over.job === null ? null : job) },
    applicationDraftRevision: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          over.revision === null
            ? null
            : { id: 'rev-1', draftId: 'draft-1', contentHash: over.contentHash ?? 'hash-1' },
        ),
    },
    applicationApproval: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          over.approval === null
            ? null
            : {
                id: 'appr-1',
                draftId: 'draft-1',
                revisionId: 'rev-1',
                contentHash: over.contentHash ?? 'hash-1',
              },
        ),
    },
    applicationSubmission: {
      findUnique: jest.fn(async ({ where }: any) =>
        state.submissions.find(
          (s) =>
            s.userId === where.userId_jobId.userId && s.jobId === where.userId_jobId.jobId,
        ) ?? null,
      ),
      findFirst: jest.fn(async ({ where }: any) => {
        const row = state.submissions.find(
          (s) => s.id === where.id && (where.userId === undefined || s.userId === where.userId),
        );
        return row ? { ...row, job } : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        state.submissions
          .filter((s) => s.userId === where.userId)
          .map((s) => ({ ...s, job })),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `sub-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.submissions.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = state.submissions.findIndex((s) => s.id === where.id);
        state.submissions[index] = { ...state.submissions[index], ...data, updatedAt: new Date() };
        return state.submissions[index];
      }),
    },
    submissionEvent: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ev-${++seq}`, createdAt: new Date(), ...data };
        state.events.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        state.events.filter((e) => e.submissionId === where.submissionId),
      ),
    },
    parseJson: (v: any) => (typeof v === 'string' ? JSON.parse(v) : v),
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    ),
  };

  const drafts: any = {
    get: jest.fn(async (userId: string) => {
      if (userId !== 'u1') throw new NotFoundException('Draft not found.');
      return over.view ?? draftView();
    }),
  };

  const service = new SubmissionsService(prisma, drafts, over.transport);
  return { service, prisma, drafts, state, job };
}

const fakeTransport = (): SubmissionTransport & { send: jest.Mock; supports: jest.Mock } => ({
  supports: jest.fn((channel: any) => channel.type === 'WEB'),
  send: jest.fn(async () => ({ reference: 'ACME-REF-1', detail: { ok: true } })),
});

describe('SubmissionsService.prepare', () => {
  it('describes the official channel and why the approved draft can be submitted', async () => {
    const { service } = makeService();
    const plan = await service.prepare('u1', 'draft-1');

    expect(plan.channel.type).toBe('WEB');
    expect(plan.channel.url).toBe('https://acme.et/jobs/1/apply');
    expect(plan.mode).toBe('MANUAL');
    expect(plan.canSubmit).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.warnings.join(' ')).toMatch(/manual submission/i);
  });

  it('reports blockers for an unapproved draft', async () => {
    const { service } = makeService({
      view: draftView({
        approval: { approved: false, invalidated: false, latestAt: null, latestHash: null, latestNote: null },
      }),
    });
    const plan = await service.prepare('u1', 'draft-1');
    expect(plan.canSubmit).toBe(false);
    expect(plan.blockers).toContain(
      'The current revision is not approved. Approve the exact content before submitting.',
    );
  });

  it('never exposes another candidate’s draft', async () => {
    const { service } = makeService();
    await expect(service.prepare('u2', 'draft-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SubmissionsService.submit', () => {
  it('refuses a stale content hash', async () => {
    const { service } = makeService();
    await expect(
      service.submit('u1', 'draft-1', { contentHash: 'hash-old' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an unapproved revision', async () => {
    const { service } = makeService({
      view: draftView({
        approval: { approved: false, invalidated: false, latestAt: null, latestHash: null, latestNote: null },
      }),
    });
    await expect(
      service.submit('u1', 'draft-1', { contentHash: 'hash-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an edited but unconfirmed revision', async () => {
    const { service } = makeService({
      view: draftView({ edited: true, attestation: { hash: null, at: null, current: false } }),
    });
    await expect(
      service.submit('u1', 'draft-1', { contentHash: 'hash-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows an approved draft whose generated content was never edited', async () => {
    const { service } = makeService({
      view: draftView({ edited: false, attestation: { hash: null, at: null, current: false } }),
    });
    const view = await service.submit('u1', 'draft-1', { contentHash: 'hash-1' });
    expect(view.status).toBe('AWAITING_MANUAL');
  });

  it('refuses a draft that fails its pre-approval checks', async () => {
    const { service } = makeService({
      view: draftView({
        validation: { valid: false, errors: ['CV is empty.'], warnings: [], editedFields: [] },
      }),
    });
    const error = await service
      .submit('u1', 'draft-1', { contentHash: 'hash-1' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(error.getResponse())).toContain('CV is empty.');
  });

  it('refuses a duplicate submission for the same vacancy', async () => {
    const { service, prisma } = makeService();
    prisma.applicationSubmission.findUnique.mockResolvedValueOnce({ id: 'sub-9', status: 'SUBMITTED' });
    await expect(
      service.submit('u1', 'draft-1', { contentHash: 'hash-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prepares a manual submission with a channel receipt and audit events', async () => {
    const { service, state } = makeService();
    const view = await service.submit('u1', 'draft-1', { contentHash: 'hash-1', note: 'Applying today' });

    expect(view.status).toBe('AWAITING_MANUAL');
    expect(view.mode).toBe('MANUAL');
    expect(view.receipt).toBeNull();
    expect(view.channel).toEqual({
      type: 'WEB',
      url: 'https://acme.et/jobs/1/apply',
      email: null,
    });
    expect(view.contentHash).toBe('hash-1');
    expect(view.approvalId).toBe('appr-1');
    expect(view.revisionId).toBe('rev-1');
    expect(state.submissions).toHaveLength(1);
    const actions = state.events.map((e) => e.action);
    expect(actions).toContain('SUBMISSION_PREPARED');
    expect(actions).toContain('MANUAL_REQUIRED');
  });

  it('re-preparing the same manual submission is idempotent', async () => {
    const { service, state } = makeService();
    const first = await service.submit('u1', 'draft-1', { contentHash: 'hash-1' });
    const second = await service.submit('u1', 'draft-1', { contentHash: 'hash-1' });
    expect(second.id).toBe(first.id);
    expect(state.submissions).toHaveLength(1);
  });

  it('submits the exact approved revision through a registered transport', async () => {
    const transport = fakeTransport();
    const { service, state } = makeService({ transport });
    const view = await service.submit('u1', 'draft-1', { contentHash: 'hash-1' });

    expect(transport.send).toHaveBeenCalledTimes(1);
    const sent = transport.send.mock.calls[0][0];
    expect(sent.contentHash).toBe('hash-1');
    expect(sent.revisionId).toBe('rev-1');
    expect(sent.content.cv).toBe('CV body');
    expect(sent.content.coverLetter).toBe('Letter body');
    expect(sent.documents).toEqual([{ id: 'file-1', kind: 'CV', originalName: 'cv.pdf' }]);

    expect(view.status).toBe('SUBMITTED');
    expect(view.mode).toBe('AUTOMATED');
    expect(view.receipt).toMatchObject({ method: 'AUTOMATED', reference: 'ACME-REF-1' });
    expect(state.events.map((e) => e.action)).toContain('SUBMITTED');
  });

  it('records a failed automated submission without losing the manual fallback', async () => {
    const transport = fakeTransport();
    transport.send.mockRejectedValueOnce(new Error('portal unavailable'));
    const { service, state } = makeService({ transport });
    const view = await service.submit('u1', 'draft-1', { contentHash: 'hash-1' });

    expect(view.status).toBe('FAILED');
    expect(view.receipt).toMatchObject({ method: 'AUTOMATED', error: 'portal unavailable' });
    expect(state.events.map((e) => e.action)).toContain('SUBMISSION_FAILED');
  });

  it('does not attempt automation when no transport supports the channel', async () => {
    const transport = fakeTransport();
    transport.supports.mockReturnValue(false);
    const { service } = makeService({ transport });
    const view = await service.submit('u1', 'draft-1', { contentHash: 'hash-1' });

    expect(transport.send).not.toHaveBeenCalled();
    expect(view.status).toBe('AWAITING_MANUAL');
    expect(view.mode).toBe('MANUAL');
  });
});

describe('SubmissionsService.confirmManual', () => {
  async function prepared(over: any = {}) {
    const made = makeService(over);
    const submission = await made.service.submit('u1', 'draft-1', { contentHash: 'hash-1' });
    return { ...made, submission };
  }

  it('records the candidate’s own confirmation and receipt', async () => {
    const { service, state, submission } = await prepared();
    const view = await service.confirmManual('u1', submission.id, {
      reference: 'EMP-42',
      note: 'Sent from my inbox',
    });

    expect(view.status).toBe('SUBMITTED');
    expect(view.mode).toBe('MANUAL');
    expect(view.receipt).toMatchObject({ method: 'MANUAL', reference: 'EMP-42', note: 'Sent from my inbox' });
    expect(view.submittedAt).toBeInstanceOf(Date);
    expect(state.events.map((e) => e.action)).toContain('MANUAL_CONFIRMED');
  });

  it('is idempotent once submitted', async () => {
    const { service, submission } = await prepared();
    const first = await service.confirmManual('u1', submission.id, { reference: 'EMP-42' });
    const second = await service.confirmManual('u1', submission.id, { reference: 'OTHER' });
    expect(second.status).toBe('SUBMITTED');
    expect(second.receipt).toEqual(first.receipt);
  });

  it('refuses to confirm after the approved application changed', async () => {
    const { service, drafts, submission } = await prepared();
    drafts.get.mockResolvedValueOnce(draftView({ contentHash: 'hash-2' }));
    await expect(
      service.confirmManual('u1', submission.id, { reference: 'EMP-42' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to confirm when the approval was withdrawn', async () => {
    const { service, drafts, submission } = await prepared();
    drafts.get.mockResolvedValueOnce(
      draftView({
        approval: { approved: false, invalidated: true, latestAt: new Date(), latestHash: 'hash-1', latestNote: null },
      }),
    );
    await expect(service.confirmManual('u1', submission.id, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('does not expose another candidate’s submission', async () => {
    const { service, submission } = await prepared();
    await expect(service.confirmManual('u2', submission.id, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('SubmissionsService.list / get / audit', () => {
  it('lists only the current candidate’s submissions', async () => {
    const { service } = makeService();
    await service.submit('u1', 'draft-1', { contentHash: 'hash-1' });
    const list = await service.list('u1');
    expect(list).toHaveLength(1);
    expect(list[0].job).toMatchObject({ id: 'job-1', title: 'Backend Developer' });
    expect(await service.list('u2')).toEqual([]);
  });

  it('returns the submission audit trail with parsed detail', async () => {
    const { service } = makeService();
    const submission = await service.submit('u1', 'draft-1', { contentHash: 'hash-1' });
    const audit = await service.audit('u1', submission.id);
    expect(audit.map((a) => a.action)).toContain('SUBMISSION_PREPARED');
    expect(audit.find((a) => a.action === 'SUBMISSION_PREPARED')!.detail).toMatchObject({
      channel: 'WEB',
      contentHash: 'hash-1',
    });
  });

  it('returns 404 for a submission owned by someone else', async () => {
    const { service } = makeService();
    const submission = await service.submit('u1', 'draft-1', { contentHash: 'hash-1' });
    await expect(service.get('u2', submission.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.audit('u2', submission.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});