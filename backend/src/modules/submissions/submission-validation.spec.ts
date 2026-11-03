import { validateSubmission, SubmissionValidationInput } from './submission-validation';

const channel = {
  type: 'WEB' as const,
  url: 'https://acme.et/apply',
  email: null,
  reason: 'Apply through the official posting.',
};

function input(over: Partial<SubmissionValidationInput> = {}): SubmissionValidationInput {
  return {
    approved: true,
    approvalHash: 'hash-1',
    contentHash: 'hash-1',
    attestationCurrent: true,
    edited: false,
    validationValid: true,
    validationErrors: [],
    channel,
    automatedSupported: false,
    existing: null,
    ...over,
  };
}

describe('validateSubmission', () => {
  it('passes when the exact revision is approved, attested and has an official channel', () => {
    const result = validateSubmission(input());
    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
    // Manual fallback is a warning, not a blocker.
    expect(result.warnings.join(' ')).toMatch(/manual submission/i);
  });

  it('blocks an unapproved revision', () => {
    const result = validateSubmission(input({ approved: false }));
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      'The current revision is not approved. Approve the exact content before submitting.',
    );
  });

  it('blocks when approval was recorded against different content', () => {
    const result = validateSubmission(input({ approvalHash: 'old-hash', contentHash: 'new-hash' }));
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('The approval does not match the current content.');
  });

  it('blocks an edited revision that the candidate has not confirmed', () => {
    const result = validateSubmission(input({ edited: true, attestationCurrent: false }));
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('Confirm the saved revision before submitting.');
  });

  it('does not require confirmation when the generated content was not edited', () => {
    const result = validateSubmission(input({ edited: false, attestationCurrent: false }));
    expect(result.ok).toBe(true);
  });

  it('blocks failed pre-approval checks and includes their errors', () => {
    const result = validateSubmission(
      input({ validationValid: false, validationErrors: ['CV is empty.', 'No documents attached.'] }),
    );
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('The application does not pass its pre-approval checks.');
    expect(result.blockers).toContain('CV is empty.');
    expect(result.blockers).toContain('No documents attached.');
  });

  it('blocks when no official channel is recorded', () => {
    const result = validateSubmission(
      input({ channel: { type: 'UNKNOWN', url: null, email: null, reason: 'none' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('No official application channel is recorded for this vacancy.');
  });

  it('blocks a duplicate submission for the same vacancy', () => {
    const result = validateSubmission(input({ existing: { status: 'SUBMITTED' } }));
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('This vacancy has already been submitted.');
  });

  it('does not treat an awaiting-manual record as a duplicate', () => {
    const result = validateSubmission(input({ existing: { status: 'AWAITING_MANUAL' } }));
    expect(result.ok).toBe(true);
  });

  it('deduplicates repeated blockers', () => {
    const result = validateSubmission(
      input({ validationValid: false, validationErrors: ['CV is empty.', 'CV is empty.'] }),
    );
    expect(result.blockers.filter((b) => b === 'CV is empty.')).toHaveLength(1);
  });
});