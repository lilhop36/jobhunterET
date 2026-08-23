/* LandingJobs adapter — free JSON API for tech jobs, no key required.
 *
 * LandingJobs focuses on European and global tech positions.
 * API returns: id, title, currency_code, salary_min/max, requirements, etc.
 * Relevant for the INTERNATIONAL tier — good for Ethiopian devs targeting EU remote. */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, deriveExperience, mapEmployment, cleanHtml, parseNumericSalary, FETCH_TIMEOUT_MS } from './job-source.adapter';

interface LJJob {
  id: number;
  title: string;
  employment_type: string;
  remote: boolean;
  city: string;
  country: string;
  currency_code: string;
  gross_salary_low: number | null;
  gross_salary_high: number | null;
  main_requirements: string;
  nice_to_have: string;
  url: string;
  tags: string[];
  created_at: string;
  published_at: string;
  expires_at: string;
}

const API = 'https://www.landing.jobs/api/v1/jobs';

@Injectable()
export class LandingJobsAdapter implements JobSourceAdapter {
  readonly sourceId = 'landingjobs';
  readonly selectorVersion = 'api:landingjobs:v1.0';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since ?? new Date(Date.now() - 14 * 86_400_000);
    const jobs: RawJob[] = [];

    // Fetch multiple pages (API supports offset-based pagination)
    for (let page = 1; page <= 3; page++) {
      const url = `${API}?limit=50&page=${page}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`LandingJobs responded ${res.status}`);
      const body = (await res.json()) as LJJob[];
      if (!body.length) break;

      for (const j of body) {
        // Use published_at (more recent) rather than created_at (can be months old)
        const posted = new Date(j.published_at || j.created_at);
        if (!Number.isNaN(posted.getTime()) && posted >= since) {
          const raw = this.toRaw(j);
          if (raw) jobs.push(raw);
        }
      }
    }
    if (!jobs.length) throw new Error('LandingJobs returned no parseable jobs');
    return jobs;
  }

  private toRaw(j: LJJob): RawJob | null {
    if (!j.title || !j.url) return null;

    const location = j.city && j.country
      ? `${j.city}, ${j.country}`
      : j.country || 'Remote';

    const salary = parseNumericSalary(j.gross_salary_low, j.gross_salary_high);

    return {
      title: j.title,
      company: 'LandingJobs',
      location,
      locationClass: j.remote ? 'INTERNATIONAL_REMOTE' : 'INTERNATIONAL_ONSITE',
      employmentType: mapEmployment(j.employment_type),
      experienceLevel: deriveExperience(j.title),
      workPlace: j.remote ? 'REMOTE' : 'ONSITE',
      salary,
      currency: j.currency_code || 'EUR',
      skills: [...new Set([...this.extractSkills(j.main_requirements), ...(j.tags ?? [])])].slice(0, 8),
      url: j.url,
      sourceJobId: String(j.id),
      postedDate: new Date(j.published_at || j.created_at),
      deadline: j.expires_at ? new Date(j.expires_at) : undefined,
      description: `${j.main_requirements || ''}\n\n${j.nice_to_have ? `<p><strong>Nice to have:</strong></p>\n${j.nice_to_have}` : ''}`,
      country: j.country || 'Europe',
      parseConfidence: 75,
      rawData: { api: 'landingjobs', id: j.id },
    };
  }

  private extractSkills(html: string): string[] {
    const text = cleanHtml(html);
    // Look for common tech skills mentioned in requirements
    const skillPatterns = [
      'Java', 'Python', 'JavaScript', 'TypeScript', 'React', 'Angular', 'Vue',
      'Node.js', 'NestJS', 'Express', 'Django', 'Flask', 'Spring', 'Spring Boot',
      'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQL',
      'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'CI/CD',
      'GraphQL', 'REST', 'Git', 'Linux', 'Microservices',
    ];
    const found: string[] = [];
    for (const s of skillPatterns) {
      if (text.toLowerCase().includes(s.toLowerCase())) found.push(s);
    }
    return found.slice(0, 8);
  }

}
