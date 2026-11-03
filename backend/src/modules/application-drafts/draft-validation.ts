/**
 * Deterministic pre-approval validation for an application draft (Phase 8).
 *
 * The check answers one question: is this exact application ready to be
 * approved by a human? It never scores prose with a model. It verifies the
 * things that can be verified mechanically — required documents, answered
 * screening questions, vacancy state, candidate attestation for edits, and
 * that no requirement marked MISSING is claimed in the text.
 */
import { DraftContent, RequirementEvidence, isEdited, editedFields } from './draft-content';

export interface DraftValidationInput {
  content: DraftContent;
  generated: DraftContent;
  requirementMapping: RequirementEvidence[];
  artifacts: { kind: string }[];
  attestedHash: string | null;
  contentHash: string;
  job: {
    eligibility: string;
    status: string;
    deadline: Date | null;
    urlStatus: string | null;
  };
  packageVersion: number;
  latestPackageVersion: number;
}

export interface DraftValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  edited: boolean;
  editedFields: string[];
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the text mentions the skill as a whole token (handles C++, .NET, Node.js). */
function mentionsSkill(text: string, skill: string): boolean {
  const escaped = escapeRegExp(skill.toLowerCase());
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}+#.])${escaped}($|[^\\p{L}\\p{N}+#.])`, 'iu');
  return pattern.test(text.toLowerCase());
}

export function validateDraft(input: DraftValidationInput): DraftValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const edited = isEdited(input.generated, input.content);
  const changed = editedFields(input.generated, input.content);

  // 1. Content must actually exist.
  if (!input.content.cv.trim()) errors.push('The CV is empty.');
  if (!input.content.coverLetter.trim()) errors.push('The cover letter is empty.');

  // 2. Every screening question must carry an answer and its evidence basis.
  if (!input.content.screeningAnswers.length) {
    warnings.push('This application has no screening answers.');
  }
  input.content.screeningAnswers.forEach((answer, index) => {
    const label = answer.question.trim() || `#${index + 1}`;
    if (!answer.answer.trim()) errors.push(`Screening answer "${label}" is empty.`);
    if (!answer.basis.trim()) errors.push(`Screening answer "${label}" has no evidence basis.`);
  });

  // 3. Required documents must be attached.
  if (!input.artifacts.some((a) => a.kind === 'CV')) {
    errors.push('No CV document is attached to this application.');
  }

  // 4. Edits need an explicit candidate attestation over the current revision.
  if (edited && input.attestedHash !== input.contentHash) {
    errors.push(
      'You edited the generated content. Confirm that your edits are accurate before approving this application.',
    );
  }

  // 5. A requirement the matcher marked MISSING must not be claimed in the text.
  const claimText = [
    input.content.cv,
    input.content.coverLetter,
    ...input.content.screeningAnswers.map((a) => `${a.question} ${a.answer}`),
  ].join('\n');
  const claimedMissing = new Set<string>();
  for (const requirement of input.requirementMapping) {
    if (requirement.kind !== 'SKILL') continue;
    if (requirement.status !== 'MISSING') continue;
    const name = requirement.name.trim();
    if (!name || /^skill requirements$/i.test(name)) continue;
    if (claimedMissing.has(name.toLowerCase())) continue;
    if (mentionsSkill(claimText, name)) {
      claimedMissing.add(name.toLowerCase());
      errors.push(`The application claims "${name}", which has no verified evidence in your profile.`);
    }
  }

  // 6. The vacancy must still be a real, live, in-window opportunity.
  if (input.job.eligibility !== 'ELIGIBLE') {
    errors.push(`The vacancy is not eligible (${input.job.eligibility}).`);
  }
  if (input.job.status !== 'ACTIVE') {
    errors.push(`The vacancy is no longer active (${input.job.status}).`);
  }
  if (input.job.deadline && input.job.deadline.getTime() < Date.now()) {
    errors.push('The application deadline has passed.');
  }
  if (input.job.urlStatus && input.job.urlStatus !== 'OK') {
    warnings.push('The vacancy link could not be verified — check the posting before submitting.');
  }

  // 7. Useful, non-blocking signals.
  for (const requirement of input.requirementMapping) {
    if (requirement.status === 'UNKNOWN') {
      warnings.push(`Could not verify "${requirement.name}" — the posting or your profile lacks the detail.`);
    }
  }
  if (input.latestPackageVersion > input.packageVersion) {
    warnings.push(
      `A newer generated package (v${input.latestPackageVersion}) exists; this draft is based on v${input.packageVersion}.`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    edited,
    editedFields: changed,
  };
}
