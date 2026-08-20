/* FR-008 — JobSourceAdapter interface. New sources plug in without touching the
 * core pipeline. Adapters only fetch raw postings; normalization, validation,
 * deduplication and ghost-detection reconciliation happen in SourcesService. */

import { LocationClass, EmploymentType, ExperienceLevel, Workplace } from '.prisma/client';

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
}

export interface JobSourceAdapter {
  readonly sourceId: string;
  /** Fetch raw postings. `since` may be used to limit to recent postings. */
  fetchJobs(options?: { since?: Date }): Promise<RawJob[]>;
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

/** Clean HTML by removing scripts/styles but preserving structure. */
export function stripHtml(html: string): string {
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
