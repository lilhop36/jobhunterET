/**
 * FR-002f: Admin user management lifecycle tests.
 * Tests role assignment, last-ADMIN safeguard, password reset.
 */
import { AdminService } from './admin.service';

function makePrisma(overrides: any = {}) {
  const defaults = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-2',
        email: 'user@example.com',
        role: 'USER',
        status: 'ACTIVE',
      }),
      count: jest.fn().mockResolvedValue(2),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  return { ...defaults, ...overrides } as any;
}

describe('AdminService — FR-002f user management', () => {
  it('allows admin to change user role', async () => {
    const prisma = makePrisma();
    const service = new AdminService(prisma);

    const result = await service.updateUser('admin-1', 'user-2', { role: 'ADMIN' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: { role: 'ADMIN' },
      select: expect.any(Object),
    });
  });

  it('prevents admin from self-modifying', async () => {
    const prisma = makePrisma();
    const service = new AdminService(prisma);

    await expect(service.updateUser('admin-1', 'admin-1', { role: 'USER' })).rejects.toThrow(
      'self-modify',
    );
  });

  it('prevents demoting the last remaining admin', async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-1',
          email: 'admin@example.com',
          role: 'ADMIN',
          status: 'ACTIVE',
        }),
        count: jest.fn().mockResolvedValue(1), // only 1 admin
        update: jest.fn(),
      },
    });
    const service = new AdminService(prisma);

    await expect(service.updateUser('other-admin', 'admin-1', { role: 'USER' })).rejects.toThrow(
      'last remaining admin',
    );
  });

  it('prevents disabling the last remaining admin', async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-1',
          email: 'admin@example.com',
          role: 'ADMIN',
          status: 'ACTIVE',
        }),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn(),
      },
    });
    const service = new AdminService(prisma);

    await expect(
      service.updateUser('other-admin', 'admin-1', { status: 'DISABLED' }),
    ).rejects.toThrow('last remaining admin');
  });

  it('allows disabling when multiple admins exist', async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-2',
          role: 'ADMIN',
          status: 'ACTIVE',
        }),
        count: jest.fn().mockResolvedValue(3),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const service = new AdminService(prisma);

    const result = await service.updateUser('admin-1', 'admin-2', { status: 'DISABLED' });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('invalidates token when disabling a user', async () => {
    const prisma = makePrisma();
    const service = new AdminService(prisma);

    await service.updateUser('admin-1', 'user-2', { status: 'DISABLED' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: expect.objectContaining({
        status: 'DISABLED',
        tokenInvalidatedAt: expect.any(Date),
      }),
      select: expect.any(Object),
    });
  });
});

describe('AdminService — FR-002f password reset', () => {
  it('returns a temporary password and invalidates tokens', async () => {
    const prisma = makePrisma();
    const service = new AdminService(prisma);

    const result = await service.resetPassword('admin-1', 'user-2');
    expect(result.temporaryPassword).toBeTruthy();
    expect(typeof result.temporaryPassword).toBe('string');
    expect(result.temporaryPassword.length).toBeGreaterThan(10);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: expect.objectContaining({
        passwordHash: expect.any(String),
        tokenInvalidatedAt: expect.any(Date),
      }),
    });
  });

  it('prevents admin from resetting own password via this endpoint', async () => {
    const prisma = makePrisma();
    const service = new AdminService(prisma);

    await expect(service.resetPassword('admin-1', 'admin-1')).rejects.toThrow(
      'regular password-change',
    );
  });
});
