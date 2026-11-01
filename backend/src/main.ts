import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { parsePort } from './common/utils/parse-port';
import { buildCorsPolicy } from './common/security/cors-policy';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

// Env vars (DATABASE_URL, JWT_SECRET) are set by start.sh before this runs.
// When running locally with `node dist/main.js` directly, set them in .env.
import { join } from 'path';
import { randomBytes } from 'crypto';

if (!process.env.DATABASE_URL) {
  // Use cwd() so the path works regardless of where node is launched from
  const dbPath = join(process.cwd(), 'prod.db');
  process.env.DATABASE_URL = `file:${dbPath}`;
  console.log('[main] DATABASE_URL defaulted to', process.env.DATABASE_URL);
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = randomBytes(48).toString('base64url');
  console.warn('[main] JWT_SECRET not set or too short — auto-generated. Sessions will not survive restarts.');
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // SEC-001: Helmet security headers (X-Content-Type-Options, X-Frame-Options, etc.)
  app.use(helmet());

  // SEC-011: parse cookies for SSE token auth
  app.use(cookieParser());

  // SEC-002 / NFR-009: CORS is decided by buildCorsPolicy() so the production
  // rule ("only configured origins, never a wildcard") is testable without booting Nest.
  const cors = buildCorsPolicy(process.env);
  if (cors.refusesToStart) {
    console.error('[main] CORS_ORIGIN must be set in production. Refusing to start with permissive CORS.');
    process.exit(1);
  }
  app.enableCors(cors.policy);
  const rawPort = process.env.PORT;
  const port = parsePort(rawPort);
  if (rawPort !== undefined && port !== Number(rawPort)) {
    console.warn(`[main] Invalid PORT "${rawPort}" — falling back to ${port}`);
  }
  await app.listen(port);
  console.log(`JobHunter backend listening on http://localhost:${port}`);
}
bootstrap();
