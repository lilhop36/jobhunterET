'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ThemeProvider } from 'next-themes';
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { AuthProvider, useAuth } from '../lib/auth';
import { RequireAuth, useApi } from '../lib/ui';
import { Sidebar } from '../components/shell/sidebar';
import { Topbar } from '../components/shell/topbar';
import { BottomNav } from '../components/shell/bottom-nav';
import '../styles/globals.css';

// next/font downloads these at build time and serves them from our own origin with a preload, which
// is what removed the two third-party round trips NFR-006 measured as 3.4s of first paint.
const fontBody = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--loaded-body' });
const fontDisplay = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--loaded-display',
});
const fontMono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--loaded-mono' });

function Shell({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const path = usePathname();
  const dashboardPath =
    token && path !== '/login' && path !== '/register' ? '/api/dashboard' : null;
  const { data, loading, reload } = useApi<{ unread: number; completion: number }>(dashboardPath);

  useEffect(() => {
    if (!dashboardPath) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, path]);

  const authed = !!token && path !== '/login' && path !== '/register';
  const unread = data?.unread ?? 0;
  const completion = data?.completion ?? 0;

  return (
    <div className="min-h-screen bg-background">
      {authed && <Sidebar unread={unread} completion={completion} loading={loading} />}
      <div className={authed ? 'lg:pl-64' : ''}>
        {authed && <Topbar unread={unread} />}
        <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12">
          {children}
        </main>
      </div>
      {authed && <BottomNav />}
    </div>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fontBody.variable} ${fontDisplay.variable} ${fontMono.variable}`} suppressHydrationWarning>
      <head>
        <title>JobHunter</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AuthProvider>
            <Shell>{children}</Shell>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
