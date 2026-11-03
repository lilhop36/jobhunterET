/**
 * Resolve the official application channel for a vacancy (Phase 9).
 *
 * JobPilot may only ever submit through a channel the employer actually
 * published. This module reads the fields ingestion already recorded
 * (`applyMethod`, `applyUrl`, `applyEmail`, `finalUrl`, the posting `url`) and
 * classifies them. It never guesses a destination and never invents one.
 *
 * Automated submission is deliberately *not* decided here: the caller pairs
 * this with a transport, and the default transport supports nothing. That keeps
 * every real submission a manual, human-confirmed act while leaving room for an
 * explicitly registered, official integration.
 */

export type SubmissionChannelType = 'WEB' | 'EMAIL' | 'TELEGRAM' | 'UNKNOWN';

export interface SubmissionChannel {
  type: SubmissionChannelType;
  /** Official http(s) destination, when one exists. */
  url: string | null;
  /** Official email destination, when one exists. */
  email: string | null;
  /** Candidate-facing explanation of how this vacancy is applied to. */
  reason: string;
}

export interface ChannelJobInput {
  url?: string | null;
  finalUrl?: string | null;
  applyUrl?: string | null;
  applyEmail?: string | null;
  applyMethod?: string | null;
  source?: { type?: string | null; name?: string | null } | null;
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function httpUrl(value: unknown): string | null {
  const candidate = clean(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** A job posted on Telegram is applied to through the post, never by a bot. */
function isTelegram(host: string): boolean {
  return host === 't.me' || host === 'telegram.me' || host.endsWith('.telegram.org') || host.includes('telegram');
}

export function resolveSubmissionChannel(job: ChannelJobInput): SubmissionChannel {
  const applyUrl = clean(job.applyUrl);
  const applyEmail = clean(job.applyEmail);
  const method = clean(job.applyMethod).toUpperCase();

  // A mailto: apply link is an email channel even when applyMethod is generic.
  if (/^mailto:/i.test(applyUrl)) {
    const address = applyUrl.replace(/^mailto:/i, '').split('?')[0].trim();
    if (address) {
      return {
        type: 'EMAIL',
        url: null,
        email: address,
        reason: 'Applications for this vacancy are accepted by email.',
      };
    }
  }

  if (method === 'EMAIL' && applyEmail) {
    return {
      type: 'EMAIL',
      url: null,
      email: applyEmail,
      reason: 'Applications for this vacancy are accepted by email.',
    };
  }

  const url = httpUrl(job.applyUrl) ?? httpUrl(job.finalUrl) ?? httpUrl(job.url);
  if (!url) {
    return {
      type: 'UNKNOWN',
      url: null,
      email: applyEmail || null,
      reason: 'No official application link or email is recorded for this vacancy.',
    };
  }

  if (isTelegram(hostOf(url))) {
    return {
      type: 'TELEGRAM',
      url,
      email: null,
      reason: 'This vacancy was posted on Telegram; apply through the original post.',
    };
  }

  return {
    type: 'WEB',
    url,
    email: null,
    reason: 'Apply through the official posting.',
  };
}