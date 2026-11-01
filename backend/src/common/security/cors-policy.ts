/**
 * NFR-009 / SEC-002: CORS origin policy.
 *
 * Kept as a pure function of the environment so the production rule — "allow only
 * configured web origins, never a wildcard" — can be exercised without booting Nest.
 * `main.ts` hands the result to `app.enableCors()`, which passes it straight to the
 * `cors` package.
 *
 * The shape matters: `cors@2.8` only enforces allowlists it can compare itself
 * (string or string[]). A predicate function is never called with a value it can
 * honour — it produces no `Access-Control-Allow-Origin` header at all, which would
 * silently reject the very origins the operator configured. So the allowlist is
 * exported as an array, and the predicate below exists for tests and callers that
 * want to ask the question directly.
 */

export type CorsOriginOption = true | string[];

export interface CorsPolicy {
  origin: CorsOriginOption;
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
  maxAge: number;
}

/** `CORS_ORIGIN=a,b , c` → `['a', 'b', 'c']`; unset or blank → `[]`. */
export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface CorsDecision {
  policy: CorsPolicy;
  /**
   * True when the configuration is unusable in production: no origins were
   * configured, and the only permissive alternative would be a wildcard.
   */
  refusesToStart: boolean;
  /** True when requests from any origin are accepted (development convenience). */
  permissive: boolean;
  /** The exact origins the production policy will allow — empty when permissive. */
  allowedOrigins: string[];
}

export function buildCorsPolicy(env: NodeJS.ProcessEnv = process.env): CorsDecision {
  const allowedOrigins = parseAllowedOrigins(env.CORS_ORIGIN);
  const isDev = env.NODE_ENV !== 'production';
  const permissive = isDev || allowedOrigins.length === 0;

  return {
    policy: {
      origin: permissive ? true : allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    },
    // Development may run without configuration; production may not.
    refusesToStart: !isDev && allowedOrigins.length === 0,
    permissive,
    allowedOrigins,
  };
}

/**
 * The question the policy answers, expressed directly — used by tests that assert
 * an origin's fate without driving the HTTP middleware.
 */
export function isOriginAllowedByPolicy(origin: string | undefined, decision: CorsDecision): boolean {
  if (decision.permissive) return true;
  if (!origin) return false;
  return (decision.policy.origin as string[]).includes(origin);
}
