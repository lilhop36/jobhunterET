/* FR-008 — JobSourceAdapter interface. New sources plug in without touching the
 * core pipeline. Adapters only fetch raw postings; normalization, validation,
 * deduplication and ghost-detection reconciliation happen in SourcesService. */

export type LocationClass = 'ETHIOPIA_LOCAL' | 'ETHIOPIA_REMOTE' | 'INTERNATIONAL_REMOTE' | 'INTERNATIONAL_ONSITE' | 'INTERNATIONAL_HYBRID';
export type EmploymentType = 'FULL_TIME' | 'CONTRACT' | 'PART_TIME' | 'INTERNSHIP';
export type ExperienceLevel = 'INTERN' | 'ENTRY' | 'MID' | 'SENIOR' | 'LEAD';
export type Workplace = 'ONSITE' | 'REMOTE' | 'HYBRID';

export interface RawJob {
  title: string;
  company: string;
  location: string;
  locationClass: LocationClass;
  employmentType: EmploymentType;
  experienceLevel: ExperienceLevel;
  workPlace: Workplace;
  salary?: number;
  currency?: string;
  skills: string[];
  url: string;
  sourceJobId: string;
  postedDate: Date;
  deadline?: Date;
  description?: string;
  country?: string;
  parseConfidence?: number;
  rawData?: unknown;
  /** Raw category labels/ids as the source expressed them. */
  sourceCategories?: string[];
  /** Which sweep surfaced this job: 'latest' or a source category id. */
  discoveredVia?: string;
}

export type CollectionMode = 'FAST' | 'DEEP';

export interface CollectionRequest {
  mode: CollectionMode;
  /** Freshness boundary — pagination stops once postings are older than this. */
  since: Date;
  /** Source category ids/slugs to sweep (already validated against the source). */
  categories?: string[];
  /** Hard ceilings so a source can never be hammered. */
  maxPages?: number;
  maxRequests?: number;
  requestDelayMs?: number;
  /** Lets an adapter skip detail-page fetches for jobs already stored. */
  knownSourceJobIds?: ReadonlySet<string>;
}

export type StopReason =
  | 'FRESHNESS_BOUNDARY' | 'LAST_PAGE' | 'EMPTY_PAGE'
  | 'MAX_PAGES' | 'REQUEST_BUDGET' | 'ERROR';

export interface CategoryCollectionStat {
  /** 'latest' for the main feed, otherwise the source's own category id/slug. */
  category: string;
  categoryLabel?: string;
  pagesFetched: number;
  jobsFetched: number;
  errors: number;
  stoppedReason: StopReason;
}

export interface CollectionResult {
  jobs: RawJob[];
  pagesFetched: number;
  requestsMade: number;
  categories: CategoryCollectionStat[];
  errors: string[];
}

export interface JobSourceAdapter {
  readonly sourceId: string;
  /**
   * Selector/struct version — increment when the upstream page structure
   * changes so tests can detect regressions (FR-008, selector drift).
   * Adapters that use a stable JSON API may omit this.
   */
  readonly selectorVersion?: string;
  /** Fetch raw postings. `since` may be used to limit to recent postings. */
  fetchJobs(options?: { since?: Date }): Promise<RawJob[]>;
  /** Optional capability. When present, SourcesService prefers it. */
  collect?(request: CollectionRequest): Promise<CollectionResult>;
}

/** SEC-007: hard cap on every upstream fetch — a hung source can't stall the scheduler. */
export const FETCH_TIMEOUT_MS = 30_000;

/** Derive an experience level from a job title when the source doesn't provide one. */
export function deriveExperience(title: string): ExperienceLevel {
  const t = title.toLowerCase();
  if (/\b(intern|graduate|trainee|apprentice)\b/.test(t)) return 'INTERN';
  if (/\b(junior|entry|associate|i)\b/.test(t) && !/\b(senior|lead)\b/.test(t)) return 'ENTRY';
  if (/\b(principal|head|director|vp|chief|staff)\b/.test(t)) return 'LEAD';
  if (/\b(senior|lead|sr)\b/.test(t)) return 'SENIOR';
  return 'MID';
}

/** Map a source-provided employment-type string onto the EmploymentType enum. */
export function mapEmployment(raw: string | null | undefined): EmploymentType {
  const t = (raw || '').toLowerCase();
  if (t.includes('part')) return 'PART_TIME';
  if (t.includes('contract') || t.includes('freelance')) return 'CONTRACT';
  if (t.includes('intern')) return 'INTERNSHIP';
  return 'FULL_TIME';
}

/** Clean HTML by removing scripts/styles/nav/footer but preserving structural tags. */
export function cleanHtml(html: string): string {
  return (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    // We intentionally PRESERVE <p>, <br>, <li>, <tr>, etc. so the frontend RichDescription can render them properly
    .replace(/\s+/g, ' ')
    .trim();
}

/** Average two numeric salary bounds into a single figure. */
export function parseNumericSalary(min: number | null, max: number | null): number | undefined {
  if (min && max) return Math.round((min + max) / 2);
  if (min) return min;
  if (max) return max;
  return undefined;
}
