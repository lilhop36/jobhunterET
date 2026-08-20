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
