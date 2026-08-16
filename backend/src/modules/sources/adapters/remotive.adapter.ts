/* Remotive adapter — free JSON API, no key (SRS §9.2, remote tier). */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, deriveExperience, mapEmployment, FETCH_TIMEOUT_MS } from './job-source.adapter';

interface RemotiveJob {
  id: number;
  title: string;
  company_name: string;
  candidate_required_location: string;
  url: string;
  publication_date: string;
  job_type: string;
  salary: string;
  tags: string[];
  description?: string;
}

const API = 'https://remotive.com/api/remote-jobs';

@Injectable()
export class RemotiveAdapter implements JobSourceAdapter {
  readonly sourceId = 'remotive';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since ?? new Date(Date.now() - 7 * 86_400_000);
    const url = `${API}?limit=100`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Remotive responded ${res.status}`);
    const body = (await res.json()) as { jobs?: RemotiveJob[] };
    const jobs = (body.jobs ?? []).filter((j) => {
      const posted = new Date(j.publication_date);
      return !Number.isNaN(posted.getTime()) && posted >= since;
    });
    return jobs.map((j) => this.toRaw(j)).filter((j): j is RawJob => !!j);
  }

  private toRaw(j: RemotiveJob): RawJob | null {
    if (!j.title || !j.url) return null;
    const posted = new Date(j.publication_date);
    const location = j.candidate_required_location || 'Remote';
    const salary = this.parseSalary(j.salary);

    return {
      title: j.title,
      company: j.company_name || 'Remotive',
      location: location === 'Worldwide' || location === 'Anywhere' ? 'Remote' : `Remote (${location})`,
      locationClass: 'INTERNATIONAL_REMOTE',
      employmentType: mapEmployment(j.job_type),
      experienceLevel: deriveExperience(j.title),
      workPlace: 'REMOTE',
      salary,
      currency: 'USD',
      skills: (j.tags ?? []).slice(0, 8),
      url: j.url,
      sourceJobId: String(j.id),
      postedDate: Number.isNaN(posted.getTime()) ? new Date() : posted,
      description: j.description,
      country: 'Remote',
      parseConfidence: 80,
      rawData: j,
    };
  }

  /** "50k - 70k/yr" → 60000. Best-effort; unknown → undefined. */
  private parseSalary(s: string): number | undefined {
    if (!s) return undefined;
    const nums = (s.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    if (!nums.length) return undefined;
    const mid = (Math.min(...nums) + Math.max(...nums)) / 2;
    return s.toLowerCase().includes('k') ? Math.round(mid * 1000) : Math.round(mid);
  }
}
