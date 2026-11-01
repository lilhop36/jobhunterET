import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PASSWORD_COST } from '../../common/security/password-policy';
import { AuthService } from './auth.service';

describe('AuthService lifecycle', () => {
  it('reactivates dormant users and enqueues match recalculation on login', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'dormant@example.com',
          role: 'USER',
          status: 'DORMANT',
          passwordHash,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const jwt = { sign: jest.fn().mockReturnValue('token') } as unknown as JwtService;
    const matching = { recalculate: jest.fn().mockResolvedValue(0) } as any;
    const service = new AuthService(prisma, jwt, matching);

    const result = await service.login({ email: 'dormant@example.com', password: 'password123' });

    expect(result.accessToken).toBe('token');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        status: 'ACTIVE',
        lastActiveAt: expect.any(Date),
        // The fixture was hashed at cost 4, below the policy, so the login refreshed it.
        passwordHash: expect.any(String),
      },
    });
    expect(matching.recalculate).toHaveBeenCalledWith('user-1');
  });
});

/**
 * SEC-005 / NFR-001: bcrypt stores its cost inside the hash, so accounts created under an
 * earlier policy keep verifying at that cost — and paying its latency. Login refreshes them,
 * and leaves accounts already at the policy cost untouched.
 */
describe('AuthService password cost refresh (SEC-005)', () => {
  function serviceFor(passwordHash: string) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'someone@example.com',
          role: 'USER',
          status: 'ACTIVE',
          passwordHash,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const jwt = { sign: jest.fn().mockReturnValue('token') } as unknown as JwtService;
    return { prisma, service: new AuthService(prisma, jwt, { recalculate: jest.fn() } as any) };
  }

  it('re-hashes at the current policy cost when the stored hash is below it', async () => {
    const legacy = await bcrypt.hash('password123', 4);
    const { prisma, service } = serviceFor(legacy);

    await service.login({ email: 'someone@example.com', password: 'password123' });

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(bcrypt.getRounds(data.passwordHash)).toBe(PASSWORD_COST);
    await expect(bcrypt.compare('password123', data.passwordHash)).resolves.toBe(true);
  });

  it('does not rewrite the password of an account already at the policy cost', async () => {
    const current = await bcrypt.hash('password123', PASSWORD_COST);
    const { prisma, service } = serviceFor(current);

    await service.login({ email: 'someone@example.com', password: 'password123' });

    expect(prisma.user.update.mock.calls[0][0].data.passwordHash).toBeUndefined();
  });

  it('never re-hashes after a failed credential check', async () => {
    const { prisma, service } = serviceFor(await bcrypt.hash('password123', 4));

    await expect(
      service.login({ email: 'someone@example.com', password: 'wrong-password' }),
    ).rejects.toBeDefined();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

/**
 * FR-001 (SRS §11): registration validates the email is new, hashes the password,
 * and assigns the role by explicit precedence — ADMIN_EMAILS wins when it is
 * configured, otherwise only the very first user becomes ADMIN.
 */
describe('FR-001 — User registration and role assignment', () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;
  const originalInvite = process.env.REGISTRATION_INVITE_CODE;

  // backend/.env is loaded for the suite, so both gates are set explicitly here
  // rather than assumed absent.
  beforeEach(() => {
    delete process.env.ADMIN_EMAILS;
    delete process.env.REGISTRATION_INVITE_CODE;
  });

  afterEach(() => {
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
    if (originalInvite === undefined) delete process.env.REGISTRATION_INVITE_CODE;
    else process.env.REGISTRATION_INVITE_CODE = originalInvite;
  });

  /** `existing` is what findUnique({where:{email}}) returns; `userCount` is the pre-insert total. */
  function makePrisma({ existing = null, userCount = 1, createError }: {
    existing?: any;
    userCount?: number;
    createError?: any;
  } = {}) {
    const create = jest.fn((args: any) =>
      createError
        ? Promise.reject(Object.assign(createError, { meta: { args } }))
        : Promise.resolve({ id: 'user-1', status: 'ACTIVE', ...args.data }),
    );
    const tx = { user: { count: jest.fn().mockResolvedValue(userCount) } };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(existing), create },
      $transaction: jest.fn((fn: any) => fn(tx)),
    } as any;
    return { prisma, tx, create };
  }

  const service = (prisma: any) =>
    new AuthService(prisma, { sign: jest.fn().mockReturnValue('jwt') } as unknown as JwtService, {
      recalculate: jest.fn(),
    } as any);

  it('gives ADMIN only to the addresses listed in ADMIN_EMAILS', async () => {
    process.env.ADMIN_EMAILS = 'Root@Example.com, ops@example.com';
    const listed = makePrisma();
    const listedResult = await service(listed.prisma).register({
      email: 'root@example.com',
      password: 'sup3rsecret',
    } as any);
    expect(listed.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'ADMIN' }) }),
    );

    // A configured list is exclusive: the 5th user is USER even though no one
    // else in the table holds ADMIN.
    const outsider = makePrisma({ userCount: 4 });
    await service(outsider.prisma).register({ email: 'analyst@example.com', password: 'sup3rsecret' });
    expect(outsider.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'USER' }) }),
    );
    expect(listedResult.user.role).toBe('ADMIN');
  });

  it('makes the first user ADMIN only when ADMIN_EMAILS is empty', async () => {
    process.env.ADMIN_EMAILS = '';
    const first = makePrisma({ userCount: 0 });
    await service(first.prisma).register({ email: 'founder@example.com', password: 'sup3rsecret' });
    expect(first.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'ADMIN' }) }),
    );

    const second = makePrisma({ userCount: 1 });
    await service(second.prisma).register({ email: 'second@example.com', password: 'sup3rsecret' });
    expect(second.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'USER' }) }),
    );
  });

  it('hashes the password with bcrypt and creates the candidate profile in the same insert', async () => {
    process.env.ADMIN_EMAILS = '';
    const { prisma, create } = makePrisma({ userCount: 0 });
    await service(prisma).register({ email: 'analyst@example.com', password: 'sup3rsecret' });

    const data = create.mock.calls[0][0].data;
    expect(data.passwordHash).not.toContain('sup3rsecret');
    expect(data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare('sup3rsecret', data.passwordHash)).toBe(true);
    expect(data.profile).toEqual({ create: {} });
  });

  it('refuses an email that is already registered', async () => {
    const { prisma, create } = makePrisma({ existing: { id: 'existing-1', email: 'taken@example.com' } });
    await expect(
      service(prisma).register({ email: 'taken@example.com', password: 'sup3rsecret' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('turns a unique-constraint race on email into the same 409', async () => {
    // Two registrations can pass the findUnique check together; the index is the
    // real guard, so P2002 must not surface as a 500.
    const { prisma } = makePrisma({ createError: { code: 'P2002' } });
    await expect(
      service(prisma).register({ email: 'racer@example.com', password: 'sup3rsecret' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
