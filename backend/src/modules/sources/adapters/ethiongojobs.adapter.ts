/* EthioNGOJobs adapter — WordPress wp-json REST API (SRS §9.2, ETHIOPIA tier).
 *
 * Supports category collection via `?categories=<id>` and pagination via
 * `per_page=100` + `page=N` guided by `X-WP-TotalPages`.
 */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, CollectionRequest, CollectionResult, CategoryCollectionStat, StopReason, deriveExperience, FETCH_TIMEOUT_MS } from './job-source.adapter';

interface WpPost {
  id: number;
  link: string;
  date: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
}

const API = 'https://ethiongojobs.com/wp-json/wp/v2/posts';

@Injectable()
export class EthioNgoJobsAdapter implements JobSourceAdapter {
  readonly sourceId = 'ethiongojobs';
  readonly selectorVersion = 'api:wp-json:v1.0';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const since = options?.since ?? new Date(Date.now() - 30 * 86_400_000);
    const result = await this.collect({
      mode: 'FAST',
      since,
      maxPages: 5,
      maxRequests: 10,
      requestDelayMs: 500,
    });
    if (result.errors.length) {
      throw new Error(result.errors[0]);
    }
    return result.jobs;
  }

  async collect(request: CollectionRequest): Promise<CollectionResult> {
    const since = request.since;
    const maxPages = request.maxPages ?? 5;
    const maxRequests = request.maxRequests ?? 10;
    const requestDelayMs = request.requestDelayMs ?? 500;
    const categories = request.categories ?? [];
    const knownIds = request.knownSourceJobIds;

    const allStats: CategoryCollectionStat[] = [];
    const allJobs: RawJob[] = [];
    const allErrors: string[] = [];
    let totalRequests = 0;

    const addCategory = (stat: CategoryCollectionStat) => {
      allStats.push(stat);
    };

    const fetchPage = async (url: string): Promise<{ posts: WpPost[]; totalPages?: number; stopped: StopReason }> => {
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      totalRequests++;
      if (!res.ok) {
        allErrors.push(`EthioNGOJobs ${url} responded ${res.status}`);
        return { posts: [], stopped: 'ERROR' };
      }

      const totalPages = parseInt(res.headers.get('X-WP-TotalPages') ?? '1', 10) || 1;
      const posts = (await res.json()) as WpPost[];
      const fresh = posts.filter((p) => {
        const posted = new Date(p.date);
        return !Number.isNaN(posted.getTime()) && posted >= since;
      });

      if (fresh.length === 0 && posts.length > 0) {
        return { posts: [], totalPages, stopped: 'FRESHNESS_BOUNDARY' };
      }
      if (posts.length === 0) {
        return { posts: [], totalPages, stopped: 'EMPTY_PAGE' };
      }

      return { posts: fresh, totalPages, stopped: 'LAST_PAGE' };
    };

    const runCategory = async (categoryId?: string): Promise<CategoryCollectionStat> => {
      const catLabel = categoryId ?? 'latest';
      const stat: CategoryCollectionStat = {
        category: catLabel,
        pagesFetched: 0,
        jobsFetched: 0,
        errors: 0,
        stoppedReason: 'ERROR',
      };

      for (let page = 1; page <= maxPages && totalRequests < maxRequests; page++) {
        const catParam = categoryId ? `&categories=${encodeURIComponent(categoryId)}` : '';
        const url = `${API}?per_page=100&_fields=id,link,date,title,content&page=${page}${catParam}`;
        const { posts, totalPages, stopped } = await fetchPage(url);
        stat.pagesFetched = page;
        stat.jobsFetched += posts.length;
        stat.stoppedReason = stopped;

        if (stopped === 'ERROR') {
          stat.errors++;
          continue;
        }

        const rawJobs: RawJob[] = posts
          .filter((p) => !knownIds?.has(String(p.id)))
          .map((p) => this.toRaw(p))
          .filter((j): j is RawJob => !!j);

        allJobs.push(...rawJobs);

        if (stopped === 'FRESHNESS_BOUNDARY' || stopped === 'EMPTY_PAGE' || stopped === 'LAST_PAGE') break;
        if (totalPages && page >= totalPages) {
          stat.stoppedReason = 'LAST_PAGE';
          break;
        }

        await new Promise((r) => setTimeout(r, requestDelayMs));
      }

      return stat;
    };

    const latestStat = await runCategory();
    addCategory(latestStat);

    if (categories.length && request.mode === 'DEEP') {
      for (const catId of categories) {
        if (totalRequests >= maxRequests) break;
        const catStat = await runCategory(catId);
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

  private toRaw(p: WpPost): RawJob | null {
    const title = p.title?.rendered?.trim();
    if (!title || !p.link) return null;

    const text = this.stripHtml(p.content?.rendered ?? '');
    const location = (this.pick(text, /location\s*:\s*([^\n]+)/i) ?? 'Ethiopia').split(
      /\s+(?:Deadline|Job Description|Project|Ref|Employment|Salary)\b/i,
    )[0];
    const company =
      this.pick(text, /organization\s*:\s*([^\n]+)/i) ??
      this.pick(title, /@\s*([^\n]+)/i) ??
      'EthioNGOJobs';
    const deadlineRaw = this.pick(text, /deadline\s*:\s*([^\n]+)/i);
    const deadline = deadlineRaw ? this.parseDeadline(deadlineRaw) : undefined;

    return {
      title: title.replace(/_\s*Job\s*@/i, ' @'),
      company,
      location,
      locationClass: 'ETHIOPIA_LOCAL',
      employmentType: 'FULL_TIME',
      experienceLevel: deriveExperience(title),
      workPlace: 'ONSITE',
      skills: [],
      url: p.link,
      sourceJobId: String(p.id),
      postedDate: new Date(p.date),
      deadline,
      description: p.content?.rendered ?? '',
      country: 'Ethiopia',
      parseConfidence: 70,
      rawData: { api: 'wp-json-v2-posts', id: p.id },
    };
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&#8211;/gi, '–')
      .replace(/&#8217;|&#039;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  private pick(text: string, re: RegExp): string | null {
    const m = re.exec(text);
    if (!m) return null;
    return m[1].replace(/[,|]$/, '').trim().slice(0, 120) || null;
  }

  private parseDeadline(raw: string): Date | undefined {
    const m = /([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/.exec(raw);
    if (!m) return undefined;
    const d = new Date(m[1]);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
}
