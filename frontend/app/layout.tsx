'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ThemeProvider } from 'next-themes';
import { AuthProvider, useAuth } from '../lib/auth';
import { Sidebar } from '../components/shell/sidebar';
import { Topbar } from '../components/shell/topbar';
import { BottomNav } from '../components/shell/bottom-nav';
import '../styles/globals.css';

function Shell({ children }: { children: ReactNode }) {
  const { token, api } = useAuth();
  const path = usePathname();
  const [data, setData] = useState<{ unread: number; completion: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || path === '/login' || path === '/register') {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    api('/api/dashboard')
      .then((d) => alive && setData({ unread: d?.counts?.unread ?? 0, completion: d?.completion ?? 0 }))
      .catch(() => alive && setData({ unread: 0, completion: 0 }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
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
