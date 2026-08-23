/* RemoteOK adapter — free JSON API for remote jobs, no key required.
 *
 * RemoteOK returns a flat JSON array (first element is metadata, skip it).
 * Jobs have: company, position, tags, description, date, url, salary_min/max.
 * Strong source for international remote tech roles. */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, deriveExperience, mapEmployment, parseNumericSalary, FETCH_TIMEOUT_MS } from './job-source.adapter';

interface RemoteOKJob {
  id: string | number;
  slug: string;
  company: string;
  company_logo: string;
  position: string;
  tags: string[];
  description: string;
  date: string;
  url: string;
  salary_min: number | null;
  salary_max: number | null;
  remote: boolean;
}

@Injectable()
export class RemoteOKAdapter implements JobSourceAdapter {
  readonly sourceId = 'remoteok';
  readonly selectorVersion = 'api:remoteok:v1.0';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since ?? new Date(Date.now() - 14 * 86_400_000);
    const res = await fetch('https://remoteok.com/api', {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'JobHunter/1.0' },
    });
    if (!res.ok) throw new Error(`RemoteOK responded ${res.status}`);

    const raw = (await res.json()) as any[];
    // First element is metadata — skip it
    const jobs = raw.filter((j: any) => j && j.id && j.position);

    return jobs
      .filter((j: RemoteOKJob) => {
        const posted = new Date(j.date);
        return !Number.isNaN(posted.getTime()) && posted >= since;
      })
      .map((j) => this.toRaw(j))
      .filter((j): j is RawJob => !!j);
  }

  private toRaw(j: RemoteOKJob): RawJob | null {
    if (!j.position || !j.url) return null;

    const salary = parseNumericSalary(j.salary_min, j.salary_max);
    const tags = (j.tags ?? []).slice(0, 8);

    return {
      title: j.position,
      company: j.company || 'RemoteOK',
      location: 'Remote',
      locationClass: 'INTERNATIONAL_REMOTE',
      employmentType: mapEmployment(null), // RemoteOK doesn't specify; default FULL_TIME
      experienceLevel: deriveExperience(j.position),
      workPlace: 'REMOTE',
      salary,
      currency: 'USD',
      skills: tags,
      url: j.url,
      sourceJobId: String(j.id),
      postedDate: new Date(j.date),
      description: j.description,
      country: 'Remote',
      parseConfidence: 75,
      rawData: { api: 'remoteok', id: j.id, slug: j.slug },
    };
  }


}
