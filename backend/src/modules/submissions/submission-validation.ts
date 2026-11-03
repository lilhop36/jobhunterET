/**
 * Preconditions for submitting an application (Phase 9).
 *
 * The central rule is narrow on purpose: JobPilot may submit only the exact
 * application version that an authenticated human approved. This module turns
 * that rule (plus the technical preconditions already checked before approval)
 * into an explicit, deterministic list of blockers and warnings. It does not
 * score prose and it does not decide *how* to submit.
 */
import { SubmissionChannel } from './submission-channel';

export interface SubmissionValidationInput {
  /** An approval exists and is bound to the current revision. */
  approved: boolean;
  /** The hash that approval was recorded against. */
  approvalHash: string | null;
  /** The hash of the revision about to be sent. */
  contentHash: string;
  /** The candidate confirmed this exact revision. */
  attestationCurrent: boolean;
  /** Whether the candidate edited the generated content. */
  edited: boolean;
  /** The draft's own pre-approval checks pass. */
  validationValid: boolean;
  validationErrors: string[];
  channel: SubmissionChannel;
  /** Whether an official automated transport is registered for this channel. */
  automatedSupported: boolean;
  /** An existing submission for this (candidate, vacancy), if any. */
  existing: { status: string } | null;
}

export interface SubmissionValidationResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function validateSubmission(input: SubmissionValidationInput): SubmissionValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!input.approved) {
    blockers.push('The current revision is not approved. Approve the exact content before submitting.');
  } else if (input.approvalHash !== input.contentHash) {
    blockers.push('The approval does not match the current content.');
  }

  if (!input.attestationCurrent && input.edited) {
    blockers.push('Confirm the saved revision before submitting.');
  }

  if (!input.validationValid) {
    blockers.push('The application does not pass its pre-approval checks.');
    blockers.push(...input.validationErrors);
  }

  if (!input.channel.url && !input.channel.email) {
    blockers.push('No official application channel is recorded for this vacancy.');
  }

  if (input.existing?.status === 'SUBMITTED') {
    blockers.push('This vacancy has already been submitted.');
  }

  if (input.channel.type === 'UNKNOWN') {
    warnings.push('No official channel could be resolved; submit through the original posting.');
  }
  if (!input.automatedSupported) {
    warnings.push(
      'Automated submission is not supported for this channel — JobPilot will prepare a manual submission that you confirm yourself.',
    );
  }

  return { ok: blockers.length === 0, blockers: unique(blockers), warnings: unique(warnings) };
}