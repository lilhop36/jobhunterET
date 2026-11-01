import { ConflictException } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
describe('ApplicationsService transitions', () => {
  function makeService() {
    const tx: any = { application: { create: jest.fn().mockResolvedValue({ stage: 'APPLIED', stageSince: new Date(), followUp: null, version: 1 }), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn() }, applicationTransition: { create: jest.fn() } };
    const prisma: any = { job: { findUnique: jest.fn().mockResolvedValue({ id: 'job-1' }) }, application: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn() }, jobMatch: { findMany: jest.fn() }, $transaction: jest.fn((fn) => fn(tx)) };
    return { service: new ApplicationsService(prisma), tx };
  }
  it('creates an APPLIED lifecycle record and initial transition', async () => { const { service, tx } = makeService(); await service.setStage('user-1', 'job-1', 'APPLIED'); expect(tx.application.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ stage: 'APPLIED' }) })); });
  it('rejects an illegal initial jump', async () => { const { service, tx } = makeService(); await expect(service.setStage('user-1', 'job-1', 'OFFER')).rejects.toBeInstanceOf(ConflictException); expect(tx.application.create).not.toHaveBeenCalled(); });
});
/**
 * FR-030 (SRS §22): a rejection is recorded per user and feeds future ranking.
 * The recording half is what these tests pin down — the row, the trail, the
 * per-user key, and the fact that REJECTED is terminal in the graph.
 */
describe('ApplicationsService — FR-030 Reject Job', () => {
  function makeService(existing: any = null) {
    const tx: any = {
      application: {
        create: jest.fn().mockResolvedValue({ id: 'app-1', userId: 'user-1', jobId: 'job-1', stage: 'REJECTED', version: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'app-1', stage: 'REJECTED', version: 2 }),
      },
      applicationTransition: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      job: { findUnique: jest.fn().mockResolvedValue({ id: 'job-1' }) },
      application: {
        findUnique: jest.fn().mockResolvedValue(existing),
        delete: jest.fn(),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    return { service: new ApplicationsService(prisma), prisma, tx };
  }

  it('writes a REJECTED application for (user, job) with a DISCOVERED → REJECTED trail', async () => {
    const { service, tx } = makeService();

    const view = await service.setStage('user-1', 'job-1', 'REJECTED');

    expect(view.stage).toBe('REJECTED');
    expect(tx.application.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        jobId: 'job-1',
        stage: 'REJECTED',
        followUp: null,
        transitions: { create: { fromStage: 'DISCOVERED', toStage: 'REJECTED', transitionedAt: expect.any(Date) } },
      }),
    });
  });

  it('is scoped to the user — another user rejection is its own row', async () => {
    const { service, prisma, tx } = makeService();

    await service.setStage('user-2', 'job-1', 'REJECTED');

    expect(prisma.application.findUnique).toHaveBeenCalledWith({
      where: { userId_jobId: { userId: 'user-2', jobId: 'job-1' } },
    });
    expect(tx.application.create.mock.calls[0][0].data.userId).toBe('user-2');
  });

  it('is terminal: nothing may follow a rejection, and re-rejecting is a no-op', async () => {
    const rejectedRow = { id: 'app-1', userId: 'user-1', jobId: 'job-1', stage: 'REJECTED', version: 3 };
    const { service, tx } = makeService(rejectedRow);

    expect(service.allowedTransitions('REJECTED')).toEqual([]);
    await expect(service.setStage('user-1', 'job-1', 'SAVED')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.application.updateMany).not.toHaveBeenCalled();

    const sameAgain = await service.setStage('user-1', 'job-1', 'REJECTED');
    expect(sameAgain.stage).toBe('REJECTED');
    expect(tx.application.updateMany).not.toHaveBeenCalled();
  });

  it('a rejection recorded from a SAVED job keeps the transition history', async () => {
    const savedRow = { id: 'app-1', userId: 'user-1', jobId: 'job-1', stage: 'SAVED', version: 1 };
    const { service, tx } = makeService(savedRow);

    await service.setStage('user-1', 'job-1', 'REJECTED');

    expect(tx.application.updateMany).toHaveBeenCalledWith({
      where: { id: 'app-1', version: 1 },
      data: expect.objectContaining({ stage: 'REJECTED', followUp: null }),
    });
    expect(tx.applicationTransition.create).toHaveBeenCalledWith({
      data: { applicationId: 'app-1', fromStage: 'SAVED', toStage: 'REJECTED', transitionedAt: expect.any(Date) },
    });
  });
});

