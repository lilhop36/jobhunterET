/**
 * Ethiopia-only eligibility policy.
 *
 * JobPilot ET only recommends vacancies that a candidate residing in Ethiopia
 * can actually take. This module is the single source of truth for that rule:
 * every ingestion path (scheduled, manual, fallback, Telegram) calls it before
 * a job is stored, and every recommendation path filters on the stored status.
 *
 * Decisions:
 *   ELIGIBLE — verifiably in Ethiopia, or remote and explicitly open to Ethiopia
 *   REVIEW   — location or remote eligibility cannot be established
 *   REJECTED — explicitly outside Ethiopia, or remote restricted to another country
 *
 * This is deliberately deterministic and dependency-free so adapter tests,
 * ingestion and backfill all share the same behaviour.
 */

export type EligibilityStatus = 'ELIGIBLE' | 'REVIEW' | 'REJECTED';

export interface EligibilityInput {
  title?: string | null;
  location?: string | null;
  country?: string | null;
  description?: string | null;
  workPlace?: string | null;
  locationClass?: string | null;
}

export interface EligibilityDecision {
  status: EligibilityStatus;
  reason: string;
}

const ETHIOPIA_PLACES = [
  'ethiopia', 'ethiopian',
  // cities
  'addis ababa', 'addis', 'mekelle', 'mekele', 'adama', 'nazret', 'bahir dar',
  'hawassa', 'awassa', 'hawari', 'dire dawa', 'jimma', 'jima', 'gondar', 'gonder',
  'dessie', 'dese', 'debre markos', 'debre birhan', 'harar', 'harer', 'arba minch',
  'bishoftu', 'debre zeit', 'shashemene', 'shashamane', 'assosa', 'gambela',
  'semera', 'axum', 'aksum', 'lalibela', 'woldiya', 'kombolcha', 'ambo',
  'adigrat', 'asella', 'dilla', 'hosaena', 'hoseana', 'mizan teferi', 'nekemte',
  'nekempte', 'welkite', 'butajira', 'jijiga', 'sodo', 'wolaita',
  // towns that appear by name on Ethiopian job boards (ElelanaJobs, EthioJobs)
  'delomena', 'yebbu', 'ginir', 'woliso', 'mettu', 'dembi dollo', 'kellem wollega',
  'kellam wollega', 'sheger', 'shegger', 'holeta', 'sebeta', 'burayu', 'negele',
  'goba', 'teppi', 'shire', 'adwa',
  // regions / administrations
  'oromia', 'amhara', 'tigray', 'sidama', 'afar', 'somali region', 'benishangul',
  'south west ethiopia', 'central ethiopia', 'harari', 'snnpr',
];

/**
 * Countries and cities that are explicitly NOT Ethiopia. Used only as negative
 * evidence: a job is rejected when its location names one of these. Keep this
 * as a conservative list — a place that is missing falls through to REVIEW,
 * never to ELIGIBLE.
 */
