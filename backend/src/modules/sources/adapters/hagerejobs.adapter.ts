/* HagereJobs adapter — HTML scraping of hagerejobs.com (Ethiopia job board).
 *
 * The site is WordPress + Elementor. Jobs are listed on /ethiopia-job/ and
 * /international-job/ with structured HTML: <h3 class="job-card-title">,
 * <p><strong>Company:</strong>, <strong>Location:</strong>, <strong>Deadline:</strong>.
 * Detail pages are JS-rendered (Elementor), so we extract fields from the
 * listing page only. */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, LocationClass, EmploymentType, deriveExperience, FETCH_TIMEOUT_MS } from './job-source.adapter';

const LISTING_URLS = [
  'https://hagerejobs.com/ethiopia-job/',
  'https://hagerejobs.com/international-job/',
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class HagereJobsAdapter implements JobSourceAdapter {
  readonly sourceId = 'hagerejobs';
  readonly selectorVersion = 'html:dom:v1.0';

  async fetchJobs(): Promise<RawJob[]> {
    const jobs: RawJob[] = [];

    for (const url of LISTING_URLS) {
      try {
        const res = await fetch(url, {
          headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JobHunter/1.0' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const html = await res.text();
        jobs.push(...this.parseListingPage(html, url));
        await sleep(500);
      } catch {
        /* page failures are non-fatal */
      }
    }

    if (!jobs.length) throw new Error('HagereJobs returned no parseable jobs');
    return jobs;
  }

  private parseListingPage(html: string, sourceUrl: string): RawJob[] {
    const jobs: RawJob[] = [];
    const isInternational = sourceUrl.includes('international');

    // Extract job IDs from job_detail=NNN links
    const jobIdSet = new Set<string>();
    const idRegex = /job_detail=(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = idRegex.exec(html)) !== null) {
      jobIdSet.add(m[1]);
    }

    // For each job, extract surrounding HTML block and parse fields
    for (const jobId of jobIdSet) {
      const job = this.extractJobFromListing(html, jobId, isInternational);
      if (job) jobs.push(job);
    }

    return jobs;
  }

  private extractJobFromListing(html: string, jobId: string, isInternational: boolean): RawJob | null {
    // Find the block around this job_detail link
    const marker = `job_detail=${jobId}`;
    const idx = html.indexOf(marker);
    if (idx === -1) return null;

    // Expand the window to capture the full card (typically ~2000 chars)
    const start = Math.max(0, idx - 1500);
    const end = Math.min(html.length, idx + 1500);
    const block = html.substring(start, end);

    // Extract title from <h3 class="job-card-title">
    const titleMatch = /<h3[^>]*class="job-card-title"[^>]*>([^<]+)<\/h3>/i.exec(block);
    const title = titleMatch?.[1]?.trim();
    if (!title) return null;

    // Extract company
    const companyMatch = /<strong>Company:\s*<\/strong>\s*([^<]+)/i.exec(block);
    const company = companyMatch?.[1]?.trim() || 'Unknown';

    // Extract location
    const locationMatch = /<strong>Location:\s*<\/strong>\s*([^<]+)/i.exec(block);
    const location = locationMatch?.[1]?.trim() || (isInternational ? 'International' : 'Ethiopia');

    // Extract deadline
    const deadlineMatch = /<strong>Deadline:\s*<\/strong>\s*([^<]+)/i.exec(block);
    const deadline = deadlineMatch ? this.parseDeadline(deadlineMatch[1].trim()) : undefined;

    // Extract experience
    const expMatch = /<strong>Experience:\s*<\/strong>\s*([^<]+)/i.exec(block);
    const expText = expMatch?.[1]?.trim() || '';

    // Extract education
    const eduMatch = /<strong>Education:\s*<\/strong>\s*([^<]+)/i.exec(block);
    const education = eduMatch?.[1]?.trim() || '';

    // Extract employment type (Full Time, Part Time, etc.)
    const typeMatch = /<span[^>]*>\s*(Full Time|Part Time|Contract|Temporary|Internship)\s*<\/span>/i.exec(block);
    const empType = typeMatch?.[1]?.trim() || 'FULL_TIME';

    // Extract apply link
    const applyMatch = /href="(https?:\/\/[^"]*(?:apply|forms\.microsoft|docs\.google)[^"]*)"/i.exec(block);
    const detailUrl = `https://hagerejobs.com/ethiopia-job/?job_detail=${jobId}`;

    // Build description from available fields
    const description = [
      `<h2>${title}</h2>`,
      `<p><strong>Company:</strong> ${company}</p>`,
      `<p><strong>Location:</strong> ${location}</p>`,
      expText ? `<p><strong>Experience:</strong> ${expText}</p>` : '',
      education ? `<p><strong>Education:</strong> ${education}</p>` : '',
      deadlineMatch ? `<p><strong>Deadline:</strong> ${deadlineMatch[1].trim()}</p>` : '',
      `<p><a href="${detailUrl}">View on HagereJobs</a></p>`,
    ].filter(Boolean).join('\n');

    return {
      title,
      company,
      location,
      locationClass: (isInternational ? 'INTERNATIONAL_ONSITE' : 'ETHIOPIA_LOCAL') as LocationClass,
      employmentType: this.mapEmploymentType(empType) as EmploymentType,
      experienceLevel: deriveExperience(expText || title),
      workPlace: 'ONSITE',
      salary: undefined,
      currency: 'ETB',
      skills: [],
      url: applyMatch?.[1] || detailUrl,
      sourceJobId: `hagerejobs-${jobId}`,
      postedDate: new Date(),
      deadline,
      description,
      country: isInternational ? undefined : 'Ethiopia',
      parseConfidence: 80, // listing-page-only, no description body
      rawData: { site: 'hagerejobs', jobId, sourceUrl: detailUrl },
    };
  }

  private mapEmploymentType(raw: string): string {
    const upper = raw.toUpperCase().replace(/\s+/g, '_');
    const map: Record<string, string> = {
      'FULL_TIME': 'FULL_TIME',
      'PART_TIME': 'PART_TIME',
      'CONTRACT': 'CONTRACT',
      'TEMPORARY': 'TEMPORARY',
      'INTERNSHIP': 'INTERNSHIP',
    };
    return map[upper] || 'FULL_TIME';
  }

  private parseDeadline(raw: string): Date | undefined {
    // Formats: "31/08/2026", "01/09/2026", "25/08/2026"
    const parts = raw.split('/');
    if (parts.length === 3) {
      const [dd, mm, yyyy] = parts;
      const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      return Number.isNaN(d.getTime()) ? undefined : d;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
}
