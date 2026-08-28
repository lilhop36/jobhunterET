import {
  LayoutDashboard,
  Target,
  Search,
  Bookmark,
  Briefcase,
  Inbox,
  History,
  User,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { t } from '@/lib/i18n';

export interface NavItem {
  href: string;
  /** i18n dictionary key — labels resolved via t() */
  labelKey: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export interface NavGroup {
  /** i18n dictionary key */
  titleKey: string;
  adminOnly?: boolean;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    titleKey: 'nav.find',
    items: [
      { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
      { href: '/matches', labelKey: 'nav.matches', icon: Target },
      { href: '/jobs', labelKey: 'nav.jobs', icon: Search },
      { href: '/saved', labelKey: 'nav.saved', icon: Bookmark },
    ],
  },
  {
    titleKey: 'nav.track',
    items: [
      { href: '/applications', labelKey: 'nav.applications', icon: Briefcase },
      { href: '/inbox', labelKey: 'nav.inbox', icon: Inbox },
      { href: '/searches', labelKey: 'nav.searches', icon: History },
    ],
  },
  {
    titleKey: 'nav.you',
    items: [
      { href: '/profile', labelKey: 'nav.profile', icon: User },
      { href: '/settings', labelKey: 'nav.settings', icon: Settings },
    ],
  },
  {
    titleKey: 'nav.admin',
    adminOnly: true,
    items: [{ href: '/sources', labelKey: 'nav.sources', icon: ShieldCheck, adminOnly: true }],
  },
];

export const PAGE_TITLE_KEYS: Record<string, string> = {
  '/dashboard': 'page.dashboard',
  '/matches': 'page.matches',
  '/jobs': 'page.jobs',
  '/saved': 'page.saved',
  '/applications': 'page.applications',
  '/inbox': 'page.inbox',
  '/searches': 'page.searches',
  '/profile': 'page.profile',
  '/settings': 'page.settings',
  '/sources': 'page.sources',
};

export const pageTitle = (path: string): string => {
  const key = PAGE_TITLE_KEYS[path] ?? (path.startsWith('/jobs/') ? 'page.jobDetails' : undefined);
  return key ? t(key) : 'JobHunter';
};

/** Exact match, or a section root (e.g. /jobs/* belongs to Jobs). */
export const isActive = (path: string, href: string) =>
  path === href || (href !== '/dashboard' && path.startsWith(href));
