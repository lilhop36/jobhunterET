'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ThemeProvider } from 'next-themes';
import { AuthProvider, useAuth } from '../lib/auth';
import { RequireAuth, useApi } from '../lib/ui';
import { Sidebar } from '../components/shell/sidebar';
import { Topbar } from '../components/shell/topbar';
import { BottomNav } from '../components/shell/bottom-nav';
import '../styles/globals.css';

function Shell({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const path = usePathname();
  const { data, loading, reload } = useApi<{ unread: number; completion: number }>('/api/dashboard');

  useEffect(() => {
    if (!token || path === '/login' || path === '/register') return;
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
    <html lang="en" suppressHydrationWarning>
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
