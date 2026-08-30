/* Ethiojobs adapter — scraped from the server-rendered Next.js page (SRS §9.2, ETHIOPIA tier).
 *
 * The old client-side API (/ethiojobs/api/job-board/jobs) returns 404.
 * Instead, we fetch the /jobs page and extract the __NEXT_DATA__ JSON payload,
 * which contains the full job list with company info, location, description, etc.
 * Paginated: 12 jobs per page, up to 79+ pages (947+ jobs total). */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, CollectionRequest, CollectionResult, StopReason, CategoryCollectionStat, deriveExperience, mapEmployment, FETCH_TIMEOUT_MS } from './job-source.adapter';

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

interface EjPagePropsJobs {
  jobs: { data: EjJob[]; meta: { pageNumber: number; lastPage: number; total: number } };
}

interface EjPagePropsCategory {
  initialData: EjJob[];
  meta: { slugName: string; [key: string]: any };
}

type EjPageProps = EjPagePropsJobs | EjPagePropsCategory;

const BASE = 'https://ethiojobs.net';

@Injectable()
export class EthiojobsAdapter implements JobSourceAdapter {
  readonly sourceId = 'ethiojobs';
  readonly selectorVersion = 'html:__NEXT_DATA__:v2.0';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since ?? new Date(Date.now() - 30 * 86_400_000);
    const result = await this.collect({
      mode: 'FAST',
      since,
      maxPages: 12,
      maxRequests: 14,
      requestDelayMs: 800,
    });
    if (result.errors.length) {
      throw new Error(result.errors[0]);
    }
    return result.jobs;
  }

  async collect(request: CollectionRequest): Promise<CollectionResult> {
    const since = request.since;
    const maxPages = request.maxPages ?? 12;
    const maxRequests = request.maxRequests ?? 14;
    const requestDelayMs = request.requestDelayMs ?? 800;
    const categories = request.categories ?? [];
    const knownIds = request.knownSourceJobIds;

    const allStats: CategoryCollectionStat[] = [];
    const allJobs: RawJob[] = [];
    const allErrors: string[] = [];
    let totalRequests = 0;

    const addCategory = (stat: CategoryCollectionStat) => {
      allStats.push(stat);
    };

    const fetchPage = async (url: string, categorySlug?: string): Promise<{ jobs: RawJob[]; stopped: StopReason; lastPage?: number }> => {
      const res = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
          accept: 'text/html',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      totalRequests++;
      if (!res.ok) {
        allErrors.push(`Ethiojobs ${url} responded ${res.status}`);
        return { jobs: [], stopped: 'ERROR' };
      }

      const html = await res.text();
      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!match) {
        allErrors.push('Ethiojobs: __NEXT_DATA__ not found — selectorVersion may be stale');
        return { jobs: [], stopped: 'ERROR' };
      }

      let props: EjPageProps;
      try {
        props = JSON.parse(match[1]).props?.pageProps;
      } catch {
        allErrors.push('Ethiojobs: failed to parse __NEXT_DATA__ JSON');
        return { jobs: [], stopped: 'ERROR' };
      }

      const isCategoryPage = (props as any)?.meta?.slugName === 'category';
      let jobs: EjJob[] = [];
      let lastPage = 1;

      if (isCategoryPage) {
        const catProps = props as EjPagePropsCategory;
        jobs = catProps.initialData ?? [];
        lastPage = Math.ceil((catProps.meta?.total ?? jobs.length) / 10);
      } else {
        const jobsProps = props as EjPagePropsJobs;
        jobs = jobsProps.jobs?.data ?? [];
        lastPage = jobsProps.jobs?.meta?.lastPage ?? 1;
      }

      if (!jobs.length) {
        return { jobs: [], stopped: 'EMPTY_PAGE', lastPage };
      }

      const sourceCats = categorySlug ? [categorySlug] : (jobs[0]?.catalogs?.map((c) => c.name) ?? []);
      const discoveredVia = categorySlug ?? 'latest';

      const rawJobs: RawJob[] = jobs
        .filter((j) => {
          const posted = new Date(j.date_published);
          if (Number.isNaN(posted.getTime())) return false;
          if (knownIds?.has(j.slug)) return false;
          return posted >= since;
        })
        .map((j) => this.toRaw(j, sourceCats, discoveredVia))
        .filter((j): j is RawJob => !!j);

      return { jobs: rawJobs, stopped: 'LAST_PAGE', lastPage };
    };

    const runCategory = async (categorySlug?: string): Promise<CategoryCollectionStat> => {
      const catLabel = categorySlug ?? 'latest';
      const stat: CategoryCollectionStat = {
        category: catLabel,
        pagesFetched: 0,
        jobsFetched: 0,
        errors: 0,
        stoppedReason: 'ERROR',
      };

      for (let page = 1; page <= maxPages && totalRequests < maxRequests; page++) {
        const url = categorySlug
          ? `${BASE}/jobs/category/${categorySlug}${page > 1 ? `?page=${page}` : ''}`
          : page === 1
            ? `${BASE}/jobs`
            : `${BASE}/jobs?page=${page}`;

        const { jobs, stopped, lastPage } = await fetchPage(url, categorySlug);
        stat.pagesFetched = page;
        stat.jobsFetched += jobs.length;
        stat.stoppedReason = stopped;

        if (stopped === 'ERROR') {
          stat.errors++;
          continue;
        }

        for (const job of jobs) {
          const existing = allJobs.find((j) => j.sourceJobId === job.sourceJobId);
          if (existing) {
            existing.sourceCategories = [...new Set([...(existing.sourceCategories ?? []), ...(job.sourceCategories ?? [])])];
            existing.discoveredVia = [...new Set([...(existing.discoveredVia ?? []), ...(job.discoveredVia ?? [])])].join(',');
          } else {
            allJobs.push(job);
          }
        }

        if (stopped === 'EMPTY_PAGE' || stopped === 'LAST_PAGE') break;
        if (lastPage && page >= lastPage) break;
        await new Promise((r) => setTimeout(r, requestDelayMs));
      }

      return stat;
    };

    const latestStat = await runCategory();
    addCategory(latestStat);

    if (categories.length && request.mode === 'DEEP') {
      for (const catSlug of categories) {
        if (totalRequests >= maxRequests) break;
        const catStat = await runCategory(catSlug);
        addCategory(catStat);
      }
    }

    return {
      jobs: allJobs,
      pagesFetched: allStats.reduce((s, c) => s + c.pagesFetched, 0),
      requestsMade: totalRequests,
      categories: allStats,
      errors: allErrors,
    };
  }

  private toRaw(j: EjJob, sourceCategories: string[] = [], discoveredVia = 'latest'): RawJob | null {
    if (!j.title || !j.slug) return null;

    const location = j.state || 'Ethiopia';
    const isRemote = /remote/i.test(j.location_type || '') || /remote/i.test(location);
    const url = `${BASE}/jobs/${j.slug}`;

    // Extract category names separately from skills
    const categoryNames = (j.catalogs ?? []).map((c) => c.name);
    
    // Skills should be extracted from description, not from categories
    // For now, leave skills empty - the intelligence layer will extract them
    const skills: string[] = [];

    return {
      title: j.title,
      company: j.company?.name || 'Ethiojobs',
      location,
      locationClass: isRemote ? 'ETHIOPIA_REMOTE' : 'ETHIOPIA_LOCAL',
      employmentType: mapEmployment(this.mapJobType(j.type)),
      experienceLevel: deriveExperience(j.title),
      workPlace: isRemote ? 'REMOTE' : 'ONSITE',
      skills,
      categories: categoryNames.slice(0, 8),  // Store categories separately
      url,
      sourceJobId: j.slug,
      postedDate: new Date(j.date_published),
      deadline: j.date_expiry ? new Date(j.date_expiry) : undefined,
      description: j.description || '',
      country: 'Ethiopia',
      parseConfidence: 75,
      rawData: { api: 'ethiojobs-nextdata', id: j.id, slug: j.slug },
      sourceCategories,
      discoveredVia,
    };
  }

  /** Map Ethiojobs numeric type to employment type string. */
  private mapJobType(type: number): string | null {
    switch (type) {
      case 1: return 'Full Time';
      case 2: return 'Part Time';
      case 3: return 'Contract';
      case 4: return 'Internship';
      default: return 'Full Time';
    }
  }
}
