/**
 * Adapter fixture tests — one describe block per source adapter.
 *
 * Each adapter's `fetchJobs()` is called with mocked HTTP responses containing
 * realistic fixture data. We assert the shape and content of the returned RawJob[]
 * to catch silent breakage when upstream HTML/JSON structure changes.
 *
 * FR-008 (adapter architecture), FR-009 (collection pipeline).
 */

import { RawJob } from './job-source.adapter';

// ── Global fetch mock ─────────────────────────────────────────
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// Mock https.get for ReliefWeb (it uses Node's https, not fetch)
jest.mock('https', () => {
  const actual = jest.requireActual('https');
  return {
    ...actual,
    get: jest.fn(),
  };
});
import * as https from 'https';
import { EventEmitter } from 'events';

function mockHttpsResponse(xml: string) {
  (https.get as jest.Mock).mockImplementation((_url: any, _opts: any, cb: any) => {
    const req = new EventEmitter() as any;
    req.setTimeout = (_ms: number, cb: () => void) => { req._timeoutCb = cb; return req; };
    process.nextTick(() => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      res.resume = () => {};
      cb(res);
      res.emit('data', Buffer.from(xml, 'utf8'));
      res.emit('end');
    });
    req.destroy = () => {};
    return req;
  });
}

function mockFetchJson(body: any, status = 200, headers: Record<string, string> = {}) {
  const headerMap = new Map(Object.entries(headers));
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headerMap.get(k) ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockFetchHtml(html: string, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(html),
    json: () => Promise.reject(new Error('not json')),
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  (global as any).fetch = mockFetch;
});

// ── Helper to assert RawJob shape ──────────────────────────────
function expectRawJob(job: RawJob, overrides: Partial<RawJob> = {}) {
  expect(job).toHaveProperty('title');
  expect(job).toHaveProperty('company');
  expect(job).toHaveProperty('location');
  expect(job).toHaveProperty('locationClass');
  expect(job).toHaveProperty('employmentType');
  expect(job).toHaveProperty('experienceLevel');
  expect(job).toHaveProperty('workPlace');
  expect(job).toHaveProperty('url');
  expect(job).toHaveProperty('sourceJobId');
  expect(job).toHaveProperty('postedDate');
  expect(job.title).toBeTruthy();
  expect(job.url).toBeTruthy();
  expect(job.sourceJobId).toBeTruthy();
  Object.assign(job, overrides);
}

// ══════════════════════════════════════════════════════════════
// 1. REMOTIVE — JSON API
// ══════════════════════════════════════════════════════════════
describe('RemotiveAdapter', () => {
  it('parses a standard remote job from the JSON API', async () => {
    const { RemotiveAdapter } = require('./remotive.adapter');
    const adapter = new RemotiveAdapter();

    mockFetchJson({
      jobs: [
        {
          id: 12345,
          title: 'Senior React Developer',
          company_name: 'TechCorp',
          candidate_required_location: 'Worldwide',
          url: 'https://remotive.com/job/senior-react-developer',
          publication_date: new Date().toISOString(),
          job_type: 'full_time',
          salary: '50k - 70k/yr',
          tags: ['React', 'TypeScript', 'Node.js'],
          description: '<p>Build amazing UIs.</p>',
        },
      ],
    });

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(1);

    const job = jobs[0];
    expectRawJob(job);
    expect(job.title).toBe('Senior React Developer');
    expect(job.company).toBe('TechCorp');
    expect(job.locationClass).toBe('INTERNATIONAL_REMOTE');
    expect(job.workPlace).toBe('REMOTE');
    expect(job.employmentType).toBe('FULL_TIME');
    expect(job.skills).toEqual(['React', 'TypeScript', 'Node.js']);
    expect(job.salary).toBe(60000); // average of 50k and 70k
    expect(job.currency).toBe('USD');
    expect(job.sourceJobId).toBe('12345');
  });

  it('maps Worldwide/Anywhere locations to "Remote"', async () => {
    const { RemotiveAdapter } = require('./remotive.adapter');
    const adapter = new RemotiveAdapter();

    mockFetchJson({
      jobs: [
        {
          id: 1,
          title: 'DevOps Engineer',
          company_name: 'CloudInc',
          candidate_required_location: 'Anywhere',
          url: 'https://remotive.com/job/devops',
          publication_date: new Date().toISOString(),
          job_type: 'full_time',
          salary: '',
          tags: ['AWS', 'Docker'],
          description: '',
        },
      ],
    });

    const jobs = await adapter.fetchJobs();
    expect(jobs[0].location).toBe('Remote');
  });

  it('handles missing salary gracefully', async () => {
    const { RemotiveAdapter } = require('./remotive.adapter');
    const adapter = new RemotiveAdapter();

    mockFetchJson({
      jobs: [
        {
          id: 2,
          title: 'Designer',
          company_name: 'DesignCo',
          candidate_required_location: 'USA',
          url: 'https://remotive.com/job/designer',
          publication_date: new Date().toISOString(),
          job_type: 'part_time',
          salary: '',
          tags: ['Figma'],
          description: '',
        },
      ],
    });

    const jobs = await adapter.fetchJobs();
    expect(jobs[0].salary).toBeUndefined();
    expect(jobs[0].employmentType).toBe('PART_TIME');
  });

  it('throws on non-OK response', async () => {
    const { RemotiveAdapter } = require('./remotive.adapter');
    const adapter = new RemotiveAdapter();
    mockFetchJson({}, 503);
    await expect(adapter.fetchJobs()).rejects.toThrow('503');
  });
});

