import { resolveSubmissionChannel } from './submission-channel';

describe('resolveSubmissionChannel', () => {
  it('resolves an email channel from applyMethod EMAIL and applyEmail', () => {
    const channel = resolveSubmissionChannel({ applyMethod: 'EMAIL', applyEmail: 'jobs@acme.et' });
    expect(channel.type).toBe('EMAIL');
    expect(channel.email).toBe('jobs@acme.et');
    expect(channel.url).toBeNull();
  });

  it('treats a mailto: apply link as an email channel', () => {
    const channel = resolveSubmissionChannel({ applyUrl: 'mailto:hr@acme.et?subject=Application' });
    expect(channel.type).toBe('EMAIL');
    expect(channel.email).toBe('hr@acme.et');
  });

  it('resolves the official apply URL as a web channel', () => {
    const channel = resolveSubmissionChannel({
      applyMethod: 'ONLINE_URL',
      applyUrl: 'https://acme.et/careers/backend',
    });
    expect(channel.type).toBe('WEB');
    expect(channel.url).toBe('https://acme.et/careers/backend');
    expect(channel.email).toBeNull();
  });

  it('falls back to finalUrl, then url, when applyUrl is absent', () => {
    expect(resolveSubmissionChannel({ finalUrl: 'https://acme.et/final' }).url).toBe(
      'https://acme.et/final',
    );
    expect(resolveSubmissionChannel({ url: 'https://acme.et/posting' }).url).toBe(
      'https://acme.et/posting',
    );
    expect(resolveSubmissionChannel({ applyUrl: 'not a url', url: 'https://acme.et/posting' }).url).toBe(
      'https://acme.et/posting',
    );
  });

  it('marks Telegram postings as a Telegram channel', () => {
    const channel = resolveSubmissionChannel({ url: 'https://t.me/ethiojobs/42' });
    expect(channel.type).toBe('TELEGRAM');
    expect(channel.url).toBe('https://t.me/ethiojobs/42');
  });

  it('rejects non-http protocols and never invents a destination', () => {
    const channel = resolveSubmissionChannel({
      applyUrl: 'javascript:alert(1)',
      finalUrl: 'ftp://acme.et/file',
      url: 'javascript:void(0)',
    });
    expect(channel.type).toBe('UNKNOWN');
    expect(channel.url).toBeNull();
  });

  it('returns UNKNOWN with an explanation when nothing official is recorded', () => {
    const channel = resolveSubmissionChannel({});
    expect(channel).toEqual({
      type: 'UNKNOWN',
      url: null,
      email: null,
      reason: 'No official application link or email is recorded for this vacancy.',
    });
  });
});