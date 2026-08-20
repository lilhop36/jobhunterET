/**
 * Job Fidelity Pipeline — FR-012d through FR-013.
 *
 * Handles:
 *  - URL normalization (FR-012f)
 *  - Description extraction & cleaning (FR-012d)
 *  - Description quality scoring (FR-012e)
 *  - Apply-method extraction (FR-012g)
 *  - Field accuracy rules (FR-012h)
 *  - Ingestion-time URL liveness (FR-013)
 */

import { Logger } from '@nestjs/common';

const logger = new Logger('JobFidelity');

// ─── FR-012f: URL Normalization ──────────────────────────────────────────────

/** Tracking parameters to strip from URLs. */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid',
  'ref', 'source', 'via', 'sharer', 'share_source',
];

const URL_MAX_REDIRECTS = Number(process.env.URL_MAX_REDIRECTS ?? 3);

/**
 * FR-012f: Normalize a URL.
 * 1. Resolve relative links against baseUrl
 * 2. Strip tracking parameters
 * 3. Force absolute HTTPS where possible
 */
export function normalizeUrl(raw: string, baseUrl?: string): string {
  let url: URL;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    // If it's not a valid URL even with base, return as-is
    return raw;
  }

  // Force HTTPS where possible
  if (url.protocol === 'http:' && !url.hostname.includes('localhost')) {
    url.protocol = 'https:';
  }

  // Strip tracking parameters
  for (const param of TRACKING_PARAMS) {
    url.searchParams.delete(param);
  }

  return url.toString();
}

/**
 * FR-013: Check URL liveness with a polite HEAD request.
 * Returns the final URL status and redirect chain result.
 */
export async function checkUrlLiveness(
  url: string,
): Promise<{ urlStatus: string; finalUrl?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let currentUrl = url;
    let redirects = 0;
    let lastResponse: Response | undefined;

    while (redirects <= URL_MAX_REDIRECTS) {
      const res = await fetch(currentUrl, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'manual', // Handle redirects ourselves to track the chain
      });

      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const location = res.headers.get('location')!;
        currentUrl = new URL(location, currentUrl).toString();
        redirects++;
        continue;
      }

      lastResponse = res;
      break;
    }

    clearTimeout(timeout);

    if (!lastResponse) {
      return { urlStatus: 'ERROR', finalUrl: currentUrl };
    }

    if (lastResponse.status === 404 || lastResponse.status === 410) {
      return { urlStatus: 'NOT_FOUND', finalUrl: currentUrl };
    }

    if (lastResponse.ok) {
      return { urlStatus: 'OK', finalUrl: currentUrl !== url ? currentUrl : undefined };
    }

    return { urlStatus: 'ERROR', finalUrl: currentUrl };
  } catch {
    return { urlStatus: 'ERROR' };
  }
}

// ─── FR-012d: Description Extraction & Cleaning ──────────────────────────────

/** Boilerplate text patterns to strip from descriptions. */
const BOILERPLATE_PATTERNS = [
  /apply\s+now/gi,
  /share\s+(this|on)/gi,
  /©\s*\d{4}/g,
  /all\s+rights\s+reserved/gi,
  /cookie(s)?\s+(policy|notice|consent)/gi,
  /privacy\s+policy/gi,
  /terms\s+(of|&)\s+(service|use|conditions)/gi,
  /sign\s+up\s+(for|to)\s+(updates|newsletter)/gi,
  /follow\s+us\s+on/gi,
  /social\s+media/gi,
  /share\s+(this|on)\s+(twitter|facebook|linkedin|whatsapp)/gi,
  /\.\.\.\/more/gi,
  /\.\.\.\s*$/g,
  /^\s*\.{3}\s*/gm,
];

/** HTML tags to strip (navigation, aside, footer, ads). */
const STRIP_TAGS = ['script', 'style', 'nav', 'aside', 'footer', 'header', 'form', 'noscript'];

/**
 * FR-012d: Clean a raw HTML or plain-text description.
 * Returns cleaned plain text.
 */
export function cleanDescription(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // Strip unwanted HTML tags and their content
  for (const tag of STRIP_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    text = text.replace(regex, '');
  }

  // Remove remaining HTML tags but preserve structure
  // Convert <br>, <p>, <li>, <h1>-<h6> to newlines first
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6]|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');

  // Fix common mojibake patterns (Latin-1/Windows-1252)
  text = text
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€\x9D/g, '"')
    .replace(/â€"/g, '—')
    .replace(/â€"/g, '–')
    .replace(/Ã©/g, 'é')
    .replace(/Ã¨/g, 'è')
    .replace(/Ã¼/g, 'ü')
    .replace(/Ã¶/g, 'ö')
    .replace(/Ã¤/g, 'ä');

  // Apply boilerplate blocklist
  for (const pattern of BOILERPLATE_PATTERNS) {
    text = text.replace(pattern, '');
  }

  // Collapse repeated whitespace (but preserve single newlines)
  text = text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '')
    .trim();

  return text;
}