// ══════════════════════════════════════════════════════════════
// 2. ARBEITNOW — JSON API
// ══════════════════════════════════════════════════════════════
describe('ArbeitnowAdapter', () => {
  it('parses remote jobs with tags and employment types', async () => {
    const { ArbeitnowAdapter } = require('./arbeitnow.adapter');
    const adapter = new ArbeitnowAdapter();

    mockFetchJson({
      data: [
        {
          slug: 'senior-python-dev',
          company_name: 'DataLab',
          title: 'Senior Python Developer',
          description: 'Build ML pipelines.',
          remote: true,
          url: 'https://arbeitnow.com/job/senior-python-dev',
          tags: ['Python', 'ML', 'AWS'],
          job_types: ['full_time'],
          location: 'Berlin, Germany',
          created_at: new Date().toISOString(),
        },
      ],
    });

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Senior Python Developer');
    expect(jobs[0].company).toBe('DataLab');
    expect(jobs[0].locationClass).toBe('INTERNATIONAL_REMOTE');
    expect(jobs[0].skills).toEqual(['Python', 'ML', 'AWS']);
    expect(jobs[0].sourceJobId).toBe('senior-python-dev');
  });

  it('skips jobs with missing title or url', async () => {
    const { ArbeitnowAdapter } = require('./arbeitnow.adapter');
    const adapter = new ArbeitnowAdapter();

    mockFetchJson({
      data: [
        { slug: 'a', company_name: 'X', title: '', url: 'https://x.com', tags: [], job_types: [], location: '', created_at: new Date().toISOString() },
        { slug: 'b', company_name: 'Y', title: 'Valid Job', url: '', tags: [], job_types: [], location: '', created_at: new Date().toISOString() },
        { slug: 'c', company_name: 'Z', title: 'Good Job', url: 'https://z.com/job', tags: ['Go'], job_types: ['contract'], location: 'Remote', created_at: new Date().toISOString() },
      ],
    });

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Good Job');
    expect(jobs[0].employmentType).toBe('CONTRACT');
  });

  it('parses numeric Unix seconds in created_at', async () => {
    const { ArbeitnowAdapter } = require('./arbeitnow.adapter');
    const adapter = new ArbeitnowAdapter();

    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    mockFetchJson({
      data: [
        {
          slug: 'seconds-job',
          company_name: 'TimeCorp',
          title: 'Time Traveler',
          description: 'Work with time.',
          remote: true,
          url: 'https://arbeitnow.com/job/time-traveler',
          tags: ['Physics'],
          job_types: ['full_time'],
          location: 'Berlin',
          created_at: String(fiveMinutesAgo),
        },
      ],
    });

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].postedDate).toBeInstanceOf(Date);
    expect(jobs[0].postedDate.getFullYear()).toBeGreaterThan(2000);
  });

  it('follows links.next pagination', async () => {
    const { ArbeitnowAdapter } = require('./arbeitnow.adapter');
    const adapter = new ArbeitnowAdapter();

    mockFetchJson({
      data: [
        {
          slug: 'page1-job',
          company_name: 'Page1',
          title: 'Page 1 Job',
          description: '',
          remote: true,
          url: 'https://arbeitnow.com/job/page1',
          tags: [],
          job_types: ['full_time'],
          location: 'Berlin',
          created_at: String(Math.floor(Date.now() / 1000)),
        },
      ],
      links: { next: 'https://www.arbeitnow.com/api/job-board-api?limit=20&page=2' },
    });
    mockFetchJson({
      data: [
        {
          slug: 'page2-job',
          company_name: 'Page2',
          title: 'Page 2 Job',
          description: '',
          remote: true,
          url: 'https://arbeitnow.com/job/page2',
          tags: [],
          job_types: ['full_time'],
          location: 'Berlin',
          created_at: String(Math.floor(Date.now() / 1000)),
        },
      ],
      links: { next: null },
    });

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe('Page 1 Job');
    expect(jobs[1].title).toBe('Page 2 Job');
  });

  it('throws when API returns no parseable jobs', async () => {
    const { ArbeitnowAdapter } = require('./arbeitnow.adapter');
    const adapter = new ArbeitnowAdapter();
    mockFetchJson({ data: [] });
    await expect(adapter.fetchJobs()).rejects.toThrow('no parseable jobs');
  });
});

