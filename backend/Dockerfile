FROM node:22 AS base
# cache-bust: 2026-09-01

# ── Dependencies ──
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci --omit=dev
RUN npx prisma generate

# ── Build ──
FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ── Production ──
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/scripts ./scripts
COPY start.sh ./start.sh

# Create SQLite database with schema during build (node:22 has OpenSSL)
RUN DATABASE_URL="file:./prod.db" npx prisma db push --skip-generate --accept-data-loss

USER nestjs

EXPOSE 3210

CMD ["sh", "start.sh"]
