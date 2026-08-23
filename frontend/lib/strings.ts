/**
 * §32.9: String externalization for i18n readiness.
 * All user-facing strings live here. Translations are Phase 2.
 * Usage: import { STRINGS } from '@/lib/strings'; then STRINGS.dashboard.title
 */

export const STRINGS = {
  // ── Navigation ──────────────────────────────────────────────
  nav: {
    home: 'Home',
    matches: 'Matches',
    saved: 'Saved',
    applications: 'Applications',
    profile: 'Profile',
    settings: 'Settings',
    inbox: 'Inbox',
    sources: 'Sources',
    users: 'Users',
    searches: 'Searches',
  },

  // ── Dashboard ───────────────────────────────────────────────
  dashboard: {
    greeting: 'Selam',
    subtitle: "Here's what your job search looks like today.",
    profileCompletion: 'Profile completion',
    profileEdit: 'edit',
    profileFinishHint: 'finish your profile for better matches',
    recentAlerts: 'Recent alerts',
    noNotifications: 'No notifications yet.',
    browseMatches: 'Browse your matches',
    browseJobs: 'Browse all jobs',
    topMatches: 'Top matches',
    savedJobs: 'Saved',
    aboveThreshold: 'Above threshold',
    applied: 'Applied',
  },

  // ── Jobs ────────────────────────────────────────────────────
  jobs: {
    title: 'Jobs',
    searchPlaceholder: 'Search jobs…',
    noResults: 'No jobs match your filters',
    noResultsHint: 'Try adjusting your search or filters.',
    source: 'Source',
    posted: 'Posted',
    deadline: 'Deadline',
    apply: 'Apply',
    save: 'Save',
    saved: 'Saved',
    reject: 'Reject',
    viewDetails: 'View details',
    remote: 'Remote',
    onsite: 'On-site',
    hybrid: 'Hybrid',
  },

  // ── Matches ─────────────────────────────────────────────────
  matches: {
    title: 'Matches',
    filterAll: 'ALL',
    filterExcellent: 'EXCELLENT',
    filterStrong: 'STRONG',
    filterGood: 'GOOD',
    filterUnseen: 'UNSEEN',
    nothingUnseen: 'Nothing unseen',
    noMatches: 'No matches here yet',
    noMatchesHint: 'Matches appear once we find jobs that fit your profile.',
    recalcButton: 'Recalculate',
    recalcQueued: 'Recalculation queued',
    score: 'Score',
    whyThisMatch: 'Why this match',
    matchedSkills: 'Matched',
    missingSkills: 'Missing',
    relatedSkills: 'Related',
  },

  // ── Saved Jobs ──────────────────────────────────────────────
  saved: {
    title: 'Saved Jobs',
    empty: 'Nothing saved yet',
    emptyHint: 'Save jobs you\'re interested in to review them later.',
    browseJobs: 'Browse jobs',
  },

  // ── Applications ────────────────────────────────────────────
  applications: {
    title: 'Applications',
    empty: 'No applications yet',
    emptyHint: 'Track your job applications through each stage.',
    stages: {
      discovered: 'Discovered',
      saved: 'Saved',
      applied: 'Applied',
      assessment: 'Assessment',
      interview: 'Interview',
      offer: 'Offer',
      rejected: 'Rejected',
      withdrawn: 'Withdrawn',
    },
  },

  // ── Inbox ───────────────────────────────────────────────────
  inbox: {
    title: 'Inbox',
    empty: "Inbox empty — you're all caught up",
    emptyHint: "When Telegram isn't linked (or delivery fails), qualifying matches land here so nothing is ever lost.",
    markRead: 'Mark read',
    unread: 'UNREAD',
    read: 'READ',
  },

  // ── Profile ─────────────────────────────────────────────────
  profile: {
    title: 'Profile',
    professionalTitle: 'Professional title',
    summary: 'Summary',
    skills: 'Skills',
    experience: 'Years of experience',
    education: 'Education',
    preferredRoles: 'Preferred roles',
    preferredLocations: 'Preferred locations',
    remotePreference: 'Remote preference',
    employmentTypes: 'Employment types',
    salaryPreference: 'Salary preference',
    relocationPreference: 'Relocation preference',
    save: 'Save profile',
    saved: 'Profile saved',
    cvUpload: 'Upload CV',
    cvFormats: 'PDF or DOCX, max 5 MB',
    cvActive: 'Active CV',
    cvReplace: 'Replace',
    cvDelete: 'Delete',
  },

  // ── Onboarding ──────────────────────────────────────────────
  onboarding: {
    title: 'Set up your profile',
    step1: 'Roles',
    step2: 'Skills',
    step3: 'Locations',
    skip: 'Skip for now',
    finish: 'Finish setup',
    addRole: 'Add a target role',
    addSkill: 'Add a skill',
    addLocation: 'Add a location',
  },

  // ── Settings ────────────────────────────────────────────────
  settings: {
    title: 'Settings',
    telegram: 'Telegram',
    telegramLink: 'Link Telegram',
    telegramLinked: 'Telegram linked',
    telegramUnlink: 'Unlink',
    deepLinkHint: 'Tap to open Telegram, or send the code manually.',
    singleUseHint: 'single-use and expires after 10 minutes',
    threshold: 'Match threshold',
    thresholdHint: 'Jobs scoring above this trigger a notification',
    pauseNotifications: 'Pause notifications',
    resumeNotifications: 'Resume notifications',
    changePassword: 'Change password',
    currentPassword: 'Current password',
    newPassword: 'New password',
    confirmPassword: 'Confirm password',
  },

  // ── Admin ───────────────────────────────────────────────────
  admin: {
    sources: 'Job sources',
    collectNow: 'Collect now',
    collecting: 'Collecting…',
    users: 'Users',
    enable: 'Enable',
    disable: 'Disable',
    resetPassword: 'Reset password',
    tempPassword: 'Temporary password',
    sourceHistory: 'Run history',
  },

  // ── Auth ────────────────────────────────────────────────────
  auth: {
    login: 'Log in',
    register: 'Register',
    email: 'Email',
    password: 'Password',
    noAccount: "Don't have an account?",
    hasAccount: 'Already have an account?',
    loginTitle: 'Welcome back',
    registerTitle: 'Create account',
  },

  // ── Common ──────────────────────────────────────────────────
  common: {
    loading: 'Loading…',
    error: 'Error',
    retry: 'Retry',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    confirm: 'Confirm',
    back: 'Back',
    next: 'Next',
    done: 'Done',
    close: 'Close',
    search: 'Search',
    filter: 'Filter',
    sort: 'Sort',
    export: 'Export',
    copied: 'Copied!',
    never: 'Never',
    unknown: 'Unknown',
    required: 'Required',
    optional: 'Optional',
  },

  // ── Time ────────────────────────────────────────────────────
  time: {
    justNow: 'just now',
    minutesAgo: '{n}m ago',
    hoursAgo: '{n}h ago',
    daysAgo: '{n}d ago',
    daysLeft: '{n} days left',
    dayLeft: '1 day left',
    expired: 'expired',
  },
} as const;

/** Helper to interpolate {n} in strings like "{n} days left" */
export function t(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\{${k}\}`, 'g'), String(v)),
    template,
  );
}