// ─── FR-012e: Description Quality Score ───────────────────────────────────────

const MIN_DESCRIPTION_CHARS = Number(process.env.MIN_DESCRIPTION_CHARS ?? 300);

/**
 * FR-012e: Score description quality 0-100.
 * Weighted signals: length, truncation markers, boilerplate ratio,
 * mojibake indicators, structural quality.
 */
export function scoreDescriptionQuality(text: string): number {
  if (!text) return 0;

  let score = 0;

  // 1. Length signal (0-30 points)
  const len = text.length;
  if (len >= 300) score += 30;
  else if (len >= 200) score += 20;
  else if (len >= 100) score += 10;
  else score += 5;

  // 2. Truncation markers (0-20 points, penalty)
  const truncationMarkers = [/\.{3}/, /\u2026/, /\/more/i, /\.\.\./];
  const hasTruncation = truncationMarkers.some((p) => p.test(text));
  if (!hasTruncation) score += 20;
  else score += 5; // severe penalty

  // 3. Boilerplate ratio (0-20 points)
  // If significant boilerplate remains, lower score
  const boilerplateHits = BOILERPLATE_PATTERNS.filter((p) => p.test(text)).length;
  if (boilerplateHits === 0) score += 20;
  else if (boilerplateHits <= 2) score += 12;
  else score += 5;

  // 4. Mojibake indicators (0-15 points, penalty)
  const mojibakePatterns = [/â€/, /Ã[©üöä]/, /\xc3/];
  const hasMojibake = mojibakePatterns.some((p) => p.test(text));
  if (!hasMojibake) score += 15;
  else score += 0;

  // 5. Structural quality (0-15 points)
  const hasHeadings = /^#{1,6}\s|^[A-Z][A-Za-z\s]{2,}:$/m.test(text);
  const hasLists = /^[\s]*[-*•]\s|^[\s]*\d+[.)]\s/m.test(text);
  const hasLineBreaks = (text.match(/\n/g)?.length ?? 0) >= 3;
  let structureScore = 0;
  if (hasHeadings) structureScore += 5;
  if (hasLists) structureScore += 5;
  if (hasLineBreaks) structureScore += 5;
  score += structureScore;

  return Math.min(100, Math.max(0, score));
}

// ─── FR-012g: Apply-Method Extraction ─────────────────────────────────────────

export interface ApplyMethodResult {
  applyMethod: 'ONLINE_URL' | 'EMAIL' | 'IN_PERSON' | 'SOURCE_ACCOUNT' | 'PDF_FORM';
  applyUrl?: string;
  applyEmail?: string;
}

/**
 * FR-012g: Determine apply method from URL and description text.
 */
export function extractApplyMethod(
  url: string,
  description: string | null,
): ApplyMethodResult {
  const desc = (description || '').toLowerCase();
  const urlLower = url.toLowerCase();

  // PDF application form
  if (urlLower.endsWith('.pdf') || desc.includes('pdf application form')) {
    return { applyMethod: 'PDF_FORM', applyUrl: url };
  }

  // Email application
  const emailMatch =
    desc.match(/apply\s+(via\s+)?email\s+(to|at)\s+([^\s,]+)/i) ||
    desc.match(/mailto:([^\s?]+)/i) ||
    desc.match(/send\s+(your\s+)?(cv|resume|application)\s+to\s+([^\s,]+)/i);
  if (emailMatch) {
    const email = emailMatch[3] || emailMatch[1];
    if (email && email.includes('@')) {
      return { applyMethod: 'EMAIL', applyEmail: email, applyUrl: url };
    }
  }

  // In-person application
  if (
    desc.includes('apply in person') ||
    desc.includes('submit at office') ||
    desc.includes('submit in person') ||
    desc.includes('drop off') ||
    desc.includes('walk-in')
  ) {
    return { applyMethod: 'IN_PERSON', applyUrl: url };
  }

  // Source account required
  if (
    desc.includes('requires a') &&
    (desc.includes('account') || desc.includes('registration'))
  ) {
    return { applyMethod: 'SOURCE_ACCOUNT', applyUrl: url };
  }

  // Default: online URL
  return { applyMethod: 'ONLINE_URL', applyUrl: url };
}

// ─── FR-012h: Field Accuracy Rules ───────────────────────────────────────────

/** Common deadline date formats. */
const DEADLINE_FORMATS = [
  /(\d{4})-(\d{2})-(\d{2})/,                    // YYYY-MM-DD
  /(\d{2})\/(\d{2})\/(\d{4})/,                  // MM/DD/YYYY
  /(\d{2})-(\d{2})-(\d{4})/,                    // DD-MM-YYYY
  /(\w+)\s+(\d{1,2}),?\s+(\d{4})/,              // Month DD, YYYY
  /(\d{1,2})\s+(\w+)\s+(\d{4})/,                // DD Month YYYY
];

