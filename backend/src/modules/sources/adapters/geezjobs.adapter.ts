/* GeezJobs adapter — polite HTML scraping (SRS §9.2, ETHIOPIA tier, low rate).
 *
 * GeezJobs is a server-rendered board; the homepage lists /job-detail/<slug>
 * links and each job page carries og:title / og:description with the company
 * and location. We fetch the homepage once, then the first few job pages
 * sequentially — a bounded, low-rate crawl that respects §29 (no CAPTCHA
 * bypass, no auth circumvention). */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, deriveExperience, FETCH_TIMEOUT_MS } from './job-source.adapter';

const HOME = 'https://geezjobs.com/';
const MAX_JOBS = 12;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class GeezJobsAdapter implements JobSourceAdapter {
  readonly sourceId = 'geez'; // matches the seeded JobSource.id

  async fetchJobs(): Promise<RawJob[]> {
    const res = await fetch(HOME, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JobHunter/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GeezJobs responded ${res.status}`);
    const html = await res.text();

    const slugs = [...new Set([...html.matchAll(/href="\/job-detail\/([a-z0-9-]+)"/gi)].map((m) => m[1]))];
    const jobs: RawJob[] = [];

    for (const slug of slugs.slice(0, MAX_JOBS)) {
      try {
        const page = await fetch(`https://geezjobs.com/job-detail/${slug}`, {
          headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JobHunter/1.0' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!page.ok) continue;
        const j = this.parseJob(slug, await page.text());
        if (j) jobs.push(j);
        await sleep(700); // polite low-rate pacing (SRS §9.2: low rate)
      } catch {
        /* individual job-page failures are skipped — the source stays healthy */
      }
    }
    if (!jobs.length) throw new Error('GeezJobs returned no parseable job pages');
    return jobs;
  }

  private parseJob(slug: string, html: string): RawJob | null {
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

    // Fallback if no description found at all (prefer the main body over the
    // SEO meta blurb, which is a title-like summary, not the posting body)
    if (!description) {
      const fallbackDescMatch = /<div class="job-content">([\s\S]*?)<\/div>/i.exec(html);
      description = fallbackDescMatch
        ? fallbackDescMatch[1]
        : (this.meta(html, 'og:description') ?? '').replace(/\s*\|\s*GeezJobs.*$/i, '');
    }

    // 4. Extract Sidebar Metadata (Salary, Experience)
    let salaryNum: number | undefined;
    let currency = 'ETB';
    const salaryMatch = /<p[^>]*>Salary<\/p>\s*<p[^>]*>([^<]+)<\/p>/i.exec(html);
    if (salaryMatch) {
      const rawSalary = salaryMatch[1];
      // e.g. "ETB 30,000-35,000"
      const nums = [...rawSalary.matchAll(/[\d,]+/g)].map(m => parseInt(m[0].replace(/,/g, ''), 10));
      if (nums.length > 0) {
        salaryNum = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
      }
      if (/USD/i.test(rawSalary)) currency = 'USD';
    }

    const expMatch = /<p[^>]*>Experience<\/p>\s*<p[^>]*>([^<]+)<\/p>/i.exec(html);
    const expText = expMatch ? expMatch[1] : title;

    // 5. Deadline from JSON-LD (structured) or the sidebar "Deadline Aug. 24, 2026"
    let deadlineDate: Date | undefined;
    if (ld?.validThrough) {
      deadlineDate = this.parseDeadline(ld.validThrough);
    } else {
      const sidebarText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const deadlineMatch = /\bDeadline\b\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/.exec(sidebarText);
      if (deadlineMatch) deadlineDate = this.parseDeadline(deadlineMatch[1]);
    }

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
      postedDate: ld?.datePosted ? new Date(ld.datePosted) : new Date(),
      deadline: deadlineDate,
      description, // capped downstream by the fidelity pipeline (MAX_DESCRIPTION_CHARS)
      country: 'Ethiopia',
      parseConfidence: 90, // Upgraded confidence now that we parse structured data
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
