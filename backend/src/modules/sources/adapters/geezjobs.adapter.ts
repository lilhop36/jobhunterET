/* GeezJobs adapter — polite HTML scraping (SRS §9.2, ETHIOPIA tier, low rate).
 *
 * GeezJobs is a server-rendered board. The /jobs-in-ethiopia listing exposes
 * more links than the homepage. Category hubs live under /industry/{slug}.
 * ?page= pagination is NOT supported.
 *
 * Fair use: 700 ms pacing, hard request cap, known-id skip for DEEP sweeps.
 */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, CollectionRequest, CollectionResult, CategoryCollectionStat, StopReason, deriveExperience, FETCH_TIMEOUT_MS } from './job-source.adapter';

const HOME = 'https://geezjobs.com/';
const LISTING = 'https://geezjobs.com/jobs-in-ethiopia';
const MAX_JOBS = 49;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class GeezJobsAdapter implements JobSourceAdapter {
  readonly sourceId = 'geez'; // matches the seeded JobSource.id
  readonly selectorVersion = 'html:jsonld+dom:v1.0';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since;
    const result = await this.collect({
      mode: 'FAST',
      since: since ?? new Date(Date.now() - 14 * 86_400_000),
      maxPages: 1,
      maxRequests: 10,
      requestDelayMs: 700,
    });
    if (result.errors.length) {
      throw new Error(result.errors[0]);
    }
    return result.jobs;
  }

  async collect(request: CollectionRequest): Promise<CollectionResult> {
    const since = request.since;
    const maxPages = request.maxPages ?? 1;
    const maxRequests = request.maxRequests ?? 10;
    const requestDelayMs = request.requestDelayMs ?? 700;
    const categories = request.categories ?? [];
    const knownIds = request.knownSourceJobIds;

    const allStats: CategoryCollectionStat[] = [];
    const allJobs: RawJob[] = [];
    const allErrors: string[] = [];
    let totalRequests = 0;

    const addCategory = (stat: CategoryCollectionStat) => {
      allStats.push(stat);
    };

    const fetchListing = async (url: string): Promise<{ slugs: string[]; stopped: StopReason }> => {
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JobHunter/1.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      totalRequests++;
      if (!res.ok) {
        allErrors.push(`GeezJobs ${url} responded ${res.status}`);
        return { slugs: [], stopped: 'ERROR' };
      }
      const html = await res.text();
      const slugs = [...new Set([...html.matchAll(/href="\/job-detail\/([a-z0-9-]+)"/gi)].map((m) => m[1]))];
      if (!slugs.length) return { slugs: [], stopped: 'EMPTY_PAGE' };
      return { slugs, stopped: 'LAST_PAGE' };
    };

    const fetchJobPage = async (slug: string): Promise<RawJob | null> => {
      const res = await fetch(`https://geezjobs.com/job-detail/${slug}`, {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JobHunter/1.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      totalRequests++;
      if (!res.ok) return null;
      const html = await res.text();
      return this.parseJob(slug, html, since);
    };

    const runCategory = async (categoryUrl?: string, categoryLabel?: string): Promise<CategoryCollectionStat> => {
      const catLabel = categoryLabel ?? 'latest';
      const stat: CategoryCollectionStat = {
        category: catLabel,
        pagesFetched: 0,
        jobsFetched: 0,
        errors: 0,
        stoppedReason: 'ERROR',
      };

      for (let page = 1; page <= maxPages && totalRequests < maxRequests; page++) {
        const url = categoryUrl ?? LISTING;
        const { slugs, stopped } = await fetchListing(url);
        stat.pagesFetched = page;
        stat.stoppedReason = stopped;

        if (stopped === 'ERROR') {
          stat.errors++;
          continue;
        }

        const newSlugs = slugs.filter((s) => !knownIds?.has(s));
        for (const slug of newSlugs.slice(0, MAX_JOBS)) {
          if (totalRequests >= maxRequests) break;
          const job = await fetchJobPage(slug);
          if (job) allJobs.push(job);
          stat.jobsFetched++;
          await sleep(requestDelayMs);
        }

        if (stopped === 'EMPTY_PAGE' || stopped === 'LAST_PAGE') break;
      }

      return stat;
    };

    // FAST: only latest listing
    const latestStat = await runCategory();
    addCategory(latestStat);

    // DEEP: sweep category hubs
    if (request.mode === 'DEEP' && categories.length) {
      for (const slug of categories) {
        if (totalRequests >= maxRequests) break;
        const catUrl = `https://geezjobs.com/industry/${slug}`;
        const catStat = await runCategory(catUrl, slug);
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

  private parseJob(slug: string, html: string, since?: Date): RawJob | null {
    // 1. Try to extract JSON-LD
    const ldMatch = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(html);
    let ld: any = null;
    if (ldMatch) {
      try {
        ld = JSON.parse(ldMatch[1]);
      } catch (e) {
        // ignore
      }
    }

    // 2. Extract standard fields
    let title = ld?.title || this.title(html);
    if (!title) return null;
    title = title
      .replace(/\s*-\s*Readvert.*$/i, '')
      .replace(/\s*via\s*GeezJobs.*$/i, '')
      .replace(/\s*[-|]\s*GeezJobs.*$/i, '')
      .trim();

    const company = ld?.hiringOrganization?.name?.replace(/\s*\|\s*GeezJobs/i, '')?.trim() ?? 'GeezJobs';

    // Default location fallback
    const location = ld?.jobLocation?.address?.addressLocality ?? 'Ethiopia';

    let description = ld?.description || '';

    // 3. Extract "How to Apply" block from DOM (missing in JSON-LD)
    const howToApplyMatch = /<h3[^>]*>How to Apply<\/h3>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(html);
    if (howToApplyMatch) {
      description += `\n\n<h3>How to Apply</h3>\n${howToApplyMatch[1]}`;
    }

    // Fallback if no description found at all
    if (!description) {
      const fallbackDescMatch = /<div class="job-content">([\s\S]*?)<\/div>/i.exec(html);
      description = fallbackDescMatch
        ? fallbackDescMatch[1]
        : (this.meta(html, 'og:description') ?? '').replace(/\s*\|\s*GeezJobs.*$/i, '');
    }

    // 4. Extract Sidebar Metadata (Salary, Experience)
    let salaryNum: number | undefined;
    let currency = 'ETB';
    let sidebarConfidenceBonus = 0;

    if (ld?.baseSalary?.value) {
      salaryNum = Number(ld.baseSalary.value);
      currency = ld.baseSalary.currency || 'ETB';
      sidebarConfidenceBonus = 5;
    } else {
      const sidebarText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const salaryTextMatch = /Salary\s+([A-Z]{2,3}\s+[\d,\s.-]+)/i.exec(sidebarText);
      if (salaryTextMatch) {
        const rawSalary = salaryTextMatch[1];
        const nums = [...rawSalary.matchAll(/[\d,]+/g)].map(m => parseInt(m[0].replace(/,/g, ''), 10)).filter(n => !Number.isNaN(n));
        if (nums.length > 0) {
          salaryNum = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
        }
        if (/USD/i.test(rawSalary)) currency = 'USD';
      } else {
        const salaryMatch = /<p[^>]*>Salary<\/p>\s*<p[^>]*>([^<]+)<\/p>/i.exec(html);
        if (salaryMatch) {
          const rawSalary = salaryMatch[1];
          const nums = [...rawSalary.matchAll(/[\d,]+/g)].map(m => parseInt(m[0].replace(/,/g, ''), 10));
          if (nums.length > 0) {
            salaryNum = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
          }
          if (/USD/i.test(rawSalary)) currency = 'USD';
        }
      }
    }

    let expText: string;
    if (ld?.experienceRequirements) {
      expText = String(ld.experienceRequirements);
    } else {
      const sidebarText2 = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const expTextMatch = /Experience\s+(.+?)(?=\s+Deadline|\s+Salary|\s+How|$)/i.exec(sidebarText2);
      expText = expTextMatch ? expTextMatch[1].trim() : title;
      if (!expTextMatch) {
        const expMatch = /<p[^>]*>Experience<\/p>\s*<p[^>]*>([^<]+)<\/p>/i.exec(html);
        if (expMatch) expText = expMatch[1];
      }
    }

    // 5. Deadline from JSON-LD or sidebar
    let deadlineDate: Date | undefined;
    if (ld?.validThrough) {
      deadlineDate = this.parseDeadline(ld.validThrough);
    } else {
      const sidebarText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const deadlineMatch = /\bDeadline\b\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/.exec(sidebarText);
      if (deadlineMatch) deadlineDate = this.parseDeadline(deadlineMatch[1]);
    }

    // Freshness filter
    const postedDate = ld?.datePosted ? new Date(ld.datePosted) : new Date();
    if (since && postedDate < since) return null;

    return {
      title,
      company,
      location,
      locationClass: 'ETHIOPIA_LOCAL',
      employmentType: 'FULL_TIME',
      experienceLevel: deriveExperience(expText),
      workPlace: 'ONSITE',
      salary: salaryNum,
      currency,
      skills: [],
      url: `https://geezjobs.com/job-detail/${slug}`,
      sourceJobId: slug,
      postedDate,
      deadline: deadlineDate,
      description,
      country: 'Ethiopia',
      parseConfidence: 90 + sidebarConfidenceBonus,
      rawData: { site: 'geezjobs', slug },
    };
  }

  private meta(html: string, prop: string): string | null {
    const re = new RegExp(`<meta[^>]*property="${prop}"[\\s\\S]*?content="([^"]*)"`, 'i');
    const m = re.exec(html);
    if (m) return m[1];
    const re2 = new RegExp(`<meta[^>]*content="([^"]*)"[\\s\\S]*?property="${prop}"`, 'i');
    const m2 = re2.exec(html);
    return m2 ? m2[1] : null;
  }

  private title(html: string): string | null {
    return /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/\s*\|\s*GeezJobs.*$/i, '').trim() ?? null;
  }

  private parseDeadline(raw: string): Date | undefined {
    const d = new Date(raw.replace(/\./g, ' '));
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
}
