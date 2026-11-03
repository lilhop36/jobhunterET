/**
 * Automated submission transport (Phase 9).
 *
 * There is intentionally **no production implementation**: JobPilot must not
 * drive a third-party form, solve a CAPTCHA, or work around an access
 * restriction. The module registers `null`, so every real submission is
 * prepared for the candidate to send and confirm themselves.
 *
 * The interface exists so an explicitly sanctioned, official integration can be
 * added later (for example an employer's documented API) without weakening the
 * approval binding: the transport is only ever handed the exact approved
 * revision, and only for a channel it declares it supports.
 */
import { SubmissionChannel } from './submission-channel';

export const SUBMISSION_TRANSPORT = Symbol('SUBMISSION_TRANSPORT');

export interface SubmissionTransportInput {
  channel: SubmissionChannel;
  contentHash: string;
  revisionId: string;
  job: { id: string; title: string; company: string };
  content: {
    cv: string;
    coverLetter: string;
    screeningAnswers: { question: string; answer: string; basis: string }[];
  };
  documents: { id: string; kind: string; originalName?: string | null }[];
}

export interface SubmissionTransportResult {
  reference: string;
  detail?: unknown;
}

export interface SubmissionTransport {
  supports(channel: SubmissionChannel): boolean;
  send(input: SubmissionTransportInput): Promise<SubmissionTransportResult>;
}