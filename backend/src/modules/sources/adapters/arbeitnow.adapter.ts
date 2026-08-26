/* Arbeitnow adapter — free JSON API, no key (SRS §9.2, remote tier). */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, deriveExperience, mapEmployment, FETCH_TIMEOUT_MS } from './job-source.adapter';

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: string | number;
}

const API = 'https://www.arbeitnow.com/api/job-board-api';

@Injectable()
export class ArbeitnowAdapter implements JobSourceAdapter {
  readonly sourceId = 'arbeitnow';
  readonly selectorVersion = 'api:arbeitnow:v1.0';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since ?? new Date(Date.now() - 7 * 86_400_000);
    const jobs: RawJob[] = [];
    let url = `${API}?limit=20&page=1`;

    while (true) {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Arbeitnow responded ${res.status}`);
      const body = (await res.json()) as { data?: ArbeitnowJob[]; links?: { next?: string } };
      const pageJobs = (body.data ?? [])
        .map((j) => this.toRaw(j))
        .filter((j): j is RawJob => !!j && j.postedDate >= since);

      jobs.push(...pageJobs);

      const nextUrl = body.links?.next;
      if (!nextUrl || !pageJobs.length) break;
      url = nextUrl;
    }

    if (!jobs.length) throw new Error('Arbeitnow returned no parseable jobs');
    return jobs;
  }

  /** Parse Arbeitnow's created_at, which may be ISO string, Unix seconds, or Unix milliseconds. */
  private parseDate(raw: string | number): Date {
    if (typeof raw === 'number') {
      return new Date(raw < 1e12 ? raw * 1000 : raw);
    }
    const str = raw.trim();
    if (!str) return new Date(NaN);
    // ISO string like "2026-08-26T00:00:00.000Z"
    const iso = Date.parse(str);
    if (!Number.isNaN(iso)) return new Date(iso);
    // Numeric string — could be seconds or milliseconds
    const num = Number(str);
    if (!Number.isNaN(num)) return new Date(num < 1e12 ? num * 1000 : num);
    return new Date(NaN);
  }

  private toRaw(j: ArbeitnowJob): RawJob | null {
    if (!j.title || !j.url) return null;
    const posted = this.parseDate(j.created_at);
    if (Number.isNaN(posted.getTime())) return null;

    return {
      title: j.title,
      company: j.company_name || 'Arbeitnow',
      location: j.location ? `Remote (${j.location})` : 'Remote',
      locationClass: 'INTERNATIONAL_REMOTE',
      employmentType: mapEmployment(j.job_types?.[0]),
      experienceLevel: deriveExperience(j.title),
      workPlace: 'REMOTE',
      skills: (j.tags ?? []).slice(0, 8),
      url: j.url,
      sourceJobId: j.slug,
      postedDate: posted,
      description: j.description,
      country: 'Remote',
      parseConfidence: 80,
      rawData: { api: 'arbeitnow', slug: j.slug },
    };
  }
}
