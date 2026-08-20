import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
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
      data: { status: 'ACTIVE', lastActiveAt: expect.any(Date) },
    });
    expect(matching.recalculate).toHaveBeenCalledWith('user-1');
  });
});