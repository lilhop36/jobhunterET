/* ETCareers adapter — Ethiopia jobs via the public Jobboardly RSS feed.
 *
 * etcareers.com is a Jobboardly (Rails) job board. Its /jobs.rss feed lists
 * full postings with no API key (same approach as the ReliefWeb adapter).
 * Each item's title is "Job Title - Company - Location, Ethiopia", and the
 * HTML description carries deadline/application details that the fidelity
 * pipeline (runFidelityPipeline) extracts downstream. */
import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, deriveExperience, mapEmployment, FETCH_TIMEOUT_MS } from './job-source.adapter';

interface RssItem {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  description: string;
  categories: string[];
}

const FEED = 'https://etcareers.com/jobs.rss';

@Injectable()
export class EtcareersAdapter implements JobSourceAdapter {
  readonly sourceId = 'etcareers';
  readonly selectorVersion = 'rss:etcareers:v1.0';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const xml = await this.getFeed();

    const items = this.parseItems(xml);
    const since = options?.since ?? new Date(Date.now() - 30 * 86_400_000);

    return items
      .filter((i) => {
        const posted = new Date(i.pubDate);
        return !Number.isNaN(posted.getTime()) && posted >= since;
      })
      .map((i) => this.toRaw(i))
      .filter((j): j is RawJob => !!j);
  }

  private async getFeed(): Promise<string> {
    const res = await fetch(FEED, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ETCareers RSS responded ${res.status}`);
    return res.text();
  }

  /** Minimal, dependency-free RSS item parser (same feed shape as ReliefWeb). */
  private parseItems(xml: string): RssItem[] {
    const items: RssItem[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xml))) {
      const block = m[1];
      const grab = (tag: string) => {
        const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
        return r ? r[1].trim() : '';
      };
      const title = grab('title').replace(/<!\[CDATA\[|\]\]>/g, '');
      const link = grab('link') || grab('guid');
      if (!title || !link) continue;
      const cats = [...block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/g)].map((c) =>
        c[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
      );
      items.push({
        title,
        link,
        guid: grab('guid').replace(/<!\[CDATA\[|\]\]>/g, ''),
        pubDate: grab('pubDate'),
        description: grab('description').replace(/<!\[CDATA\[|\]\]>/g, ''),
        categories: cats,
      });
    }
    return items;
  }

  private toRaw(i: RssItem): RawJob | null {
    // Titles follow "Job Title - Company - Location, Ethiopia".
    const parts = i.title
      .split(' - ')
      .map((s) => s.trim())
      .filter(Boolean);
    const location = parts.length >= 2 ? parts[parts.length - 1] : 'Ethiopia';
    const company =
      parts.length >= 3 ? parts[parts.length - 2] : i.categories[0]?.replace(/ Jobs in Ethiopia$/i, '') ?? 'ETCareers';
    const title = parts.length >= 3 ? parts.slice(0, -2).join(' - ') : parts[0] ?? i.title;

    const cats = i.categories.map((c) => c.toLowerCase());
    const consultancy = cats.some((c) => c.includes('consultant')) || /consultancy|consultant/i.test(title);
    const internship = /intern/i.test(title);
    const remote = /remote/i.test(location);

    return {
      title,
      company,
      location,
      locationClass: remote ? 'ETHIOPIA_REMOTE' : 'ETHIOPIA_LOCAL',
      employmentType: internship ? 'INTERNSHIP' : consultancy ? 'CONTRACT' : mapEmployment(null),
      experienceLevel: deriveExperience(title),
      workPlace: remote ? 'REMOTE' : 'ONSITE',
      skills: [],
      url: i.link,
      sourceJobId: i.guid || i.link.split('/').pop() || i.link,
      postedDate: new Date(i.pubDate),
      description: i.description,
      country: 'Ethiopia',
      parseConfidence: 70,
      rawData: { feed: 'etcareers-jobs-rss', title: i.title, categories: i.categories },
    };
  }
}