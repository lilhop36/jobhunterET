/* Jobicy adapter — free JSON API for remote jobs, no key required.
 *
 * Jobicy returns curated remote job listings with structured metadata:
 * jobTitle, companyName, jobGeo, jobLevel, jobType, jobExcerpt, tags, url.
 * Relevant for the REMOTE and INTERNATIONAL tiers. */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, deriveExperience, mapEmployment, FETCH_TIMEOUT_MS } from './job-source.adapter';

interface JobicyJob {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  jobIndustry: string[];
  jobType: string[];
  jobGeo: string;
  jobLevel: string;
  jobExcerpt: string;
  annualSalaryMin: number | null;
  annualSalaryMax: number | null;
  salaryCurrency: string | null;
  pubDate: string;
}

const API = 'https://jobicy.com/api/v2/remote-jobs';

@Injectable()
export class JobicyAdapter implements JobSourceAdapter {
  readonly sourceId = 'jobicy';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since ?? new Date(Date.now() - 14 * 86_400_000);
    // Fetch multiple pages to get a decent pool (max 50 per request)
    // Jobicy API only supports count — no pagination params
    const res = await fetch(`${API}?count=50`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Jobicy responded ${res.status}`);
    const body = (await res.json()) as { jobs?: JobicyJob[] };
    const jobs = (body.jobs ?? [])
      .filter((j) => {
        const posted = new Date(j.pubDate);
        return !Number.isNaN(posted.getTime()) && posted >= since;
      })
      .map((j) => this.toRaw(j))
      .filter((j): j is RawJob => !!j);
    if (!jobs.length) throw new Error('Jobicy returned no parseable jobs');
    return jobs;
  }

  private toRaw(j: JobicyJob): RawJob | null {
    if (!j.jobTitle || !j.url) return null;

    const salary = this.parseSalary(j.annualSalaryMin, j.annualSalaryMax);
    const tags = (j.jobIndustry ?? []).map(t => t.replace(/&amp;/g, '&').trim());

    return {
      title: j.jobTitle,
      company: j.companyName || 'Jobicy',
      location: j.jobGeo || 'Remote',
      locationClass: 'INTERNATIONAL_REMOTE',
      employmentType: mapEmployment(j.jobType?.[0]),
      experienceLevel: deriveExperience(j.jobTitle),
      workPlace: 'REMOTE',
      salary,
      currency: j.salaryCurrency || 'USD',
      skills: tags.slice(0, 8),
      url: j.url,
      sourceJobId: String(j.id),
      postedDate: new Date(j.pubDate),
      description: j.jobExcerpt || '',
      country: 'Remote',
      parseConfidence: 80,
      rawData: j,
    };
  }

  private parseSalary(min: number | null, max: number | null): number | undefined {
    if (min && max) return Math.round((min + max) / 2);
    if (min) return min;
    if (max) return max;
    return undefined;
  }
}
