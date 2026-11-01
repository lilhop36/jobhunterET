/* Shared, dependency-free RSS parsing for feed-based sources.
 *
 * Two adapters read RSS (ReliefWeb, ElelanaJobs) and both need the same
 * forgiving item parser: WordPress feeds wrap titles in CDATA, put the body in
 * <content:encoded>, and disagree on <guid>. Keeping one parser here means a
 * malformed feed is fixed once. Fetching stays with each adapter because
 * ReliefWeb needs Node's https module for its TLS fingerprint.
 */

export interface RssItem {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  description: string;
  content: string;
  categories: string[];
}

const cdata = (value: string) => value.replace(/<!\[CDATA\[|\]\]>/g, '').trim();

/** Split an RSS document into items. Returns [] for a feed with no items. */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml || ''))) {
    const block = m[1];
    const grab = (tag: string) => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
      return r ? cdata(r[1]) : '';
    };
    const title = grab('title');
    const link = grab('link') || grab('guid');
    if (!title || !link) continue;
    items.push({
      title,
      link,
      guid: grab('guid'),
      pubDate: grab('pubDate'),
      description: grab('description'),
      content: grab('content:encoded'),
      categories: [...block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((c) => cdata(c[1])),
    });
  }
  return items;
}

/** Strip tags and decode the handful of entities Ethiopian boards actually use. */
export function feedText(html: string): string {
  return cdata(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
