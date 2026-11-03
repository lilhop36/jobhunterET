-- Application drafts and human approval (Abdi JobPilot ET, Phase 8).
--
-- ApplicationPackage stays immutable. A draft is the candidate's editable copy
-- of one package; every edit is an immutable revision so approval can bind to
-- the exact content the candidate reviewed. Approval, artifacts (selected
-- documents) and an audit trail are recorded separately.

CREATE TABLE "ApplicationDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "attestedHash" TEXT,
    "attestedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApplicationDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationDraft_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationDraft_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ApplicationPackage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApplicationDraft_userId_jobId_key" ON "ApplicationDraft"("userId", "jobId");
CREATE INDEX "ApplicationDraft_userId_idx" ON "ApplicationDraft"("userId");

CREATE TABLE "ApplicationDraftRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationDraftRevision_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ApplicationDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApplicationDraftRevision_draftId_version_key" ON "ApplicationDraftRevision"("draftId", "version");
CREATE INDEX "ApplicationDraftRevision_draftId_idx" ON "ApplicationDraftRevision"("draftId");

CREATE TABLE "ApplicationApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationApproval_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ApplicationDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationApproval_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ApplicationDraftRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ApplicationApproval_draftId_createdAt_idx" ON "ApplicationApproval"("draftId", "createdAt");

CREATE TABLE "ApplicationArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CV',
    "label" TEXT,
    CONSTRAINT "ApplicationArtifact_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ApplicationDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationArtifact_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "CvFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApplicationArtifact_draftId_fileId_key" ON "ApplicationArtifact"("draftId", "fileId");
CREATE INDEX "ApplicationArtifact_draftId_idx" ON "ApplicationArtifact"("draftId");

CREATE TABLE "ApplicationAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationAuditLog_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ApplicationDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ApplicationAuditLog_draftId_createdAt_idx" ON "ApplicationAuditLog"("draftId", "createdAt");