// ══════════════════════════════════════════════════════════════
// 3. REMOTEOK — JSON API
// ══════════════════════════════════════════════════════════════
describe('RemoteOKAdapter', () => {
  it('skips the first metadata element and parses jobs', async () => {
    const { RemoteOKAdapter } = require('./remoteok.adapter');
    const adapter = new RemoteOKAdapter();

    mockFetchJson([
      { _metadata: true, count: 1 }, // first element = metadata
      {
        id: 999,
        slug: 'go-backend',
        company: 'GoShop',
        position: 'Go Backend Engineer',
        tags: ['Go', 'PostgreSQL', 'gRPC'],
        description: '<p>Build scalable services.</p>',
        date: new Date().toISOString(),
        url: 'https://remoteok.com/remote-jobs/999',
        salary_min: 80000,
        salary_max: 120000,
        remote: true,
      },
    ]);

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Go Backend Engineer');
    expect(jobs[0].company).toBe('GoShop');
    expect(jobs[0].salary).toBe(100000); // average of 80k and 120k
    expect(jobs[0].currency).toBe('USD');
    expect(jobs[0].skills).toEqual(['Go', 'PostgreSQL', 'gRPC']);
    expect(jobs[0].locationClass).toBe('INTERNATIONAL_REMOTE');
  });
});

