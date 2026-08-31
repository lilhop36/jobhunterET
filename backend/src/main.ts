import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { parsePort } from './common/utils/parse-port';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { execSync } from 'child_process';

// Ensure required env vars have sane defaults so the app boots on Render
// without manual env var configuration.
if (!process.env.DATABASE_URL) {
  const dbPath = join(__dirname, '..', 'prod.db');
  process.env.DATABASE_URL = `file:${dbPath}`;
  console.warn(`[main] DATABASE_URL not set — defaulting to local SQLite: ${dbPath}`);
}
if (!process.env.JWT_SECRET) {
  const { randomBytes } = require('crypto');
  process.env.JWT_SECRET = randomBytes(48).toString('base64url');
  console.warn('[main] JWT_SECRET not set — auto-generated (sessions lost on restart)');
}

// Push Prisma schema to the database using the SAME DATABASE_URL the app will use.
// This ensures the SQLite file and tables exist before the app connects.
if (process.env.DATABASE_URL.startsWith('file:')) {
  console.log('[main] Running prisma db push to ensure database schema...');
  try {
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
      env: process.env,
    });
    console.log('[main] Database schema ready.');
  } catch (e) {
    console.error('[main] prisma db push failed:', e.message);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // SEC-001: Helmet security headers (X-Content-Type-Options, X-Frame-Options, etc.)
  app.use(helmet());

  // SEC-011: parse cookies for SSE token auth
  app.use(cookieParser());

  // SEC-002: CORS — restrict to known origins in production, allow all in dev.
  const corsOrigin = process.env.CORS_ORIGIN;
  const isDev = process.env.NODE_ENV !== 'production';
  app.enableCors({
    origin: isDev ? true : (corsOrigin ? corsOrigin.split(',').map((s) => s.trim()) : false),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });
  const rawPort = process.env.PORT;
  const port = parsePort(rawPort);
  if (rawPort !== undefined && port !== Number(rawPort)) {
    console.warn(`[main] Invalid PORT "${rawPort}" — falling back to ${port}`);
  }
  await app.listen(port);
  console.log(`JobHunter backend listening on http://localhost:${port}`);
}
bootstrap();
