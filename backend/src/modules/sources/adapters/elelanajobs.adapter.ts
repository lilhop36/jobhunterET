/* ElelanaJobs adapter — Ethiopia job board via its public WordPress RSS feed.
 *
 * Verified live 2026-11-01: /feed/ returns recent Ethiopian vacancies with the
 * full announcement body. Posts are publisher-written and often advertise
 * several positions in one post ("Job Position-1 …", "Job Position-2 …"), so
 * each position becomes its own RawJob and the sourceJobId carries the position
 * index. The post URL stays the canonical application link.
 *
 * The feed is Ethiopia-focused, but location is still read from the post's own
 * labelled field — never assumed — so the eligibility policy decides, not us.
 */

import { Injectable } from '@nestjs/common';
import { JobSourceAdapter, RawJob, deriveExperience, mapEmployment, FETCH_TIMEOUT_MS } from './job-source.adapter';
import { parseRssItems, feedText, RssItem } from './rss-feed';
import { classifyLocationText, isEthiopianLocation } from '../../eligibility/ethiopia-eligibility';

const FEED = 'https://elelanajobs.com/feed/';

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

interface PositionBlock {
  title: string;
  body: string;
}

@Injectable()
export class ElelanaJobsAdapter implements JobSourceAdapter {
  readonly sourceId = 'elelana';
  readonly selectorVersion = 'rss:wp:v1.0';

  async fetchJobs(options?: { since?: Date }): Promise<RawJob[]> {
    const res = await fetch(FEED, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; JobPilotET/1.0; +https://github.com/lilhop36/jobhunterET)',
        accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ElelanaJobs feed responded ${res.status}`);

    const since = options?.since ?? new Date(Date.now() - 14 * 86_400_000);
    return parseRssItems(await res.text())
      .filter((item) => {
        const posted = new Date(item.pubDate);
        return !Number.isNaN(posted.getTime()) && posted >= since;
      })
      .flatMap((item) => this.toRawJobs(item));
  }

  private toRawJobs(item: RssItem): RawJob[] {
    const company = item.title.trim();
    const postId = /[?&]p=(\d+)/.exec(item.guid) ?? /[?&]p=(\d+)/.exec(item.link);
    const baseId = postId ? postId[1] : item.link.split('/').filter(Boolean).pop() ?? item.link;
    const postedDate = new Date(item.pubDate);
    const fallbackBody = feedText(item.content || item.description);

    const positions = this.splitPositions(item.content || item.description);
    const blocks: PositionBlock[] = positions.length
      ? positions
      : [{ title: this.fallbackTitle(item, fallbackBody), body: fallbackBody }];

    return blocks
      .map((block, i): RawJob | null => {
        const title = block.title.trim();
        if (!title) return null;

        const location = this.field(block.body, [
          'place of work', 'work place', 'duty stations', 'duty station',
          'work location', 'job location', 'location',
        ]) ?? this.field(fallbackBody, ['place of work', 'work place', 'duty stations', 'duty station', 'location']);

        const employmentType = mapEmployment(this.field(block.body, ['employment type']));
        const workPlace = /remote|work from home|wfh/i.test(location ?? '') ? 'REMOTE' : 'ONSITE';
        const et = isEthiopianLocation(location);

        return {
          title,
          company,
          location: location ?? 'Unknown',
          locationClass: classifyLocationText(location) as RawJob['locationClass'],
          employmentType,
          experienceLevel: deriveExperience(title),
          workPlace,
          skills: [],
          url: item.link,
          // Stable across refreshes; the index keeps multiple positions in one
          // post as separate postings instead of silently dropping all but one.
          sourceJobId: positions.length > 1 ? `${baseId}-p${i + 1}` : baseId,
          postedDate,
          deadline: this.deadline(block.body) ?? this.deadline(fallbackBody),
          description: block.body.slice(0, 8000),
          country: et ? 'Ethiopia' : undefined,
          parseConfidence: positions.length ? 70 : 55,
          rawData: { feed: 'elelanajobs', postId: item.guid, position: i + 1 },
        };
      })
      .filter((j): j is RawJob => !!j);
  }

  /** Split a post into one block per advertised position. */
  private splitPositions(html: string): PositionBlock[] {
    const text = feedText(html);
    const marker = /Job\s*Position\s*[-–—:]?\s*\d*\s*[-–—:]?\s*/gi;
    const marks = [...text.matchAll(marker)].map((m) => m.index ?? 0);
    if (!marks.length) return [];

    return marks
      .map((start, i) => {
        const chunk = text.slice(start, i + 1 < marks.length ? marks[i + 1] : text.length);
        const title = chunk
          .replace(marker, '')
          .split(/Required Qualification|Education\s*:|Work Experience|Deadline|Place of Work|How To Apply|Requirement Skill/i)[0]
          .replace(/[.;,:\s]+$/, '')
          .trim();
        return { title, body: chunk.trim() };
      })
      .filter((b) => b.title.length >= 3);
  }

  /** Posts without a "Job Position" marker still carry a bold lead line. */
  private fallbackTitle(item: RssItem, body: string): string {
    const strong = /<strong>([^<]{3,140})<\/strong>/i.exec(item.content || '');
    const lead = (strong?.[1] ?? body).replace(/\s+/g, ' ').trim();
    return lead.replace(/\s*external\s+vacancy\s+announcement.*$/i, '').slice(0, 120) || item.title;
  }

  /** First labelled field present in a block, cleaned of boilerplate. */
  private field(body: string, labels: string[]): string | null {
    for (const label of labels) {
      const rx = new RegExp(`${label}\\s*[:\\-]\\s*([^|\\n]{2,80})`, 'i');
      const m = rx.exec(body);
      if (m) {
        const value = m[1]
          .replace(/\(re-?advertised\)/gi, '')
          .replace(/\b(deadline|how to apply|salary)\b.*$/i, '')
          .replace(/\s+/g, ' ')
          .replace(/[.;,\s]+$/, '')
          .trim();
        if (value.length >= 2) return value;
      }
    }
    return null;
  }

  private deadline(body: string): Date | null {
    const raw = this.field(body, ['deadline', 'closing date', 'application deadline']);
    if (!raw) return null;
    const cleaned = raw.replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
    // "November 9, 2026" is a calendar date, not a moment: build it in UTC so
    // running the collector in Addis or in CI yields the same day.
    const m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(cleaned);
    if (m) {
      const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (month !== undefined) {
        const date = new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
        if (!Number.isNaN(date.getTime())) return date;
      }
    }
    const parsed = new Date(cleaned);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
