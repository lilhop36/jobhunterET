'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, ChevronDown, LogOut, Search, Settings, User } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { pageTitle } from './nav-data';
import { ThemeToggle } from '../theme-toggle';

export function Topbar({ unread }: { unread: number }) {
  const path = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = term.trim();
    router.push(`/jobs${t ? `?q=${encodeURIComponent(t)}` : ''}`);
  };

  const title = pageTitle(path);

  const initials = (user?.email?.split('@')[0] ?? '?').slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card/90 px-4 backdrop-blur sm:px-6 lg:px-8">
      <h1 className="min-w-0 flex-1 truncate text-[17px] font-extrabold tracking-tight">{title}</h1>

      <form onSubmit={submit} role="search" className="relative hidden md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={`${t('shell.searchJobs')}…`}
          aria-label={t('shell.searchJobs')}
          className="h-9 w-56 rounded-full pl-9 pr-3 text-sm lg:w-64"
        />
      </form>

      <Link
        href="/inbox"
        aria-label={`Inbox${unread > 0 ? `, ${unread} unread` : ''}`}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
            {unread}
          </span>
        )}
      </Link>

      <ThemeToggle />

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account menu"
          className="flex h-10 items-center gap-1.5 rounded-full pr-1 pl-0.5 transition-colors hover:bg-muted"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-[13px] font-bold text-primary">
            {initials}
          </span>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 w-60 rounded-xl border border-border bg-card p-1.5 shadow-lg"
          >
            <div className="border-b border-border px-3 py-2">
              <div className="truncate text-[13px] font-semibold">{user?.email}</div>
              <div className="text-[11px] text-muted-foreground">{t('shell.signedInAs')} {user?.role}</div>
            </div>
            <Link
              href="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
            >
              <User className="h-4 w-4 text-muted-foreground" /> Profile
            </Link>
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
            >
              <Settings className="h-4 w-4 text-muted-foreground" /> Settings
            </Link>
            <button
              role="menuitem"
              onClick={logout}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" /> Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