const FOREIGN_PLACES = [
  // Africa
  'kenya', 'nairobi', 'uganda', 'kampala', 'tanzania', 'dar es salaam', 'rwanda',
  'kigali', 'burundi', 'bujumbura', 'south sudan', 'juba', 'sudan', 'khartoum',
  'djibouti', 'somalia', 'mogadishu', 'eritrea', 'asmara', 'egypt', 'cairo',
  'libya', 'tripoli', 'tunisia', 'tunis', 'morocco', 'rabat', 'algeria', 'algiers',
  'nigeria', 'lagos', 'abuja', 'ghana', 'accra', 'ivory coast', 'senegal', 'dakar',
  'cameroon', 'yaounde', 'south africa', 'johannesburg', 'cape town', 'zimbabwe',
  'harare', 'zambia', 'lusaka', 'botswana', 'gaborone', 'namibia', 'windhoek',
  'mozambique', 'maputo', 'madagascar', 'mauritius',
  // Middle East
  'uae', 'united arab emirates', 'dubai', 'abu dhabi', 'saudi arabia', 'riyadh',
  'jeddah', 'qatar', 'doha', 'kuwait', 'bahrain', 'manama', 'oman', 'muscat',
  'jordan', 'amman', 'lebanon', 'beirut', 'israel', 'tel aviv', 'turkey',
  'istanbul', 'ankara', 'iran', 'tehran', 'iraq', 'baghdad',
  // Asia
  'india', 'bangalore', 'bengaluru', 'hyderabad', 'pakistan', 'karachi',
  'bangladesh', 'dhaka', 'sri lanka', 'colombo', 'nepal', 'kathmandu', 'china',
  'beijing', 'shanghai', 'japan', 'tokyo', 'south korea', 'seoul', 'singapore',
  'malaysia', 'kuala lumpur', 'indonesia', 'jakarta', 'philippines', 'manila',
  'vietnam', 'thailand', 'bangkok',
  // Oceania / Americas / Europe
  'australia', 'sydney', 'melbourne', 'new zealand', 'auckland',
  'usa', 'united states', 'u.s.', 'america', 'new york', 'san francisco',
  'seattle', 'austin', 'boston', 'washington', 'chicago', 'los angeles',
  'canada', 'toronto', 'vancouver', 'montreal', 'uk', 'united kingdom', 'london',
  'manchester', 'ireland', 'dublin', 'germany', 'berlin', 'munich', 'france',
  'paris', 'netherlands', 'amsterdam', 'belgium', 'brussels', 'spain', 'madrid',
  'barcelona', 'portugal', 'lisbon', 'italy', 'rome', 'milan', 'switzerland',
  'zurich', 'sweden', 'stockholm', 'norway', 'oslo', 'denmark', 'copenhagen',
  'finland', 'helsinki', 'poland', 'warsaw', 'czech', 'prague', 'austria',
  'vienna', 'greece', 'athens', 'romania', 'bucharest', 'ukraine', 'kyiv',
  'russia', 'moscow',
];

/** Phrases that explicitly open a remote role to candidates in Ethiopia. */
const ETHIOPIA_REMOTE_GRANTS = [
  /\bopen to\b[^.]{0,60}\bethiopia/i,
  /\bethiopia(?:n)?\s+(?:residents?|nationals?|candidates?|applicants?|citizens?|professionals?)\b/i,
  /\b(?:residents?|nationals?|candidates?|applicants?|citizens?)\s+(?:of|in)\s+ethiopia\b/i,
  /\bbased\s+in\s+ethiopia\b/i,
  /\b(?:work|live|reside|located)\w*\s+(?:in|from)\s+ethiopia\b/i,
  /\beligible\s+to\s+work\s+in\s+ethiopia\b/i,
  /\bethiopia\s+only\b/i,
  /\bfrom\s+ethiopia\b/i,
];

/** Phrases that restrict a remote role to somewhere other than Ethiopia. */
const FOREIGN_REMOTE_RESTRICTIONS: RegExp[] = [
  /\b(?:must|should|required\s+to)\s+(?:be\s+)?(?:based|reside|live|located|working)\s+in\s+([^.,;)]+)/i,
  /\b(?:only|exclusively)\s+(?:open\s+to\s+)?(?:candidates?|applicants?|residents?)\s+(?:based\s+)?in\s+([^.,;)]+)/i,
  /\b(?:authori[sz]ed|eligible)\s+to\s+work\s+in\s+([^.,;)]+)/i,
  /\b(?:residents?|citizens?)\s+of\s+([^.,;)]+)\s+only\b/i,
];

const REMOTE_SIGNALS = /\bremote\b|\bwork\s+from\s+home\b|\bwfh\b|\btelecommut\w*/i;

/** ISO-3166 and common spellings of Ethiopia in the `country` field. */
const ETHIOPIA_COUNTRY_CODES = /^(et|eth|ethiopia)$/;

