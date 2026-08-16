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
    const ogTitle = this.meta(html, 'og:title');
    const ogDesc = this.meta(html, 'og:description');
    const title = ogTitle
      ? ogTitle.replace(/\s+job\s+at\s+.*\|\s*GeezJobs$/i, '').replace(/\s*\|.*$/, '').trim()
      : this.title(html);
    if (!title) return null;

    const company = (ogTitle ? /at\s+(.+?)\s*\|\s*GeezJobs/i.exec(ogTitle) : null)?.[1]?.trim() ?? 'GeezJobs';
    const location = /in\s+(Addis Ababa|Dire Dawa|Hawassa|Bahir Dar|Mekelle|Oromia|Amhara|Ethiopia)/i.exec(
      ogDesc ?? '',
    )?.[1] ?? 'Ethiopia';
    const deadline = /deadline[^0-9]{0,30}(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i.exec(html)?.[1];

    return {
      title,
      company,
      location,
      locationClass: 'ETHIOPIA_LOCAL',
      employmentType: 'FULL_TIME',
      experienceLevel: deriveExperience(title),
      workPlace: 'ONSITE',
      skills: [],
      url: `https://geezjobs.com/job-detail/${slug}`,
      sourceJobId: slug,
      postedDate: new Date(),
      deadline: deadline ? this.parseDeadline(deadline) : undefined,
      description: (ogDesc ?? '').slice(0, 2000),
      country: 'Ethiopia',
      parseConfidence: 65,
      rawData: { site: 'geezjobs', slug },
    };
  }

  private meta(html: string, prop: string): string | null {
    return /<meta[^>]*property="og:title"[\s\S]*?content="([^"]*)"/i.exec(html)?.[1] ??
      /<meta[^>]*content="([^"]*)"[\s\S]*?property="og:title"/i.exec(html)?.[1] ??
      null;
  }

  private title(html: string): string | null {
    return /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/\s*\|\s*GeezJobs.*$/i, '').trim() ?? null;
  }

  private parseDeadline(raw: string): Date | undefined {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
}
