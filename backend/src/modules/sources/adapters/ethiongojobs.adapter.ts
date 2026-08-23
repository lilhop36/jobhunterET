/* EthioNGOJobs adapter — WordPress wp-json REST API, zero setup (SRS §9.2,
 * ETHIOPIA tier). Jobs are published as `posts`; company, location and
 * deadline are extracted from the post body with simple pattern matching. */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, deriveExperience, FETCH_TIMEOUT_MS } from './job-source.adapter';

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
    const res = await fetch(`${API}?per_page=20&_fields=id,link,date,title,content`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`EthioNGOJobs responded ${res.status}`);
    const posts = (await res.json()) as WpPost[];
    return posts
      .filter((p) => {
        const posted = new Date(p.date);
        return !Number.isNaN(posted.getTime()) && posted >= since;
      })
      .map((p) => this.toRaw(p))
      .filter((j): j is RawJob => !!j);
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
