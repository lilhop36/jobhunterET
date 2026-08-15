'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Target, Bookmark, Briefcase, User } from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';

const TABS = [
  { href: '/dashboard', labelKey: 'nav.home', icon: Home },
  { href: '/matches', labelKey: 'nav.matches', icon: Target },
  { href: '/saved', labelKey: 'nav.saved', icon: Bookmark },
  { href: '/applications', labelKey: 'nav.applications', icon: Briefcase },
  { href: '/profile', labelKey: 'nav.profile', icon: User },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-between gap-1 px-2 pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ href, labelKey, icon: Icon }) => {
          const active = path === href;
          const label = t(labelKey);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-[60px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10.5px] font-medium transition-colors',
                active ? 'bg-primary/15 text-primary' : 'text-muted-foreground',
              )}
              style={{ minHeight: 54 }}
            >
              <Icon className={cn('h-5 w-5', active && 'fill-primary/20')} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
