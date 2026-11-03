/**
 * Draft content and hashing (Abdi JobPilot ET, Phase 8).
 *
 * A draft is the candidate's editable copy of one immutable application
 * package. Approval must bind to an exact revision, so every revision gets a
 * deterministic hash over its full content and document selection. If any byte
 * changes — including which documents are attached — the hash changes and an
 * earlier approval no longer applies.
 */
import { createHash } from 'crypto';

export interface ScreeningAnswer {
  question: string;
  answer: string;
  basis: string;
}

export interface DraftContent {
  cv: string;
  coverLetter: string;
  screeningAnswers: ScreeningAnswer[];
}

export interface RequirementEvidence {
  name: string;
  kind: string;
  importance: string;
  status: string;
  evidence: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Coerce untrusted JSON (package body, request body) into a draft content shape. */
export function normalizeContent(value: any): DraftContent {
  const answers = Array.isArray(value?.screeningAnswers) ? value.screeningAnswers : [];
  return {
    cv: text(value?.cv),
    coverLetter: text(value?.coverLetter),
    screeningAnswers: answers.map((a: any) => ({
      question: text(a?.question),
      answer: text(a?.answer),
      basis: text(a?.basis),
    })),
  };
}

/** The exact inputs an approval is bound to. */
export interface HashInput {
  packageId: string;
  content: DraftContent;
  documentIds: string[];
}

export function draftHash(input: HashInput): string {
  const canonical = JSON.stringify({
    packageId: input.packageId,
    cv: input.content.cv,
    coverLetter: input.content.coverLetter,
    screeningAnswers: input.content.screeningAnswers.map((a) => ({
      q: a.question,
      a: a.answer,
      b: a.basis,
    })),
    documents: [...input.documentIds].sort(),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Which parts of the generated package the candidate changed. */
export function editedFields(generated: DraftContent, current: DraftContent): string[] {
  const fields: string[] = [];
  if (generated.cv !== current.cv) fields.push('cv');
  if (generated.coverLetter !== current.coverLetter) fields.push('coverLetter');
  if (JSON.stringify(generated.screeningAnswers) !== JSON.stringify(current.screeningAnswers)) {
    fields.push('screeningAnswers');
  }
  return fields;
}

export function isEdited(generated: DraftContent, current: DraftContent): boolean {
  return editedFields(generated, current).length > 0;
}
