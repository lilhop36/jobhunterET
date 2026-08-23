/**
 * TelegramChannelAdapter fixture tests.
 *
 * Mocks the fetch call to return realistic HTML from t.me/s/ channels,
 * then asserts the shape and content of returned RawJob[].
 */

import { TelegramChannelAdapter } from './telegram-channel.adapter';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const TELEGRAM_HTML = `<!DOCTYPE html>
<html>
<body>
  <div class="tgme_channel_history">
    <div data-post="TestChannel/101">
      <div class="tgme_widget_message_wrap">
        <div class="tgme_widget_message">
          <div class="tgme_widget_message_text">
            <p><b>Vacancy: Accountant</b></p>
            <p>Company: <b>Dashen Bank SC</b></p>
            <p>Education: BA in Accounting</p>
            <p>Experience: 3+ years</p>
            <p>Deadline: 25-Aug-2026</p>
            <p>How to apply: Send CV to hr@dashenbank.com</p>
          </div>
          <div class="tgme_widget_message_info">
            <time datetime="2026-08-20T10:30:00+03:00">Aug 15</time>
            <span class="tgme_widget_message_views">1,234 views</span>
          </div>
        </div>
      </div>
    </div>

    <div data-post="TestChannel/102">
      <div class="tgme_widget_message_wrap">
        <div class="tgme_widget_message">
          <div class="tgme_widget_message_text">
            <p><b>Software Developer</b></p>
            <p>Company: <b>Safaricom Ethiopia</b></p>
            <p>Requirements: BSc in CS, 2+ years experience</p>
            <p>Deadline: 30-Sep-2026</p>
            <p>Apply: https://safaricom.et/careers/dev-123</p>
          </div>
          <div class="tgme_widget_message_info">
            <time datetime="2026-08-21T08:00:00+03:00">Aug 18</time>
            <span class="tgme_widget_message_views">567 views</span>
          </div>
        </div>
      </div>
    </div>

    <div data-post="TestChannel/103">
      <div class="tgme_widget_message_wrap">
        <div class="tgme_widget_message">
          <div class="tgme_widget_message_text">
            <p>Happy weekend everyone! Enjoy your time off.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

describe('TelegramChannelAdapter', () => {
  let adapter: TelegramChannelAdapter;

  beforeEach(() => {
    adapter = new TelegramChannelAdapter('tg-test', 'TestChannel');
    mockFetch.mockReset();
  });

  it('fetches and parses Telegram channel posts into RawJobs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => TELEGRAM_HTML,
    });

    const jobs = await adapter.fetchJobs();

    expect(jobs.length).toBe(2); // post 103 is too short / non-job
    expect(jobs[0].sourceJobId).toContain('TestChannel');
    expect(jobs[0].locationClass).toBe('ETHIOPIA_LOCAL');
    expect(jobs[0].parseConfidence).toBe(65);
  });

  it('extracts company name from structured text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => TELEGRAM_HTML,
    });

    const jobs = await adapter.fetchJobs();
    // Company extraction uses pattern matching — at least some should be non-Unknown
    expect(jobs.some(j => j.company !== 'Unknown')).toBe(true);
  });

  it('extracts deadline dates from text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => TELEGRAM_HTML,
    });

    const jobs = await adapter.fetchJobs();
    const deadlines = jobs.filter(j => j.deadline);
    expect(deadlines.length).toBeGreaterThan(0);
  });

  it('uses apply URL when present instead of post URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => TELEGRAM_HTML,
    });

    const jobs = await adapter.fetchJobs();
    const hasExternalUrl = jobs.some(
      j => j.url.includes('safaricom') || j.url.includes('dashen'),
    );
    expect(hasExternalUrl).toBe(true);
  });

  it('falls back to post URL when no apply link found', async () => {
    const noLinkHtml = TELEGRAM_HTML.replace(
      'https://safaricom.et/careers/dev-123',
      'No link provided',
    );
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => noLinkHtml,
    });

    const jobs = await adapter.fetchJobs();
    const hasTelegramUrl = jobs.some(j => j.url.includes('t.me/TestChannel/'));
    expect(hasTelegramUrl).toBe(true);
  });

  it('skips non-job posts (short content, no job keywords)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => TELEGRAM_HTML,
    });

    const jobs = await adapter.fetchJobs();
    const titles = jobs.map(j => j.title.toLowerCase());
    expect(titles.every(t => !t.includes('happy weekend'))).toBe(true);
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(adapter.fetchJobs()).rejects.toThrow(
      'Telegram channel responded 404',
    );
  });

  it('extracts post date from datetime attribute', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => TELEGRAM_HTML,
    });

    const jobs = await adapter.fetchJobs();
    expect(jobs[0].postedDate).toBeInstanceOf(Date);
  });

  it('sets employmentType to FULL_TIME by default', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => TELEGRAM_HTML,
    });

    const jobs = await adapter.fetchJobs();
    expect(jobs.every(j => j.employmentType === 'FULL_TIME')).toBe(true);
  });

  it('sets default location to Addis Ababa, Ethiopia', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => TELEGRAM_HTML,
    });

    const jobs = await adapter.fetchJobs();
    expect(jobs.every(j => j.location === 'Addis Ababa, Ethiopia')).toBe(true);
  });
});
