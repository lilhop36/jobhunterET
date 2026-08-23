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
  created_at: string;
}

const API = 'https://www.arbeitnow.com/api/job-board-api';

@Injectable()
export class ArbeitnowAdapter implements JobSourceAdapter {
  readonly sourceId = 'arbeitnow';
  readonly selectorVersion = 'api:arbeitnow:v1.0';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since ?? new Date(Date.now() - 7 * 86_400_000);
    const res = await fetch(`${API}?limit=20`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Arbeitnow responded ${res.status}`);
    const body = (await res.json()) as { data?: ArbeitnowJob[] };
    const jobs = (body.data ?? []).filter((j) => {
      const posted = new Date(j.created_at);
      return !Number.isNaN(posted.getTime()) && posted >= since;
    });
    return jobs.map((j) => this.toRaw(j)).filter((j): j is RawJob => !!j);
  }

  private toRaw(j: ArbeitnowJob): RawJob | null {
    if (!j.title || !j.url) return null;
    const posted = new Date(j.created_at);
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
      postedDate: Number.isNaN(posted.getTime()) ? new Date() : posted,
      description: j.description,
      country: 'Remote',
      parseConfidence: 80,
      rawData: { api: 'arbeitnow', slug: j.slug },
    };
  }
}
