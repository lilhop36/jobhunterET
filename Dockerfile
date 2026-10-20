# ── Base ──────────────────────────────────────────────────────
FROM node:22 AS base
WORKDIR /app

# ── Backend deps + build ──────────────────────────────────────
FROM base AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
COPY backend/prisma ./prisma/
RUN npm ci
RUN npx prisma generate
COPY backend/tsconfig.json backend/tsconfig.build.json backend/nest-cli.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
RUN npm run build

# ── Frontend deps + build ─────────────────────────────────────
FROM base AS frontend-build
WORKDIR /app
# port config (single source of truth)
COPY .env.example .env
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend ./
RUN npm run build

# ── Runtime ───────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3210

# backend (incl. node_modules, dist, prisma)
COPY --from=backend-build /app/backend /app/backend
# frontend (incl. node_modules, .next)
COPY --from=frontend-build /app/frontend /app/frontend
COPY --from=frontend-build /app/.env /app/.env
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# uploads dir
RUN mkdir -p /app/backend/uploads/cv && chown -R node:node /app
USER node

EXPOSE 3210 3211
CMD ["/app/docker-entrypoint.sh"]