function normalize(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True when the text names Ethiopia or an Ethiopian place. */
export function isEthiopianLocation(text: string | null | undefined): boolean {
  const t = normalize(text);
  return !!t && ETHIOPIA_PLACES.some((place) => t.includes(place));
}

/** First foreign place named in the text, or null. */
export function findForeignPlace(text: string | null | undefined): string | null {
  const t = normalize(text);
  if (!t) return null;
  return FOREIGN_PLACES.find((place) => t.includes(place)) ?? null;
}

/** Best-effort human-readable place name from free text (used for diagnostics/tests). */
export function detectPlace(text: string | null | undefined): string | null {
  const t = normalize(text);
  if (!t) return null;
  const foreign = findForeignPlace(t);
  if (foreign) return foreign;
  return ETHIOPIA_PLACES.find((place) => t.includes(place)) ?? null;
}

/** Location class for a free-text place, used to avoid advertising a foreign job as local. */
export function classifyLocationText(text: string | null | undefined): string {
  if (isEthiopianLocation(text)) return REMOTE_SIGNALS.test(normalize(text)) ? 'ETHIOPIA_REMOTE' : 'ETHIOPIA_LOCAL';
  if (findForeignPlace(text)) return 'INTERNATIONAL_ONSITE';
  return 'UNKNOWN';
}

function grantToEthiopia(text: string): boolean {
  return ETHIOPIA_REMOTE_GRANTS.some((rx) => rx.test(text));
}

function foreignRestriction(text: string): string | null {
  for (const rx of FOREIGN_REMOTE_RESTRICTIONS) {
    const match = text.match(rx);
    if (match) {
      const target = (match[1] ?? match[0]).trim();
      if (!isEthiopianLocation(target)) return target;
    }
  }
  return null;
}

/**
 * Decide whether a job may enter the Ethiopian feed.
 *
 * Positive Ethiopian evidence must come from the location/country fields, not
 * from prose: a job description that merely mentions Ethiopia does not mean
 * the job is located there. The description is used only to confirm or deny
 * remote eligibility.
 */
export function evaluateEthiopiaEligibility(input: EligibilityInput): EligibilityDecision {
  const location = normalize(input.location);
  const country = normalize(input.country);
  const evidence = [location, country].filter(Boolean).join(' ');
  const description = normalize(input.description);
  const remote =
    normalize(input.workPlace) === 'remote' ||
    normalize(input.locationClass).includes('remote') ||
    REMOTE_SIGNALS.test(location);

  const etInLocation =
    isEthiopianLocation(evidence) || ETHIOPIA_COUNTRY_CODES.test(country);
  const foreignInLocation = findForeignPlace(evidence);
  const grant = grantToEthiopia(`${evidence} ${description}`);

  if (etInLocation && !foreignInLocation) {
    return { status: 'ELIGIBLE', reason: 'Job location is in Ethiopia' };
  }

  if (foreignInLocation) {
    if (remote && grant) {
      return { status: 'ELIGIBLE', reason: `Remote role explicitly open to Ethiopia (foreign base: ${foreignInLocation})` };
    }
    return { status: 'REJECTED', reason: `Job is outside Ethiopia (${(input.location ?? '').trim() || foreignInLocation})` };
  }

  if (remote) {
    if (grant) return { status: 'ELIGIBLE', reason: 'Remote role explicitly open to Ethiopia' };
    const restrictedTo = foreignRestriction(`${evidence} ${description}`);
    if (restrictedTo) {
      return { status: 'REJECTED', reason: `Remote role restricted to ${restrictedTo}` };
    }
    return { status: 'REVIEW', reason: 'Remote role does not confirm eligibility for Ethiopia' };
  }

  if (!evidence) {
    return { status: 'REVIEW', reason: 'Job location is not established' };
  }

  return { status: 'REVIEW', reason: `Location is not recognised as Ethiopian (${location || country})` };
}
