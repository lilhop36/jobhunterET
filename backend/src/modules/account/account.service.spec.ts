/**
 * FR-002e: Account deactivation/deletion lifecycle tests.
 * Tests the full deactivate → delete flow with all safeguards.
 */
import { AccountService } from './account.service';

function makePrisma(overrides: any = {}) {
  const defaults = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        status: 'ACTIVE',
        role: 'USER',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    telegramLink: { deleteMany: jest.fn().mockResolvedValue({}) },
    candidateProfile: { updateMany: jest.fn().mockResolvedValue({}) },
    candidateSkill: { deleteMany: jest.fn().mockResolvedValue({}) },
    targetRole: { deleteMany: jest.fn().mockResolvedValue({}) },
    locationPreference: { deleteMany: jest.fn().mockResolvedValue({}) },
    cvFile: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (fn: any) => {
      const tx = {
        user: { update: jest.fn().mockResolvedValue({}) },
        telegramLink: { deleteMany: jest.fn().mockResolvedValue({}) },
        candidateProfile: { updateMany: jest.fn().mockResolvedValue({}) },
        candidateSkill: { deleteMany: jest.fn().mockResolvedValue({}) },
        targetRole: { deleteMany: jest.fn().mockResolvedValue({}) },
        locationPreference: { deleteMany: jest.fn().mockResolvedValue({}) },
        cvFile: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    }),
  };
  return { ...defaults, ...overrides } as any;
}

describe('AccountService — FR-002e deactivation', () => {
  it('sets status to DISABLED and invalidates token', async () => {
    const prisma = makePrisma();
    const service = new AccountService(prisma);

    const result = await service.deactivate('user-1');
    expect(result).toEqual({ ok: true });

    // Transaction should update user status and invalidate token
    expect(prisma.$transaction).toHaveBeenCalled();
    const txFn = prisma.$transaction.mock.calls[0][0];
    const tx = {
      user: { update: jest.fn() },
      telegramLink: { deleteMany: jest.fn() },
    };
    await txFn(tx);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        status: 'DISABLED',
        tokenInvalidatedAt: expect.any(Date),
      },
    });
  });

  it('invalidates Telegram link on deactivation', async () => {
    const prisma = makePrisma();
    const service = new AccountService(prisma);
    await service.deactivate('user-1');

    const txFn = prisma.$transaction.mock.calls[0][0];
    const tx = {
      user: { update: jest.fn() },
      telegramLink: { deleteMany: jest.fn() },
    };
    await txFn(tx);
    expect(tx.telegramLink.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  it('rejects deactivation of already-deleted account', async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', status: 'DELETED' }),
      },
    });
    const service = new AccountService(prisma);
    await expect(service.deactivate('user-1')).rejects.toThrow('already deactivated or deleted');
  });

  it('allows reactivation of dormant accounts', async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', status: 'DORMANT' }),
      },
    });
    const service = new AccountService(prisma);
    const result = await service.deactivate('user-1');
    expect(result).toEqual({ ok: true });
  });
});

describe('AccountService — FR-002e deletion', () => {
  it('pseudonymizes email and sets status to DELETED', async () => {
    const prisma = makePrisma();
    const service = new AccountService(prisma);

    const result = await service.delete('user-1');
    expect(result).toEqual({ ok: true });

    const txFn = prisma.$transaction.mock.calls[0][0];
    const tx = {
      user: { update: jest.fn() },
      telegramLink: { deleteMany: jest.fn() },
      candidateProfile: { updateMany: jest.fn() },
      candidateSkill: { deleteMany: jest.fn() },
      targetRole: { deleteMany: jest.fn() },
      locationPreference: { deleteMany: jest.fn() },
      cvFile: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    };
    await txFn(tx);

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        status: 'DELETED',
        email: expect.stringContaining('deleted-'),
        tokenInvalidatedAt: expect.any(Date),
        notificationsPaused: true,
      }),
    });
  });

  it('clears profile fields on deletion', async () => {
    const prisma = makePrisma();
    const service = new AccountService(prisma);
    await service.delete('user-1');

    const txFn = prisma.$transaction.mock.calls[0][0];
    const tx = {
      user: { update: jest.fn() },
      telegramLink: { deleteMany: jest.fn() },
      candidateProfile: { updateMany: jest.fn() },
      candidateSkill: { deleteMany: jest.fn() },
      targetRole: { deleteMany: jest.fn() },
      locationPreference: { deleteMany: jest.fn() },
      cvFile: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    };
    await txFn(tx);

    expect(tx.candidateProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: expect.objectContaining({ title: null, summary: null }),
    });
    expect(tx.candidateSkill.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(tx.targetRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  it('rejects deletion of already-deleted account', async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', status: 'DELETED' }),
      },
    });
    const service = new AccountService(prisma);
    await expect(service.delete('user-1')).rejects.toThrow('already deleted');
  });
});
