-- Controlled application submission (Abdi JobPilot ET, Phase 9).
--
-- One submission attempt per (candidate, vacancy). The row pins the approval,
-- revision and content hash it was prepared from, so JobPilot can only ever
-- send the exact version a human approved. Manual channels stay
-- AWAITING_MANUAL until the candidate confirms they sent it themselves;
-- automated channels are only attempted through a registered official
-- transport. Every state change is recorded as a SubmissionEvent.

CREATE TABLE "ApplicationSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "channelUrl" TEXT,
    "channelEmail" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'AWAITING_MANUAL',
    "receipt" TEXT,
    "note" TEXT,
    "submittedAt" DATETIME,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApplicationSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationSubmission_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationSubmission_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ApplicationDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationSubmission_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ApplicationApproval" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationSubmission_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ApplicationDraftRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApplicationSubmission_userId_jobId_key" ON "ApplicationSubmission"("userId", "jobId");
CREATE INDEX "ApplicationSubmission_userId_createdAt_idx" ON "ApplicationSubmission"("userId", "createdAt");
CREATE INDEX "ApplicationSubmission_draftId_idx" ON "ApplicationSubmission"("draftId");
CREATE INDEX "ApplicationSubmission_status_idx" ON "ApplicationSubmission"("status");

CREATE TABLE "SubmissionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubmissionEvent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ApplicationSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubmissionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SubmissionEvent_submissionId_createdAt_idx" ON "SubmissionEvent"("submissionId", "createdAt");