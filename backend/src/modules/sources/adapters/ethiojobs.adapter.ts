/* Ethiojobs adapter — their public job-board API (SRS §9.2, ETHIOPIA tier).
 *
 * Ethiojobs is a Next.js app whose job data comes from a client-side API
 * (`/ethiojobs/api/job-board/jobs`). We call that endpoint the same way the
 * site does. When it is unreachable or the shape is unrecognized we throw a
 * descriptive error, which FR-036 records as a source ERROR with lastError —
 * the health dashboard then reflects the real integration state. */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, deriveExperience, mapEmployment, FETCH_TIMEOUT_MS } from './job-source.adapter';

interface EjJob {
  id?: string | number;
  title?: string;
  companyName?: string;
  location?: string;
  url?: string;
  postedDate?: string;
  employmentType?: string;
  skills?: string[];
}

const API = 'https://ethiojobs.net/ethiojobs/api/job-board/jobs';

@Injectable()
export class EthiojobsAdapter implements JobSourceAdapter {
  readonly sourceId = 'ethiojobs';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since ?? new Date(Date.now() - 30 * 86_400_000);
    const res = await fetch(`${API}?page=1&pageSize=20`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        referer: 'https://ethiojobs.net/',
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Ethiojobs API responded ${res.status} (client-side data endpoint is not public)`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new Error('Ethiojobs API returned a non-JSON response');
    }

    const jobs = (body as { data?: EjJob[]; jobs?: EjJob[] })?.data ?? (body as { jobs?: EjJob[] })?.jobs ?? [];
    const rows = jobs
      .filter((j) => {
        const posted = j.postedDate ? new Date(j.postedDate) : null;
        return !posted || (Number.isNaN(posted.getTime()) ? true : posted >= since);
      })
      .map((j) => this.toRaw(j))
      .filter((j): j is RawJob => !!j);
    if (!rows.length) throw new Error('Ethiojobs API returned no parseable jobs');
    return rows;
  }

  private toRaw(j: EjJob): RawJob | null {
    if (!j.title || !j.url) return null;
    const location = j.location || 'Ethiopia';
    return {
      title: j.title,
      company: j.companyName || 'Ethiojobs',
      location,
      locationClass: /remote/i.test(location) ? 'ETHIOPIA_REMOTE' : 'ETHIOPIA_LOCAL',
      employmentType: mapEmployment(j.employmentType),
      experienceLevel: deriveExperience(j.title),
      workPlace: /remote/i.test(location) ? 'REMOTE' : 'ONSITE',
      skills: j.skills ?? [],
      url: j.url,
      sourceJobId: String(j.id ?? j.url),
      postedDate: j.postedDate ? new Date(j.postedDate) : new Date(),
      country: 'Ethiopia',
      parseConfidence: 75,
      rawData: { api: 'ethiojobs-job-board', id: j.id },
    };
  }
}
