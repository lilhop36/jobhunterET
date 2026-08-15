/* ReliefWeb adapter — Ethiopia jobs via the public RSS feed.
 *
 * The JSON API v2 (api.reliefweb.int/v2/jobs) requires a pre-approved `appname`
 * and returns 403 without one (SRS §9.2: "requires pre-approved appname").
 * ReliefWeb's public RSS feed supports an `advanced-search` filter with the
 * country code (C87 = Ethiopia), giving a live, real list of Ethiopia jobs
 * with no API key. */
import { Injectable } from '@nestjs/common';
import * as https from 'https';
import { JobSourceAdapter, RawJob, deriveExperience, mapEmployment } from './job-source.adapter';

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  categories: string[];
}

const FEED = 'https://reliefweb.int/jobs/rss.xml?advanced-search=%28C87%29';

@Injectable()
export class ReliefWebAdapter implements JobSourceAdapter {
  readonly sourceId = 'reliefweb';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    // Note: ReliefWeb's bot protection TLS-fingerprints undici (global fetch)
    // and answers 406 regardless of headers, but Node's classic https module
    // passes — so we use it here instead of fetch.
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

  private getFeed(): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.get(
        FEED,
        {
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            accept: 'application/rss+xml, application/xml, text/xml, */*',
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            res.resume();
            reject(new Error(`ReliefWeb RSS responded ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        },
      );
      req.on('error', reject);
      req.setTimeout(30_000, () => {
        req.destroy(new Error('ReliefWeb RSS timeout'));
      });
    });
  }

  /** Minimal, dependency-free RSS item parser. */
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
        pubDate: grab('pubDate'),
        description: grab('description').replace(/<!\[CDATA\[|\]\]>/g, ''),
        categories: cats,
      });
    }
    return items;
  }

  private toRaw(i: RssItem): RawJob | null {
    const cats = i.categories.map((c) => c.toLowerCase());
    const consultancy = cats.includes('consultancy') || /consultancy|consultant/i.test(i.title);
    const internship = /intern/i.test(i.title);
    return {
      title: i.title,
      company: i.categories[0] && i.categories[0].toLowerCase() !== 'job' && i.categories[0].toLowerCase() !== 'ethiopia'
        ? i.categories[0]
        : 'ReliefWeb',
      location: 'Ethiopia',
      locationClass: 'ETHIOPIA_LOCAL',
      employmentType: internship ? 'INTERNSHIP' : consultancy ? 'CONTRACT' : mapEmployment(null),
      experienceLevel: deriveExperience(i.title),
      workPlace: 'ONSITE',
      skills: [],
      url: i.link,
      sourceJobId: i.link.split('/').pop() || i.link,
      postedDate: new Date(i.pubDate),
      description: i.description.slice(0, 4000),
      country: 'Ethiopia',
      parseConfidence: 70,
      rawData: { feed: 'reliefweb-int-jobs-ethiopia', title: i.title, categories: i.categories },
    };
  }
}
