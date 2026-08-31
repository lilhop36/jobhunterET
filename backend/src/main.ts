import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { parsePort } from './common/utils/parse-port';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

// Env vars (DATABASE_URL, JWT_SECRET) are set by start.sh before this runs.
// When running locally with `node dist/main.js` directly, set them in .env.

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // SEC-001: Helmet security headers (X-Content-Type-Options, X-Frame-Options, etc.)
  app.use(helmet());

  // SEC-011: parse cookies for SSE token auth
  app.use(cookieParser());

  // SEC-002: CORS — restrict to known origins when CORS_ORIGIN is set,
  // otherwise allow all origins so the app works without env var config.
  const corsOrigin = process.env.CORS_ORIGIN;
  const allowedOrigins = corsOrigin
    ? corsOrigin.split(',').map((s) => s.trim())
    : [];
  const isDev = process.env.NODE_ENV !== 'production';
  app.enableCors({
    origin: isDev || allowedOrigins.length === 0
      ? true
      : (origin: string) => allowedOrigins.includes(origin),
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
