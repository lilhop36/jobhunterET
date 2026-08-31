import { Module, Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * SEC-001 hardening: use JWT_SECRET from env when available.
 * Auto-generates a random secret if missing, so deployments work
 * out of the box. Set JWT_SECRET env var for persistence across restarts.
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) {
    return secret;
  }
  if (secret) {
    Logger.warn(
      'JWT_SECRET is too short (<32 chars). Auto-generating a random secret. '
        + 'Set a strong JWT_SECRET env var for persistence across restarts.',
      'AuthModule',
    );
  } else {
    Logger.warn(
      'JWT_SECRET not set — auto-generating a random secret. '
        + 'Set a strong JWT_SECRET env var for persistence across restarts.',
      'AuthModule',
    );
  }
  const generated = randomBytes(48).toString('base64url');
  Logger.log(
    `Auto-generated JWT_SECRET: ${generated.slice(0, 8)}... (set JWT_SECRET env var to persist)`,
    'AuthModule',
  );
  return generated;
}

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: resolveJwtSecret(),
        signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
      }),
      global: true,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
