import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Read port constants from root .env (single source of truth) ──
function loadPorts() {
  try {
    const raw = readFileSync(resolve(import.meta.dirname, '..', '.env'), 'utf8');
    const get = (k, fallback) => {
      const m = raw.match(new RegExp(`^${k}=(.+)$`, 'm'));
      return m ? m[1].trim() : fallback;
    };
    return {
      frontend: Number(get('FRONTEND_PORT', '3211')),
      backend: Number(get('BACKEND_PORT', '3210')),
    };
  } catch {
    return { frontend: 3211, backend: 3210 };
  }
}

const ports = loadPorts();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Disable the Next.js dev indicator (floating "N" logo)
  devIndicators: false,

  // Tell Next.js where the monorepo root is (silences multi-lockfile warning)
  // Only set when building outside Vercel (Vercel handles this itself)
  ...(process.env.VERCEL ? {} : { outputFileTracingRoot: resolve(import.meta.dirname, '..') }),

  // ── Turbopack (stable in Next 15 — replaces webpack for dev) ──
  // Persistent disk cache: compiled modules survive restarts.
  // First cold start compiles, subsequent starts load from cache.
  turbopack: {
    // Rules let you customize module resolution per-filetype.
    // Add loaders here if you need e.g. MDX or SVG transforms.
    rules: {},
  },

  async rewrites() {
    // SRS §24 API lives at /api/* — proxy to the NestJS backend.
    // Only apply rewrites in development (not on Vercel)
    if (process.env.VERCEL) {
      return [];
    }
    return [
      {
        source: '/api/:path*',
        destination: `http://localhost:${ports.backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
