import {
  classifyLocationText,
  detectPlace,
  evaluateEthiopiaEligibility,
} from './ethiopia-eligibility';

const decide = (over: Partial<Parameters<typeof evaluateEthiopiaEligibility>[0]>) =>
  evaluateEthiopiaEligibility({ title: 'Software Engineer', ...over });

describe('Ethiopia-only eligibility policy', () => {
  it('accepts a job in Addis Ababa', () => {
    expect(decide({ location: 'Addis Ababa, Ethiopia' }).status).toBe('ELIGIBLE');
  });

  it('accepts a job in an Ethiopian regional city', () => {
    expect(decide({ location: 'Bahir Dar, Amhara' }).status).toBe('ELIGIBLE');
  });

  it('accepts a remote job explicitly open to Ethiopian residents', () => {
    expect(
      decide({
        location: 'Remote',
        workPlace: 'REMOTE',
        description: 'This role is open to candidates based in Ethiopia.',
      }).status,
    ).toBe('ELIGIBLE');
  });

  it('rejects a foreign onsite job', () => {
    const decision = decide({ location: 'Nairobi, Kenya', country: 'Kenya' });
    expect(decision.status).toBe('REJECTED');
    expect(decision.reason).toContain('Kenya');
  });

  it('rejects a remote job restricted to another country', () => {
    expect(
      decide({
        location: 'Remote',
        workPlace: 'REMOTE',
        description: 'Applicants must be based in the United States.',
      }).status,
    ).toBe('REJECTED');
  });

  it('rejects a global remote job that does not confirm Ethiopia eligibility', () => {
    expect(
      decide({
        location: 'Remote (Worldwide)',
        workPlace: 'REMOTE',
        description: 'Work from anywhere. Great benefits.',
      }).status,
    ).toBe('REVIEW');
  });

  it('flags a missing location for review instead of assuming Ethiopia', () => {
    const decision = decide({ location: '', country: null });
    expect(decision.status).toBe('REVIEW');
    expect(decision.reason).toMatch(/not established/i);
  });

  it('reviews an unrecognised location rather than guessing', () => {
    expect(decide({ location: 'Head Office' }).status).toBe('REVIEW');
  });

  it('rejects a foreign job advertised as remote without Ethiopia eligibility', () => {
    expect(decide({ location: 'Dubai, UAE', workPlace: 'REMOTE' }).status).toBe('REJECTED');
  });

  it('accepts a remote role whose location itself says Ethiopia', () => {
    expect(decide({ location: 'Remote (Ethiopia)', workPlace: 'REMOTE' }).status).toBe('ELIGIBLE');
  });

  it('uses the country field when the location text is vague', () => {
    expect(decide({ location: 'Remote', country: 'ET', workPlace: 'REMOTE' }).status).toBe('ELIGIBLE');
    expect(decide({ location: 'Head Office', country: 'Uganda' }).status).toBe('REJECTED');
  });

  it('does not treat an Ethiopian company name in the title as location evidence', () => {
    expect(decide({ title: 'Ethiopian Airlines Country Manager', location: 'Nairobi, Kenya' }).status).toBe('REJECTED');
  });

  it('classifies free-text places for adapters', () => {
    expect(classifyLocationText('Addis Ababa, Ethiopia')).toBe('ETHIOPIA_LOCAL');
    expect(classifyLocationText('Remote (Ethiopia)')).toBe('ETHIOPIA_REMOTE');
    expect(classifyLocationText('Dubai, UAE')).toBe('INTERNATIONAL_ONSITE');
    expect(classifyLocationText('Unknown')).toBe('UNKNOWN');
    expect(detectPlace('Location: Kampala, Uganda')).toContain('uganda');
    expect(detectPlace('Duty Station: Addis Ababa')).toContain('addis');
  });
});