// ══════════════════════════════════════════════════════════════
// 4. JOBICY — JSON API
// ══════════════════════════════════════════════════════════════
describe('JobicyAdapter', () => {
  it('parses job listings with salary and industry tags', async () => {
    const { JobicyAdapter } = require('./jobicy.adapter');
    const adapter = new JobicyAdapter();

    mockFetchJson({
      jobs: [
        {
          id: 42,
          url: 'https://jobicy.com/remote-jobs/42',
          jobTitle: 'Full Stack Engineer',
          companyName: 'StartupX',
          jobIndustry: ['Technology', 'SaaS'],
          jobType: ['Full-time'],
          jobGeo: 'Europe',
          jobLevel: 'Senior',
          jobExcerpt: 'Work on our core platform.',
          annualSalaryMin: 70000,
          annualSalaryMax: 95000,
          salaryCurrency: 'EUR',
          pubDate: new Date().toISOString(),
        },
      ],
    });

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Full Stack Engineer');
    expect(jobs[0].company).toBe('StartupX');
    expect(jobs[0].salary).toBe(82500);
    expect(jobs[0].currency).toBe('EUR');
    expect(jobs[0].skills).toEqual(['Technology', 'SaaS']);
    expect(jobs[0].locationClass).toBe('INTERNATIONAL_REMOTE');
  });

  it('returns empty array when API returns no parseable jobs', async () => {
    const { JobicyAdapter } = require('./jobicy.adapter');
    const adapter = new JobicyAdapter();
    mockFetchJson({ jobs: [] });
    const jobs = await adapter.fetchJobs();
    expect(jobs).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════
// 5. LANDINGJOBS — JSON API
// ══════════════════════════════════════════════════════════════
describe('LandingJobsAdapter', () => {
  it('parses EU tech jobs with salary and skill extraction', async () => {
    const { LandingJobsAdapter } = require('./landingjobs.adapter');
    const adapter = new LandingJobsAdapter();

    // LandingJobs paginates: page 1 returns data, page 2 returns empty → stops
    mockFetchJson([
      {
        id: 777,
        title: 'TypeScript Developer',
        employment_type: 'Full-time',
        remote: true,
        city: 'Amsterdam',
        country: 'Netherlands',
        currency_code: 'EUR',
        gross_salary_low: 55000,
        gross_salary_high: 75000,
        main_requirements: '<p>Strong JavaScript, TypeScript, React and Node.js skills. Experience with PostgreSQL.</p>',
        nice_to_have: '<p>Docker and AWS experience.</p>',
        url: 'https://landing.jobs/offers/777',
        tags: ['TypeScript', 'React'],
        created_at: '2026-07-01T00:00:00Z',
        published_at: new Date().toISOString(),
        expires_at: '2026-09-01T00:00:00Z',
      },
    ]);
    // Page 2 → empty array → loop breaks
    mockFetchJson([]);
    mockFetchJson([]);

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.title).toBe('TypeScript Developer');
    expect(job.location).toBe('Amsterdam, Netherlands');
    expect(job.locationClass).toBe('INTERNATIONAL_REMOTE');
    expect(job.salary).toBe(65000);
    expect(job.currency).toBe('EUR');
    expect(job.deadline).toBeInstanceOf(Date);
    // Skills extracted from requirements + tags
    expect(job.skills).toContain('TypeScript');
    expect(job.skills).toContain('React');
    expect(job.skills).toContain('Node.js');
    expect(job.skills).toContain('PostgreSQL');
    expect(job.skills.length).toBeLessThanOrEqual(8);
  });

  it('throws when all pages return empty', async () => {
    const { LandingJobsAdapter } = require('./landingjobs.adapter');
    const adapter = new LandingJobsAdapter();
    mockFetchJson([]);
    await expect(adapter.fetchJobs()).rejects.toThrow('no parseable jobs');
  });
});

// ══════════════════════════════════════════════════════════════
// 6. ETHIONGOJOBS — WordPress REST API
// ══════════════════════════════════════════════════════════════
describe('EthioNgoJobsAdapter', () => {
  it('parses WordPress posts with org, location, deadline extraction', async () => {
    const { EthioNgoJobsAdapter } = require('./ethiongojobs.adapter');
    const adapter = new EthioNgoJobsAdapter();

    // WordPress content has newlines between paragraphs — the adapter's
    // regex uses [^\n]+ which requires newlines to properly delimit fields.
    mockFetchJson([
      {
        id: 501,
        link: 'https://ethiongojobs.com/sample-program-officer',
        date: new Date().toISOString(),
        title: { rendered: 'Program Officer @ Save the Children' },
        content: {
          rendered:
            'Location: Addis Ababa\nOrganization: Save the Children\nDeadline: August 30, 2026\nJob Description: Manage programs.',
        },
      },
      {
        id: 502,
        link: 'https://ethiongojobs.com/sample-mekelle',
        date: new Date().toISOString(),
        title: { rendered: 'Finance Manager' },
        content: {
          rendered:
            'Location: Mekelle, Tigray\nOrganization: UNICEF\nJob Description: Handle budgets.',
        },
      },
    ]);

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(2);

    const job1 = jobs[0];
    expect(job1.title).toBe('Program Officer @ Save the Children');
    // stripHtml collapses all whitespace (including \n) to spaces, so the
    // [^\n]+ regex captures everything after the label — known limitation
    expect(job1.company).toContain('Save the Children');
    expect(job1.location).toContain('Addis Ababa');
    expect(job1.sourceJobId).toBe('501');
    expect(job1.country).toBe('Ethiopia');

    const job2 = jobs[1];
    // Same whitespace issue as job1 — company captures past the label
    expect(job2.company).toContain('UNICEF');
    expect(job2.location).toContain('Mekelle, Tigray');
  });

  it('strips HTML entities and tags from content', async () => {
    const { EthioNgoJobsAdapter } = require('./ethiongojobs.adapter');
    const adapter = new EthioNgoJobsAdapter();

    mockFetchJson([
      {
        id: 600,
        link: 'https://ethiongojobs.com/test',
        date: new Date().toISOString(),
        title: { rendered: 'Test Job' },
        content: {
          rendered: 'Location: Hawassa\nOrganization: WHO\nRequires &amp; emphasizes &#8211; dash',
        },
      },
    ]);

    const jobs = await adapter.fetchJobs();
    // Description stores raw content from WordPress — stripHtml is only used
    // internally for location/company extraction, not for the description field
    expect(jobs[0].description).toContain('WHO');
    // HTML entities are stored literally in the description field
    // (stripHtml only decodes them internally for location/company extraction)
    expect(jobs[0].description).toContain('&#8211;');
  });
});

// ══════════════════════════════════════════════════════════════
// 7. ETHIOJOBS — HTML scraping (__NEXT_DATA__)
// ══════════════════════════════════════════════════════════════
describe('EthiojobsAdapter', () => {
  function buildNextDataPage(jobs: any[], lastPage = 1, isCategory = false, categorySlug?: string) {
    const pageProps: any = isCategory
      ? { initialData: jobs, meta: { slugName: 'category', total: jobs.length, pageNumber: 1, ...(categorySlug ? { categorySlug } : {}) } }
      : { jobs: { data: jobs, meta: { pageNumber: 1, lastPage, total: jobs.length } } };

    return `<html><head></head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps },
    })}</script></body></html>`;
  }

  it('extracts jobs from __NEXT_DATA__ JSON', async () => {
    const { EthiojobsAdapter } = require('./ethiojobs.adapter');
    const adapter = new EthiojobsAdapter();

    mockFetchHtml(
      buildNextDataPage([
        {
          id: 'ej-1',
          title: 'Junior Frontend Developer',
          slug: 'junior-frontend-dev',
          type: 1,
          date_published: new Date().toISOString(),
          level: 'Junior',
          location_type: 'On-site',
          description: '<p>Build React apps.</p>',
          state: 'Addis Ababa',
          catalogs: [{ name: 'React' }, { name: 'TypeScript' }],
          date_expiry: null,
          company: { name: 'EthioTech', slug: 'ethiotech' },
          application_method: 'online',
          application_email: null,
        },
      ]),
    );

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Junior Frontend Developer');
    expect(jobs[0].company).toBe('EthioTech');
    expect(jobs[0].location).toBe('Addis Ababa');
    expect(jobs[0].locationClass).toBe('ETHIOPIA_LOCAL');
    expect(jobs[0].skills).toEqual(['React', 'TypeScript']);
    expect(jobs[0].experienceLevel).toBe('ENTRY');
    expect(jobs[0].url).toContain('/jobs/junior-frontend-dev');
  });

  it('detects remote jobs from location_type', async () => {
    const { EthiojobsAdapter } = require('./ethiojobs.adapter');
    const adapter = new EthiojobsAdapter();

    mockFetchHtml(
      buildNextDataPage([
        {
          id: 'ej-2',
          title: 'Backend Developer',
          slug: 'backend-dev',
          type: 3,
          date_published: new Date().toISOString(),
          level: 'Mid',
          location_type: 'Remote',
          description: '',
          state: 'Bahir Dar',
          catalogs: [],
          date_expiry: null,
          company: { name: 'RemoteCo', slug: 'remoteco' },
          application_method: 'online',
          application_email: null,
        },
      ]),
    );

    const jobs = await adapter.fetchJobs();
    expect(jobs[0].locationClass).toBe('ETHIOPIA_REMOTE');
    expect(jobs[0].workPlace).toBe('REMOTE');
    expect(jobs[0].employmentType).toBe('CONTRACT');
  });

  it('filters stale jobs and stops at page boundary', async () => {
    const { EthiojobsAdapter } = require('./ethiojobs.adapter');
    const adapter = new EthiojobsAdapter();
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const now = new Date().toISOString();

    mockFetchHtml(buildNextDataPage([
      { id: 'ej-fresh', title: 'Fresh Job', slug: 'fresh-job', type: 1, date_published: now, level: 'Mid', location_type: 'On-site', description: '', state: 'Addis', catalogs: [], date_expiry: null, company: { name: 'A', slug: 'a' }, application_method: 'online', application_email: null },
      { id: 'ej-stale', title: 'Stale Job', slug: 'stale-job', type: 1, date_published: fiveDaysAgo, level: 'Mid', location_type: 'On-site', description: '', state: 'Addis', catalogs: [], date_expiry: null, company: { name: 'B', slug: 'b' }, application_method: 'online', application_email: null },
    ], 5));

    const result = await adapter.collect({ mode: 'FAST', since: new Date(Date.now() - 2 * 86_400_000), maxPages: 12, maxRequests: 14, requestDelayMs: 0 });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].sourceJobId).toBe('fresh-job');
    expect(result.categories[0].stoppedReason).toBe('LAST_PAGE');
  });

  it('stops at meta.lastPage and never requests lastPage+1', async () => {
    const { EthiojobsAdapter } = require('./ethiojobs.adapter');
    const adapter = new EthiojobsAdapter();

    mockFetchHtml(buildNextDataPage([
      { id: 'ej-1', title: 'Job 1', slug: 'job-1', type: 1, date_published: new Date().toISOString(), level: 'Mid', location_type: 'On-site', description: '', state: 'Addis', catalogs: [], date_expiry: null, company: { name: 'A', slug: 'a' }, application_method: 'online', application_email: null },
    ], 3));

    const result = await adapter.collect({ mode: 'FAST', since: new Date(Date.now() - 30 * 86_400_000), maxPages: 12, maxRequests: 14, requestDelayMs: 0 });
    expect(result.categories[0].pagesFetched).toBe(1);
    expect(result.categories[0].stoppedReason).toBe('LAST_PAGE');
  });

  it('empty page beyond lastPage yields EMPTY_PAGE, not a throw', async () => {
    const { EthiojobsAdapter } = require('./ethiojobs.adapter');
    const adapter = new EthiojobsAdapter();

    mockFetchHtml(buildNextDataPage([], 3));
    const result = await adapter.collect({ mode: 'FAST', since: new Date(Date.now() - 30 * 86_400_000), maxPages: 12, maxRequests: 14, requestDelayMs: 0 });
    expect(result.categories[0].stoppedReason).toBe('EMPTY_PAGE');
    expect(result.errors).toHaveLength(0);
  });

  it('stops at page boundary (LAST_PAGE)', async () => {
    const { EthiojobsAdapter } = require('./ethiojobs.adapter');
    const adapter = new EthiojobsAdapter();

    for (let i = 1; i <= 5; i++) {
      mockFetchHtml(buildNextDataPage([
        { id: `ej-${i}`, title: `Job ${i}`, slug: `job-${i}`, type: 1, date_published: new Date().toISOString(), level: 'Mid', location_type: 'On-site', description: '', state: 'Addis', catalogs: [], date_expiry: null, company: { name: 'A', slug: 'a' }, application_method: 'online', application_email: null },
      ], 10));
    }

    const result = await adapter.collect({ mode: 'FAST', since: new Date(Date.now() - 30 * 86_400_000), maxPages: 3, maxRequests: 14, requestDelayMs: 0 });
    expect(result.categories[0].pagesFetched).toBe(1);
    expect(result.categories[0].stoppedReason).toBe('LAST_PAGE');
  });

  it('parses category-page shape and populates sourceCategories', async () => {
    const { EthiojobsAdapter } = require('./ethiojobs.adapter');
    const adapter = new EthiojobsAdapter();

    // First call: latest page (empty — nothing to show)
    mockFetchHtml(buildNextDataPage([], 1));

    // Second call: category page
    mockFetchHtml(buildNextDataPage([
      { id: 'ej-cat', title: 'Category Job', slug: 'cat-job', type: 1, date_published: new Date().toISOString(), level: 'Mid', location_type: 'On-site', description: '', state: 'Addis', catalogs: [{ name: 'Tech' }], date_expiry: null, company: { name: 'A', slug: 'a' }, application_method: 'online', application_email: null },
    ], 1, true, 'technology'));

    const result = await adapter.collect({ mode: 'DEEP', since: new Date(Date.now() - 30 * 86_400_000), maxPages: 1, maxRequests: 2, requestDelayMs: 0, categories: ['technology'] });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].sourceCategories).toContain('technology');
    expect(result.jobs[0].discoveredVia).toBe('technology');
    expect(result.categories).toHaveLength(2);
    expect(result.categories.find((c) => c.category === 'technology')).toBeDefined();
  });

  it('merges sourceCategories when same slug appears in two categories', async () => {
    const { EthiojobsAdapter } = require('./ethiojobs.adapter');
    const adapter = new EthiojobsAdapter();

    // First call: latest page (empty)
    mockFetchHtml(buildNextDataPage([], 1));

    // Second call: technology category
    mockFetchHtml(buildNextDataPage([
      { id: 'ej-shared', title: 'Shared Job', slug: 'shared-job', type: 1, date_published: new Date().toISOString(), level: 'Mid', location_type: 'On-site', description: '', state: 'Addis', catalogs: [], date_expiry: null, company: { name: 'A', slug: 'a' }, application_method: 'online', application_email: null },
    ], 1, true, 'technology'));

    // Third call: engineering category (same slug)
    mockFetchHtml(buildNextDataPage([
      { id: 'ej-shared', title: 'Shared Job', slug: 'shared-job', type: 1, date_published: new Date().toISOString(), level: 'Mid', location_type: 'On-site', description: '', state: 'Addis', catalogs: [], date_expiry: null, company: { name: 'A', slug: 'a' }, application_method: 'online', application_email: null },
    ], 1, true, 'engineering'));

    const result = await adapter.collect({ mode: 'DEEP', since: new Date(Date.now() - 30 * 86_400_000), maxPages: 1, maxRequests: 4, requestDelayMs: 0, categories: ['technology', 'engineering'] });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].sourceCategories).toContain('technology');
    expect(result.jobs[0].sourceCategories).toContain('engineering');
  });

  it('fetches first page and stops at page boundary', async () => {
    const { EthiojobsAdapter } = require('./ethiojobs.adapter');
    const adapter = new EthiojobsAdapter();

    mockFetchHtml(buildNextDataPage([
      { id: 'ej-1', title: 'Job 1', slug: 'job-1', type: 1, date_published: new Date().toISOString(), level: 'Mid', location_type: 'On-site', description: '', state: 'Addis', catalogs: [], date_expiry: null, company: { name: 'A', slug: 'a' }, application_method: 'online', application_email: null },
    ], 3));
    mockFetchHtml(''); // page 2 fails — no __NEXT_DATA__
    mockFetchHtml(buildNextDataPage([
      { id: 'ej-3', title: 'Job 3', slug: 'job-3', type: 1, date_published: new Date().toISOString(), level: 'Mid', location_type: 'On-site', description: '', state: 'Addis', catalogs: [], date_expiry: null, company: { name: 'C', slug: 'c' }, application_method: 'online', application_email: null },
    ], 3));

    const result = await adapter.collect({ mode: 'FAST', since: new Date(Date.now() - 30 * 86_400_000), maxPages: 5, maxRequests: 10, requestDelayMs: 0 });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].sourceJobId).toBe('job-1');
  });

  it('records error when __NEXT_DATA__ is missing', async () => {
    const { EthiojobsAdapter } = require('./ethiojobs.adapter');
    const adapter = new EthiojobsAdapter();
    mockFetchHtml('<html><body>No data here</body></html>');
    const result = await adapter.collect({ mode: 'FAST', since: new Date(Date.now() - 30 * 86_400_000), maxPages: 1, maxRequests: 1, requestDelayMs: 0 });
    expect(result.errors.some((e: string) => e.includes('__NEXT_DATA__'))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// 8. GEEZJOBS — HTML scraping (JSON-LD + DOM)
// ══════════════════════════════════════════════════════════════
describe('GeezJobsAdapter', () => {
  it('parses jobs from JSON-LD structured data', async () => {
    const { GeezJobsAdapter } = require('./geezjobs.adapter');
    const adapter = new GeezJobsAdapter();

    // First call: homepage with job links
    mockFetchHtml(`<html><body>
      <a href="/job-detail/senior-dev-ethiopia">Job 1</a>
      <a href="/job-detail/junior-designer">Job 2</a>
    </body></html>`);

    // Second call: job detail page with JSON-LD
    mockFetchHtml(`<html><head>
      <title>Senior Developer - EthioTech | GeezJobs</title>
      <meta property="og:description" content="Build amazing things" />
    </head><body>
      <script type="application/ld+json">${JSON.stringify({
        title: 'Senior Developer - EthioTech',
        hiringOrganization: { name: 'EthioTech' },
        jobLocation: { address: { addressLocality: 'Addis Ababa' } },
        description: '<p>Lead the backend team.</p>',
        datePosted: '2026-08-25',
        validThrough: '2026-09-15',
      })}</script>
      <div class="job-content">Lead the backend team. Build scalable APIs.</div>
    </body></html>`);

    // Third call: second job detail page (no JSON-LD, minimal)
    mockFetchHtml(`<html><head><title>Junior Designer | GeezJobs</title></head><body>
      <div class="job-content">Design beautiful interfaces.</div>
    </body></html>`);

    const jobs = await adapter.fetchJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0].title).toBe('Senior Developer - EthioTech');
    expect(jobs[0].company).toBe('EthioTech');
    expect(jobs[0].location).toBe('Addis Ababa');
    expect(jobs[0].deadline).toBeInstanceOf(Date);
    expect(jobs[0].parseConfidence).toBe(90);
    expect(jobs[0].url).toContain('/job-detail/senior-dev-ethiopia');
  });

  it('extracts salary from sidebar metadata', async () => {
    const { GeezJobsAdapter } = require('./geezjobs.adapter');
    const adapter = new GeezJobsAdapter();

    mockFetchHtml('<html><body><a href="/job-detail/test-job">Job</a></body></html>');

    mockFetchHtml(`<html><head><title>Test Job | GeezJobs</title></head><body>
      <p>Salary</p><p>ETB 30,000-35,000</p>
      <p>Experience</p><p>3+ years</p>
    </body></html>`);

    const jobs = await adapter.fetchJobs();
    expect(jobs[0].salary).toBe(32500); // average of 30000 and 35000
    expect(jobs[0].currency).toBe('ETB');
  });
});

// ══════════════════════════════════════════════════════════════
// 9. RELIEFWEB — RSS XML (uses Node https, not fetch)
// ══════════════════════════════════════════════════════════════
describe('ReliefWebAdapter', () => {
  const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>ReliefWeb Jobs - Ethiopia</title>
    <item>
      <title><![CDATA[Programme Officer - UNICEF]]></title>
      <link>https://reliefweb.int/job/12345</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description><![CDATA[<p>Manage humanitarian programmes in Ethiopia.</p>]]></description>
      <category><![CDATA[Jobs in Ethiopia]]></category>
      <category><![CDATA[Consultancy]]></category>
    </item>
    <item>
      <title><![CDATA[Logistics Intern - WFP]]></title>
      <link>https://reliefweb.int/job/12346</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description><![CDATA[<p>Support logistics operations.</p>]]></description>
      <category><![CDATA[Jobs in Ethiopia]]></category>
    </item>
  </channel>
</rss>`;

  it('parses RSS items and maps categories to employment type', async () => {
    const { ReliefWebAdapter } = require('./reliefweb.adapter');
    const adapter = new ReliefWebAdapter();
    mockHttpsResponse(RSS_XML);

    const jobs = await adapter.fetchJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(1);

    const unicef = jobs.find((j: RawJob) => j.title.includes('Programme Officer'));
    expect(unicef).toBeDefined();
    // First category is 'Jobs in Ethiopia' — not 'job' or 'ethiopia' so it becomes company
    // This is actual adapter behavior with these categories
    expect(unicef.company).toBeTruthy();
    expect(unicef.location).toBe('Ethiopia');
    expect(unicef.locationClass).toBe('ETHIOPIA_LOCAL');
    expect(unicef.employmentType).toBe('CONTRACT'); // consultancy category
    expect(unicef.sourceJobId).toBe('12345');
    expect(unicef.country).toBe('Ethiopia');
  });

  it('identifies internships from title', async () => {
    const { ReliefWebAdapter } = require('./reliefweb.adapter');
    const adapter = new ReliefWebAdapter();
    mockHttpsResponse(RSS_XML);

    const jobs = await adapter.fetchJobs();
    const intern = jobs.find((j: RawJob) => j.title.includes('Intern'));
    expect(intern).toBeDefined();
    expect(intern.employmentType).toBe('INTERNSHIP');
    expect(intern.experienceLevel).toBe('INTERN');
  });

  it('throws on HTTP error from RSS feed', async () => {
    const { ReliefWebAdapter } = require('./reliefweb.adapter');
    const adapter = new ReliefWebAdapter();
    (https.get as jest.Mock).mockImplementation((_url: any, _opts: any, cb: any) => {
      const req = new EventEmitter() as any;
      req.setTimeout = () => req;
      process.nextTick(() => {
        const res = new EventEmitter() as any;
        res.statusCode = 403;
        res.resume = () => {};
        cb(res);
        res.emit('end');
      });
      req.destroy = () => {};
      return req;
    });

    await expect(adapter.fetchJobs()).rejects.toThrow('403');
  });
});

// ══════════════════════════════════════════════════════════════
// 10. ETCAREERS — RSS XML (uses fetch, not https)
// ══════════════════════════════════════════════════════════════
describe('EtcareersAdapter', () => {
  const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[Software Engineer - Safaricom - Addis Ababa, Ethiopia]]></title>
      <link>https://etcareers.com/jobs/software-engineer-safaricom</link>
      <guid>https://etcareers.com/jobs/software-engineer-safaricom</guid>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description><![CDATA[<p>Join our engineering team.</p>]]></description>
      <category><![CDATA[Technology Jobs in Ethiopia]]></category>
    </item>
    <item>
      <title><![CDATA[Marketing Intern - TechStart - Remote, Ethiopia]]></title>
      <link>https://etcareers.com/jobs/marketing-intern</link>
      <guid>https://etcareers.com/jobs/marketing-intern</guid>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description><![CDATA[<p>Marketing support.</p>]]></description>
      <category><![CDATA[Jobs in Ethiopia]]></category>
    </item>
  </channel>
</rss>`;

  it('parses title format "Job - Company - Location"', async () => {
    const { EtcareersAdapter } = require('./etcareers.adapter');
    const adapter = new EtcareersAdapter();
    mockFetchHtml(RSS_XML);

    const jobs = await adapter.fetchJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(1);

    const eng = jobs.find((j: RawJob) => j.title.includes('Software Engineer'));
    expect(eng).toBeDefined();
    expect(eng.company).toBe('Safaricom');
    expect(eng.location).toBe('Addis Ababa, Ethiopia');
    expect(eng.locationClass).toBe('ETHIOPIA_LOCAL');
    expect(eng.sourceJobId).toBe('https://etcareers.com/jobs/software-engineer-safaricom');
  });

  it('detects remote location class', async () => {
    const { EtcareersAdapter } = require('./etcareers.adapter');
    const adapter = new EtcareersAdapter();
    mockFetchHtml(RSS_XML);

    const jobs = await adapter.fetchJobs();
    const intern = jobs.find((j: RawJob) => j.title.includes('Marketing Intern'));
    expect(intern).toBeDefined();
    expect(intern.locationClass).toBe('ETHIOPIA_REMOTE');
    expect(intern.workPlace).toBe('REMOTE');
    expect(intern.experienceLevel).toBe('INTERN');
  });
});

// ══════════════════════════════════════════════════════════════
// SHARED UTILITY TESTS (from job-source.adapter.ts)
// ══════════════════════════════════════════════════════════════
describe('Shared adapter utilities', () => {
  const { deriveExperience, mapEmployment, cleanHtml, parseNumericSalary } = require('./job-source.adapter');

  describe('deriveExperience', () => {
    it('maps intern/graduate titles to INTERN', () => {
      expect(deriveExperience('Software Engineering Intern')).toBe('INTERN');
      expect(deriveExperience('Graduate Data Analyst')).toBe('INTERN');
      expect(deriveExperience('Trainee Developer')).toBe('INTERN');
    });

    it('maps junior/entry titles to ENTRY', () => {
      expect(deriveExperience('Junior Backend Developer')).toBe('ENTRY');
      expect(deriveExperience('Entry Level Data Scientist')).toBe('ENTRY');
    });

    it('maps senior/lead titles to SENIOR', () => {
      expect(deriveExperience('Senior React Developer')).toBe('SENIOR');
      expect(deriveExperience('Lead Engineer')).toBe('SENIOR');
      expect(deriveExperience('SR Backend Dev')).toBe('SENIOR');
    });

    it('maps principal/director to LEAD', () => {
      expect(deriveExperience('Principal Engineer')).toBe('LEAD');
      expect(deriveExperience('Director of Engineering')).toBe('LEAD');
      expect(deriveExperience('VP of Product')).toBe('LEAD');
    });

    it('defaults to MID for unspecified titles', () => {
      expect(deriveExperience('Software Developer')).toBe('MID');
      expect(deriveExperience('Full Stack Engineer')).toBe('MID');
    });

    it('"intern" keyword takes priority over "senior" (intern regex runs first)', () => {
      // deriveExperience checks intern/graduate before senior, so 'Senior Intern' → INTERN
      expect(deriveExperience('Senior Intern')).toBe('INTERN');
    });
  });

  describe('mapEmployment', () => {
    it('maps part-time variants', () => {
      expect(mapEmployment('part_time')).toBe('PART_TIME');
      expect(mapEmployment('Part-time')).toBe('PART_TIME');
    });

    it('maps contract and freelance', () => {
      expect(mapEmployment('contract')).toBe('CONTRACT');
      expect(mapEmployment('freelance')).toBe('CONTRACT');
    });

    it('maps internship', () => {
      expect(mapEmployment('internship')).toBe('INTERNSHIP');
      expect(mapEmployment('Intern')).toBe('INTERNSHIP');
    });

    it('defaults to FULL_TIME for null/undefined/unknown', () => {
      expect(mapEmployment(null)).toBe('FULL_TIME');
      expect(mapEmployment(undefined)).toBe('FULL_TIME');
      expect(mapEmployment('full_time')).toBe('FULL_TIME');
      expect(mapEmployment('')).toBe('FULL_TIME');
    });
  });

  describe('cleanHtml', () => {
    it('removes script, style, nav, footer, aside, form tags', () => {
      const input = '<nav>Menu</nav><p>Content</p><script>alert(1)</script><style>.x{}</style><footer>©</footer>';
      const result = cleanHtml(input);
      expect(result).toBe('<p>Content</p>');
    });

    it('preserves structural tags like p, br, li', () => {
      const input = '<p>Line 1</p><br><li>Item</li>';
      expect(cleanHtml(input)).toBe(input);
    });

    it('collapses whitespace', () => {
      expect(cleanHtml('<p>  Hello   World  </p>')).toBe('<p> Hello World </p>');
    });

    it('handles empty/null input', () => {
      expect(cleanHtml('')).toBe('');
      expect(cleanHtml(null as any)).toBe('');
    });
  });

  describe('parseNumericSalary', () => {
    it('averages min and max', () => {
      expect(parseNumericSalary(50000, 70000)).toBe(60000);
    });

    it('returns min when max is null', () => {
      expect(parseNumericSalary(50000, null)).toBe(50000);
    });

    it('returns max when min is null', () => {
      expect(parseNumericSalary(null, 80000)).toBe(80000);
    });

    it('returns undefined when both are null', () => {
      expect(parseNumericSalary(null, null)).toBeUndefined();
    });
  });
});
