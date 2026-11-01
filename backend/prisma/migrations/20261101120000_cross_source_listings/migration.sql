-- Cross-source deduplication (Abdi JobPilot ET, Phase 4).
--
-- A Job becomes the canonical opportunity; each board that advertises it keeps
-- a JobSourceListing row, so no original link is lost when two boards carry the
-- same opening.
ALTER TABLE "Job" ADD COLUMN "crossSourceKey" TEXT;

CREATE INDEX "Job_crossSourceKey_idx" ON "Job"("crossSourceKey");

CREATE TABLE "JobSourceListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceJobId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobSourceListing_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobSourceListing_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "JobSourceListing_sourceId_sourceJobId_key" ON "JobSourceListing"("sourceId", "sourceJobId");
CREATE INDEX "JobSourceListing_jobId_idx" ON "JobSourceListing"("jobId");
