'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { NAV_GROUPS, isActive } from './nav-data';
import { Progress } from '../ui/progress';

export interface ShellData {
  unread: number;
  completion: number;
  loading: boolean;
}

export function Sidebar({ unread, completion, loading }: ShellData) {
  const { user, logout } = useAuth();
  const path = usePathname();
  const initials = (user?.email?.split('@')[0] ?? '?').slice(0, 2).toUpperCase();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-card lg:flex">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-black text-primary-foreground">
          JH
        </div>
        <span className="text-[17px] font-extrabold tracking-tight">{t('shell.brand')}</span>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label="Sidebar">
        {NAV_GROUPS.map((group) => {
          if (group.adminOnly && user?.role !== 'ADMIN') return null;
          const items = group.items.filter((i) => !i.adminOnly || user?.role === 'ADMIN');
          return (
            <div key={group.titleKey}>
              <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(group.titleKey)}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = isActive(path, item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary font-semibold text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon
                        className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-primary-foreground' : 'text-muted-foreground')}
                      />
                      <span className="flex-1">{t(item.labelKey)}</span>
                      {item.href === '/inbox' && unread > 0 && (
                        <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-bold leading-none text-destructive-foreground">
                          {unread}
                        </span>
                      )}
                      {item.adminOnly && (
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                            active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/15 text-primary',
                          )}
                        >
                          Admin
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg p-1.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold" title={user?.email ?? ''}>
            {user?.email}
          </div>
          <div className="text-[11px] text-muted-foreground">{user?.role}</div>
          </div>
          <button
            onClick={logout}
            aria-label="Log out"
            title="Log out"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-1 px-1 pb-1">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{t('shell.profileCompletion')}</span>
            <span className="font-semibold">{loading ? '…' : `${completion}%`}</span>
          </div>
          {loading ? (
            <div className="h-2.5 w-full animate-pulse rounded-full bg-muted" />
          ) : (
            <Progress value={completion} className="h-2.5" />
          )}
        </div>
      </div>
    </aside>
  );
}