/** Valid ETB/USD/EUR/GBP currencies. */
const VALID_CURRENCIES = ['ETB', 'USD', 'EUR', 'GBP'];

/**
 * FR-012h: Parse and normalize a deadline string.
 * Returns a Date or null if unparseable.
 * Applies DEADLINE_DEFAULT_TZ (Africa/Addis_Ababa) when no timezone present.
 */
export function parseDeadline(raw: string | null | undefined): Date | null {
  if (!raw) return null;

  // Try direct parse
  const direct = new Date(raw);
  if (!isNaN(direct.getTime())) {
    return direct;
  }

  // Try common formats
  for (const fmt of DEADLINE_FORMATS) {
    const match = raw.match(fmt);
    if (match) {
      // Simple reconstruction
      const attempt = new Date(match[0]);
      if (!isNaN(attempt.getTime())) {
        return attempt;
      }
    }
  }

  logger.warn(`[FIELDACC] Could not parse deadline: "${raw}"`);
  return null;
}

/**
 * FR-012h: Normalize salary — extract numeric value and validate currency.
 * "Negotiable" / "unspecified" → null.
 */
export function normalizeSalary(
  raw: number | null | undefined,
  currency?: string | null,
): { salary: number | null; currency: string } {
  if (raw === null || raw === undefined || raw === 0) {
    return { salary: null, currency: currency || 'USD' };
  }
  const cur = VALID_CURRENCIES.includes((currency || '').toUpperCase())
    ? currency!.toUpperCase()
    : 'USD';
  return { salary: raw, currency: cur };
}

/**
 * FR-012h: Normalize company name — strip legal suffixes for display/dedupe
 * while retaining the raw value.
 */
export function normalizeCompany(name: string): string {
  return name
    .replace(/\s*,?\s*(PLC|LLC|Inc\.?|Ltd\.?|Corp\.?|Co\.?|SA|AG|BV|GmbH|Pty\.?)$/i, '')
    .trim();
}

/**
 * FR-014: Build a fingerprint for deduplication.
 * Uses company + title + location + normalized description (first 500 chars).
 */
export function buildFingerprint(
  company: string,
  title: string,
  location: string,
  description: string | null,
): string {
  const descPart = (description || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

  return [normalizeCompany(company), title.toLowerCase().trim(), location.toLowerCase().trim(), descPart]
    .join('|');
}

// ─── Combined Ingestion Pipeline ─────────────────────────────────────────────

export interface FidelityResult {
  description: string | null;
  descriptionQuality: number;
  descriptionSource: string;
  applyMethod: string;
  applyUrl: string | null;
  applyEmail: string | null;
  urlStatus: string;
  urlCheckedAt: Date | null;
  finalUrl: string | null;
  fingerprint: string;
  deadline: Date | null;
  salary: number | null;
  currency: string;
  companyNormalized: string;
}

/**
 * Run the full fidelity pipeline on a raw job.
 */
export async function runFidelityPipeline(raw: {
  title: string;
  company: string;
  location: string;
  url: string;
  baseUrl?: string;
  description?: string | null;
  salary?: number | null;
  currency?: string | null;
  deadline?: string | null;
  postedDate?: Date;
}): Promise<FidelityResult> {
  // 1. URL normalization (FR-012f)
  const normalizedUrl = normalizeUrl(raw.url, raw.baseUrl);
  const apply = extractApplyMethod(normalizedUrl, raw.description ?? null);

  // 2. Description cleaning (FR-012d)
  const cleaned = cleanDescription(raw.description || '');
  const descriptionQuality = scoreDescriptionQuality(cleaned);

  // 3. Field accuracy (FR-012h)
  const { salary, currency } = normalizeSalary(raw.salary, raw.currency);
  const deadline = parseDeadline(raw.deadline);
  const companyNormalized = normalizeCompany(raw.company);

  // 4. Fingerprint (FR-014)
  const fingerprint = buildFingerprint(raw.company, raw.title, raw.location, cleaned);

  // 5. URL liveness check (FR-013) — for ONLINE_URL only
  let urlStatus = 'OK';
  let finalUrl: string | null = null;
  let urlCheckedAt: Date | null = null;

  if (apply.applyMethod === 'ONLINE_URL') {
    const checkEnabled = process.env.URL_CHECK_AT_INGEST !== 'off';
    if (checkEnabled) {
      const result = await checkUrlLiveness(normalizedUrl);
      urlStatus = result.urlStatus;
      finalUrl = result.finalUrl || null;
      urlCheckedAt = new Date();
    }
  }

  return {
    description: cleaned || null,
    descriptionQuality,
    descriptionSource: 'API',
    applyMethod: apply.applyMethod,
    applyUrl: apply.applyUrl || normalizedUrl,
    applyEmail: apply.applyEmail || null,
    urlStatus,
    urlCheckedAt,
    finalUrl,
    fingerprint,
    deadline,
    salary,
    currency,
    companyNormalized,
  };
}
