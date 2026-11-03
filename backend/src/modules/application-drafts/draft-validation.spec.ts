import { DraftContent } from './draft-content';
import { DraftValidationInput, validateDraft } from './draft-validation';

function content(over: Partial<DraftContent> = {}): DraftContent {
  return {
    cv: 'Abebe Bikila\nSenior Backend Engineer',
    coverLetter: 'Dear Hiring Team,\nI am applying.',
    screeningAnswers: [
      { question: 'Years of experience?', answer: '6 years', basis: 'Verified profile years' },
    ],
    ...over,
  };
}

function input(over: Partial<DraftValidationInput> = {}): DraftValidationInput {
  const c = over.content ?? content();
  return {
    content: c,
    // Default to an unedited draft unless a test explicitly supplies the
    // generated original to force the edited-content pathway.
    generated: over.generated ?? c,
    requirementMapping: over.requirementMapping ?? [],
    artifacts: over.artifacts ?? [{ kind: 'CV' }],
    attestedHash: over.attestedHash ?? null,
    contentHash: over.contentHash ?? 'hash-1',
    job: over.job ?? {
      eligibility: 'ELIGIBLE',
      status: 'ACTIVE',
      deadline: null,
      urlStatus: 'OK',
    },
    packageVersion: over.packageVersion ?? 1,
    latestPackageVersion: over.latestPackageVersion ?? 1,
  };
}

describe('validateDraft — readiness checks', () => {
  it('accepts a complete, unedited draft against a live vacancy', () => {
    const result = validateDraft(input());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.edited).toBe(false);
  });

  it('requires a CV and cover letter', () => {
    const result = validateDraft(input({ content: content({ cv: '  ', coverLetter: '' }) }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining(['The CV is empty.', 'The cover letter is empty.']),
    );
  });

  it('requires every screening answer to be answered and evidence-based', () => {
    const result = validateDraft(
      input({
        content: content({
          screeningAnswers: [
            { question: 'Q1', answer: '', basis: 'profile' },
            { question: 'Q2', answer: 'yes', basis: '' },
          ],
        }),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Screening answer "Q1" is empty.',
        'Screening answer "Q2" has no evidence basis.',
      ]),
    );
  });

  it('requires a CV document to be attached', () => {
    const result = validateDraft(input({ artifacts: [{ kind: 'CERTIFICATE' }] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('No CV document is attached to this application.');
  });

  it('blocks edited content until the candidate attests to it', () => {
    const edited = content({ coverLetter: 'I rewrote this myself.' });
    const attested = input({ content: edited, generated: content() });
    expect(validateDraft(attested).errors[0]).toMatch(/Confirm that your edits are accurate/);

    const confirmed = validateDraft({
      ...input({ content: edited, generated: content() }),
      attestedHash: 'hash-1',
    });
    expect(confirmed.valid).toBe(true);
    expect(confirmed.edited).toBe(true);
    expect(confirmed.editedFields).toContain('coverLetter');
  });

  it('does not accept a stale attestation for newer edits', () => {
    const edited = content({ coverLetter: 'edit v2' });
    const result = validateDraft({
      ...input({ content: edited, generated: content(), contentHash: 'hash-2' }),
      attestedHash: 'hash-1',
    });
    expect(result.valid).toBe(false);
  });

  it('blocks claiming a MISSING requirement as if it were earned', () => {
    const mapping = [
      { name: 'Kubernetes', kind: 'SKILL', importance: 'REQUIRED', status: 'MISSING', evidence: 'none' },
    ];
    const claimed = validateDraft(
      input({ requirementMapping: mapping, content: content({ coverLetter: 'I run Kubernetes daily.' }) }),
    );
    expect(claimed.valid).toBe(false);
    expect(claimed.errors).toContain(
      'The application claims "Kubernetes", which has no verified evidence in your profile.',
    );

    const honest = validateDraft(
      input({
        requirementMapping: mapping,
        content: content({ coverLetter: 'I have not used container orchestration yet.' }),
      }),
    );
    expect(honest.valid).toBe(true);
  });

  it('skips the generic aggregated skill placeholder', () => {
    const result = validateDraft(
      input({
        requirementMapping: [
          { name: 'Skill requirements', kind: 'SKILL', importance: 'REQUIRED', status: 'MISSING', evidence: 'none' },
        ],
        content: content({ coverLetter: 'My skill requirements were listed for review.' }),
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('blocks ineligible, closed and expired vacancies', () => {
    expect(
      validateDraft(input({ job: { eligibility: 'REJECTED', status: 'ACTIVE', deadline: null, urlStatus: 'OK' } })).errors,
    ).toContain('The vacancy is not eligible (REJECTED).');
    expect(
      validateDraft(input({ job: { eligibility: 'ELIGIBLE', status: 'EXPIRED', deadline: null, urlStatus: 'OK' } })).errors,
    ).toContain('The vacancy is no longer active (EXPIRED).');
    expect(
      validateDraft(
        input({
          job: { eligibility: 'ELIGIBLE', status: 'ACTIVE', deadline: new Date(Date.now() - 86_400_000), urlStatus: 'OK' },
        }),
      ).errors,
    ).toContain('The application deadline has passed.');
  });

  it('warns about unknown requirements, unverified links and newer packages', () => {
    const result = validateDraft(
      input({
        requirementMapping: [
          { name: 'Skill requirements', kind: 'SKILL', importance: 'REQUIRED', status: 'UNKNOWN', evidence: 'no data' },
        ],
        job: { eligibility: 'ELIGIBLE', status: 'ACTIVE', deadline: null, urlStatus: 'FAILED' },
        packageVersion: 1,
        latestPackageVersion: 2,
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Could not verify "Skill requirements" — the posting or your profile lacks the detail.',
        'The vacancy link could not be verified — check the posting before submitting.',
        'A newer generated package (v2) exists; this draft is based on v1.',
      ]),
    );
  });
});
