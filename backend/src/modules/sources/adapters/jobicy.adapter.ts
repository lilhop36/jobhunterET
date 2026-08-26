/* Jobicy adapter — free JSON API for remote jobs, no key required.
 *
 * Fair use: no more than once per hour → DEEP sweeps only.
 * Jobicy returns curated remote job listings with structured metadata:
 * jobTitle, companyName, jobGeo, jobLevel, jobType, jobExcerpt, tags, url.
 * Relevant for the REMOTE and INTERNATIONAL tiers.
 */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, CollectionRequest, CollectionResult, CategoryCollectionStat, StopReason, deriveExperience, mapEmployment, parseNumericSalary, FETCH_TIMEOUT_MS } from './job-source.adapter';

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
  readonly selectorVersion = 'api:jobicy:v1.0';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since ?? new Date(Date.now() - 14 * 86_400_000);
    const result = await this.collect({
      mode: 'FAST',
      since,
      maxPages: 1,
      maxRequests: 2,
      requestDelayMs: 0,
    });
    if (result.errors.length) {
      throw new Error(result.errors[0]);
    }
    return result.jobs;
  }

  async collect(request: CollectionRequest): Promise<CollectionResult> {
    const since = request.since;
    const maxRequests = request.maxRequests ?? 2;
    const requestDelayMs = request.requestDelayMs ?? 0;
    const categories = request.categories ?? [];

    const allStats: CategoryCollectionStat[] = [];
    const allJobs: RawJob[] = [];
    const allErrors: string[] = [];
    let totalRequests = 0;

    const addCategory = (stat: CategoryCollectionStat) => {
      allStats.push(stat);
    };

    const fetchIndustry = async (industry?: string): Promise<{ jobs: RawJob[]; stopped: StopReason }> => {
      const url = industry ? `${API}?count=50&industry=${encodeURIComponent(industry)}` : `${API}?count=50`;
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      totalRequests++;
      if (!res.ok) {
        allErrors.push(`Jobicy ${url} responded ${res.status}`);
        return { jobs: [], stopped: 'ERROR' };
      }

      const body = (await res.json()) as { jobs?: JobicyJob[] };
      const jobs = (body.jobs ?? [])
        .filter((j) => {
          const posted = new Date(j.pubDate);
          return !Number.isNaN(posted.getTime()) && posted >= since;
        })
        .map((j) => this.toRaw(j))
        .filter((j): j is RawJob => !!j);

      return { jobs, stopped: 'LAST_PAGE' };
    };

    const runCategory = async (industry?: string): Promise<CategoryCollectionStat> => {
      const catLabel = industry ?? 'latest';
      const stat: CategoryCollectionStat = {
        category: catLabel,
        pagesFetched: 0,
        jobsFetched: 0,
        errors: 0,
        stoppedReason: 'ERROR',
      };

      const { jobs, stopped } = await fetchIndustry(industry);
      stat.pagesFetched = 1;
      stat.jobsFetched = jobs.length;
      stat.stoppedReason = stopped;

      if (stopped === 'ERROR') {
        stat.errors++;
      } else {
        allJobs.push(...jobs);
      }

      return stat;
    };

    // FAST: only fetch latest (no industry filter)
    const latestStat = await runCategory();
    addCategory(latestStat);

    // DEEP: sweep configured industries (respecting maxRequests budget)
    if (request.mode === 'DEEP' && categories.length) {
      for (const industry of categories) {
        if (totalRequests >= maxRequests) break;
        const catStat = await runCategory(industry);
        addCategory(catStat);
        if (totalRequests < maxRequests) {
          await new Promise((r) => setTimeout(r, requestDelayMs));
        }
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

  private toRaw(j: JobicyJob): RawJob | null {
    if (!j.jobTitle || !j.url) return null;

    const salary = parseNumericSalary(j.annualSalaryMin, j.annualSalaryMax);
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
      sourceCategories: j.jobIndustry,
    };
  }
}
