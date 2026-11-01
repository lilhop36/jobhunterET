/**
 * ElelanaJobs RSS adapter — fixture test.
 *
 * The fixture is a trimmed capture of https://elelanajobs.com/feed/ (2026-11-01):
 * two Ethiopian posts, one of which advertises several positions, plus a foreign
 * post so the eligibility hand-off is exercised here as well as in the policy spec.
 */

import { ElelanaJobsAdapter } from './elelanajobs.adapter';
import { evaluateEthiopiaEligibility } from '../../eligibility/ethiopia-eligibility';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Elelanajobs.com</title>
  <item>
    <title>Kebron Hill Micro finance Institute S.C</title>
    <link>https://elelanajobs.com/2026/10/31/kebron-hill-micro-finance-institute-s-c/</link>
    <pubDate>Sat, 31 Oct 2026 11:51:55 +0000</pubDate>
    <guid isPermaLink="false">https://elelanajobs.com/?p=48053</guid>
    <content:encoded><![CDATA[
      <p><strong>Job Position-1 Branch Manager “D”</strong></p>
      <p><strong>Required Qualification and Experience</strong><br>Education: Bachelor in Banking.</p>
      <p><strong>Job Position-2 Trainee Junior Customer Service Officer</strong></p>
      <p><strong>Required Qualification and Experience</strong><br>Education: BA in Management.</p>
      <p><strong>Place of Work:</strong> Branch Offices, Addis Ababa<br>Deadline : November 9th, 2026</p>
      <p><strong>How To Apply</strong> email HR@kebronmfi.com</p>
    ]]></content:encoded>
  </item>
  <item>
    <title>ZamZam Bank</title>
    <link>https://elelanajobs.com/2026/10/31/zamzam-bank-43/</link>
    <pubDate>Sat, 31 Oct 2026 08:20:17 +0000</pubDate>
    <guid isPermaLink="false">https://elelanajobs.com/?p=48049</guid>
    <content:encoded><![CDATA[
      <p><strong>Job Position &#8211; 1 Junior Banking Business Officer</strong></p>
      <p><strong>Required Qualification and Experience</strong><br>Education: BA in Business.</p>
      <p><strong>Duty Stations:</strong> Delomena, Yebbu and Ginir Branches (Re-advertised)</p>
      <p><strong>Deadline :</strong> November 6th, 2026</p>
    ]]></content:encoded>
  </item>
  <item>
    <title>Regional NGO Liaison</title>
    <link>https://elelanajobs.com/2026/10/30/regional-ngo-liaison/</link>
    <pubDate>Fri, 30 Oct 2026 09:00:00 +0000</pubDate>
    <guid isPermaLink="false">https://elelanajobs.com/?p=48030</guid>
    <content:encoded><![CDATA[
      <p><strong>Job Position-1 Regional Liaison Officer</strong></p>
      <p><strong>Location:</strong> Nairobi, Kenya</p>
      <p><strong>Deadline :</strong> November 20th, 2026</p>
    ]]></content:encoded>
  </item>
  <item>
    <title>Old Posting</title>
    <link>https://elelanajobs.com/2026/01/01/old-posting/</link>
    <pubDate>Thu, 01 Jan 2026 09:00:00 +0000</pubDate>
    <guid isPermaLink="false">https://elelanajobs.com/?p=40000</guid>
    <content:encoded><![CDATA[<p><strong>Job Position-1 Accountant</strong></p><p><strong>Location:</strong> Addis Ababa</p>]]></content:encoded>
  </item>
</channel>
</rss>`;

function mockFeed(body: string, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  });
}

const adapter = new ElelanaJobsAdapter();
const since = new Date('2026-10-15T00:00:00Z');

describe('ElelanaJobsAdapter', () => {
  beforeEach(() => jest.resetAllMocks());

  it('turns each advertised position into its own job', async () => {
    mockFeed(FEED_XML);
    const jobs = await adapter.fetchJobs({ since });

    const kebron = jobs.filter((j) => j.company === 'Kebron Hill Micro finance Institute S.C');
    expect(kebron.map((j) => j.title)).toEqual([
      'Branch Manager “D”',
      'Trainee Junior Customer Service Officer',
    ]);
    // stable, distinct ids so neither position overwrites the other
    expect(new Set(kebron.map((j) => j.sourceJobId)).size).toBe(2);
    expect(kebron[0].sourceJobId).toBe('48053-p1');
    expect(kebron[1].sourceJobId).toBe('48053-p2');
  });

  it('reads the labelled location and deadline instead of guessing', async () => {
    mockFeed(FEED_XML);
    const jobs = await adapter.fetchJobs({ since });

    const branch = jobs.find((j) => j.title === 'Branch Manager “D”')!;
    expect(branch.location).toBe('Branch Offices, Addis Ababa');
    expect(branch.locationClass).toBe('ETHIOPIA_LOCAL');
    expect(branch.country).toBe('Ethiopia');
    expect(branch.deadline?.toISOString().slice(0, 10)).toBe('2026-11-09');
    expect(branch.url).toBe(
      'https://elelanajobs.com/2026/10/31/kebron-hill-micro-finance-institute-s-c/',
    );
  });

  it('recognises a regional duty station as Ethiopian', async () => {
    mockFeed(FEED_XML);
    const jobs = await adapter.fetchJobs({ since });

    const regional = jobs.find((j) => j.company === 'ZamZam Bank')!;
    expect(regional.location).toBe('Delomena, Yebbu and Ginir Branches');
    expect(regional.locationClass).toBe('ETHIOPIA_LOCAL');
    expect(regional.deadline?.toISOString().slice(0, 10)).toBe('2026-11-06');
  });

  it('hands a foreign post to the policy as foreign, not as Ethiopian', async () => {
    mockFeed(FEED_XML);
    const jobs = await adapter.fetchJobs({ since });

    const foreign = jobs.find((j) => j.company === 'Regional NGO Liaison')!;
    expect(foreign.location).toBe('Nairobi, Kenya');
    expect(foreign.country).toBeUndefined();
    expect(foreign.locationClass).toBe('INTERNATIONAL_ONSITE');
    expect(evaluateEthiopiaEligibility(foreign).status).toBe('REJECTED');
  });

  it('drops postings older than the freshness window', async () => {
    mockFeed(FEED_XML);
    const jobs = await adapter.fetchJobs({ since });

    expect(jobs.some((j) => j.company === 'Old Posting')).toBe(false);
    expect(jobs.length).toBe(4); // 2 Kebron positions + ZamZam + foreign
  });

  it('leaves an unlabelled location unknown so the policy holds it for review', async () => {
    mockFeed(`<?xml version="1.0"?><rss><channel><item>
      <title>Unlabelled Employer</title>
      <link>https://elelanajobs.com/2026/10/31/unlabelled/</link>
      <pubDate>Sat, 31 Oct 2026 11:00:00 +0000</pubDate>
      <guid>https://elelanajobs.com/?p=1</guid>
      <content:encoded><![CDATA[<p><strong>Job Position-1 Driver</strong></p>]]></content:encoded>
    </item></channel></rss>`);

    const [job] = await adapter.fetchJobs({ since });
    expect(job.location).toBe('Unknown');
    expect(evaluateEthiopiaEligibility(job).status).toBe('REVIEW');
  });

  it('fails loudly when the feed is unavailable', async () => {
    mockFeed('nope', 503);
    await expect(adapter.fetchJobs({ since })).rejects.toThrow('ElelanaJobs feed responded 503');
  });
});
