-- Versioned application packages (Abdi JobPilot ET, Phase 7).
--
-- One row per generated package version for a (user, job). The package body is
-- a JSON document (CV, cover letter, screening answers, requirement mapping,
-- warnings) produced deterministically from the verified profile and the
-- vacancy; regenerating appends a new version instead of overwriting history.

CREATE TABLE "ApplicationPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationPackage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationPackage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApplicationPackage_userId_jobId_version_key" ON "ApplicationPackage"("userId", "jobId", "version");
CREATE INDEX "ApplicationPackage_userId_jobId_idx" ON "ApplicationPackage"("userId", "jobId");
