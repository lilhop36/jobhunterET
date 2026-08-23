/* Ethiojobs adapter — scraped from the server-rendered Next.js page (SRS §9.2, ETHIOPIA tier).
 *
 * The old client-side API (/ethiojobs/api/job-board/jobs) returns 404.
 * Instead, we fetch the /jobs page and extract the __NEXT_DATA__ JSON payload,
 * which contains the full job list with company info, location, description, etc.
 * Paginated: 12 jobs per page, up to 90+ pages (1,000+ jobs total). */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, deriveExperience, mapEmployment, FETCH_TIMEOUT_MS } from './job-source.adapter';

interface EjCompany {
  name: string;
  slug: string;
}

interface EjCatalog {
  name: string;
}

interface EjJob {
  id: string;
  title: string;
  slug: string;
  type: number;
  date_published: string;
  level: string;
  location_type: string;
  description: string;
  state: string;
  catalogs: EjCatalog[];
  date_expiry: string | null;
  company: EjCompany;
  application_method: string;
  application_email: string | null;
}

interface EjPageProps {
  jobs: {
    data: EjJob[];
    meta: { pageNumber: number; lastPage: number; total: number };
  };
}

const BASE = 'https://ethiojobs.net';
const MAX_PAGES = 5; // polite bounded crawl — up to 60 jobs per run

@Injectable()
export class EthiojobsAdapter implements JobSourceAdapter {
  readonly sourceId = 'ethiojobs';
  readonly selectorVersion = 'html:__NEXT_DATA__:v1.0';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since ?? new Date(Date.now() - 30 * 86_400_000);
    const jobs: RawJob[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const pageJobs = await this.fetchPage(page, since);
        if (!pageJobs.length) break;
        jobs.push(...pageJobs);
      } catch (err: any) {
        // If a page fails, stop crawling but don't throw — we got some data
        break;
      }
    }

    if (!jobs.length) throw new Error('Ethiojobs returned no parseable jobs from __NEXT_DATA__');
    return jobs;
  }

  private async fetchPage(page: number, since: Date): Promise<RawJob[]> {
    const url = page === 1 ? `${BASE}/jobs` : `${BASE}/jobs?page=${page}`;
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        accept: 'text/html',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Ethiojobs page ${page} responded ${res.status}`);

    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) {
      throw new Error(
        'Ethiojobs: __NEXT_DATA__ not found in HTML — selectorVersion html:__NEXT_DATA__:v1.0 may be stale. '
        + 'Check if ethiojobs.net migrated away from Next.js or changed their page structure. '
        + 'Update selectorVersion and the extraction regex in EthiojobsAdapter.',
      );
    }

    let props: EjPageProps;
    try {
      props = JSON.parse(match[1]).props?.pageProps;
    } catch {
      throw new Error(
        'Ethiojobs: failed to parse __NEXT_DATA__ JSON — the script tag exists but contains invalid JSON. '
        + 'Possible injection or encoding change on the upstream page.',
      );
    }

    const data = props?.jobs?.data;
    if (!data?.length) return [];

    return data
      .filter((j) => {
        const posted = new Date(j.date_published);
        return !Number.isNaN(posted.getTime()) && posted >= since;
      })
      .map((j) => this.toRaw(j))
      .filter((j): j is RawJob => !!j);
  }

  private toRaw(j: EjJob): RawJob | null {
    if (!j.title || !j.slug) return null;

    const location = j.state || 'Ethiopia';
    const isRemote = /remote/i.test(j.location_type || '') || /remote/i.test(location);
    const url = `${BASE}/jobs/${j.slug}`;

    return {
      title: j.title,
      company: j.company?.name || 'Ethiojobs',
      location,
      locationClass: isRemote ? 'ETHIOPIA_REMOTE' : 'ETHIOPIA_LOCAL',
      employmentType: mapEmployment(this.mapJobType(j.type)),
      experienceLevel: deriveExperience(j.title),
      workPlace: isRemote ? 'REMOTE' : 'ONSITE',
      skills: (j.catalogs ?? []).map((c) => c.name).slice(0, 8),
      url,
      sourceJobId: j.slug,
      postedDate: new Date(j.date_published),
      deadline: j.date_expiry ? new Date(j.date_expiry) : undefined,
      description: j.description || '',
      country: 'Ethiopia',
      parseConfidence: 75,
      rawData: { api: 'ethiojobs-nextdata', id: j.id, slug: j.slug },
    };
  }

  /** Map Ethiojobs numeric type to employment type string. */
  private mapJobType(type: number): string | null {
    // Type mapping from Ethiojobs (common values):
    // 1=Full Time, 2=Part Time, 3=Contract, 4=Internship, 5=Temporary, 8=unknown (default full-time)
    switch (type) {
      case 1: return 'Full Time';
      case 2: return 'Part Time';
      case 3: return 'Contract';
      case 4: return 'Internship';
      default: return 'Full Time';
    }
  }
}
