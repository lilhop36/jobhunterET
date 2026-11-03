import { NextRequest, NextResponse } from 'next/server';

/**
 * NFR-006: decide where `/` goes on the server, from the session cookie the backend already sets
 * (auth.controller.ts `setAuthCookie`, 7-day httpOnly `jh_token`).
 *
 * A client component at `/` cannot do this cheaply: every visitor downloads the shell bundle to
 * learn where they should be, and an anonymous one then watches a "Redirecting…" placeholder for
 * seconds before the login page arrives. Measured on Lighthouse's simulated-3G profile that was
 * 5.3s to first paint and 138 KB of JS for a page with no content in it.
 */
export function middleware(req: NextRequest) {
  const dest = req.cookies.has('jh_token') ? '/dashboard' : '/login';
  return NextResponse.redirect(new URL(dest, req.url));
}

export const config = { matcher: ['/'] };
