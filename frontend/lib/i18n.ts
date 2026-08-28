// Minimal i18n layer: all user-facing strings are dictionary keys so
// the UI can be translated. English is the MVP.
// locale; User.locale is persisted server-side and surfaced to the client.
// Usage: import { t } from '@/lib/i18n'; t('nav.matches')

export type Locale = 'en';

export const LOCALES: { code: Locale; label: string }[] = [{ code: 'en', label: 'English' }];

const DICT: Record<string, Record<Locale, string>> = {
  // Shell / navigation
  'nav.find': { en: 'Find' },
  'nav.track': { en: 'Track' },
  'nav.you': { en: 'You' },
  'nav.admin': { en: 'Admin' },
  'nav.dashboard': { en: 'Dashboard' },
  'nav.matches': { en: 'Matches' },
  'nav.jobs': { en: 'Jobs' },
  'nav.saved': { en: 'Saved' },
  'nav.applications': { en: 'Applications' },
  'nav.inbox': { en: 'Inbox' },
  'nav.searches': { en: 'Searches' },
  'nav.profile': { en: 'Profile' },
  'nav.settings': { en: 'Settings' },
  'nav.sources': { en: 'Sources' },
  'shell.brand': { en: 'JobHunter' },
  'shell.profileCompletion': { en: 'Profile completion' },
  'shell.signedInAs': { en: 'Signed in as' },
  'shell.logout': { en: 'Log out' },
  'shell.searchJobs': { en: 'Search jobs' },
  'shell.accountMenu': { en: 'Account menu' },
  'shell.inboxWithCount': { en: 'Inbox' },
  'nav.home': { en: 'Home' },

  // Page titles
  'page.dashboard': { en: 'Dashboard' },
  'page.matches': { en: 'Matches' },
  'page.jobs': { en: 'Jobs' },
  'page.saved': { en: 'Saved' },
  'page.applications': { en: 'Applications' },
  'page.inbox': { en: 'Inbox' },
  'page.searches': { en: 'Saved searches' },
  'page.profile': { en: 'Profile' },
  'page.settings': { en: 'Settings' },
  'page.sources': { en: 'Sources' },
  'page.jobDetails': { en: 'Job details' },
};

const STORAGE_KEY = 'jh_locale';

export function getLocale(): Locale {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && DICT['nav.home'][saved]) return saved;
  }
  return 'en';
}

export function setLocale(l: Locale) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, l);
}

export function t(key: string, locale: Locale = getLocale()): string {
  return DICT[key]?.[locale] ?? key;
}
