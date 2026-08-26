'use client';

import { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { RequireAuth, useApi, ErrorBox, Loading } from '@/lib/ui';

interface AdminPageShellProps<T> {
  apiPath: string;
  children: (data: T | null, reload: () => void) => ReactNode;
  emptyState?: ReactNode;
}

export function AdminPageShell<T>({ apiPath, children, emptyState }: AdminPageShellProps<T>) {
  const { user } = useAuth();
  const { data, err, loading, reload } = useApi<T>(user?.role === 'ADMIN' ? apiPath : null);

  if (user && user.role !== 'ADMIN') {
    return (
      <RequireAuth>
        <div className="error-box">403 — admin access required.</div>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      {err && !loading && <ErrorBox msg={err} onRetry={reload} />}
      {loading && <Loading />}
      {data ? children(data, reload) : (emptyState ?? null)}
    </RequireAuth>
  );
}
