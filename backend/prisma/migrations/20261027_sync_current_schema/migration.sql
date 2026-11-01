-- AlterTable
ALTER TABLE "Job" ADD COLUMN "categories" TEXT DEFAULT '[]';
ALTER TABLE "Job" ADD COLUMN "tags" TEXT DEFAULT '[]';

-- CreateTable
CREATE TABLE "SourceRunCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "categoryLabel" TEXT,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "jobsFetched" INTEGER NOT NULL DEFAULT 0,
    "newJobs" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "stoppedReason" TEXT,
    CONSTRAINT "SourceRunCategory_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SourceRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CandidateProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "years" INTEGER NOT NULL DEFAULT 0,
    "remote" INTEGER NOT NULL DEFAULT 0,
    "minSalary" INTEGER NOT NULL DEFAULT 0,
    "excludeOnsite" INTEGER NOT NULL DEFAULT 0,
    "excludeEntryLevel" INTEGER NOT NULL DEFAULT 0,
    "employmentTypes" TEXT NOT NULL DEFAULT '[]',
    "onboardDone" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CandidateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CandidateProfile" ("createdAt", "employmentTypes", "excludeOnsite", "id", "minSalary", "onboardDone", "remote", "summary", "title", "updatedAt", "userId", "years") SELECT "createdAt", "employmentTypes", "excludeOnsite", "id", "minSalary", "onboardDone", "remote", "summary", "title", "updatedAt", "userId", "years" FROM "CandidateProfile";
DROP TABLE "CandidateProfile";
ALTER TABLE "new_CandidateProfile" RENAME TO "CandidateProfile";
CREATE UNIQUE INDEX "CandidateProfile_userId_key" ON "CandidateProfile"("userId");
CREATE TABLE "new_SourceRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "jobsFetched" INTEGER NOT NULL DEFAULT 0,
    "jobsCreated" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "avgDescriptionQuality" REAL,
    "descriptionFailures" INTEGER NOT NULL DEFAULT 0,
    "linkChecks" INTEGER NOT NULL DEFAULT 0,
    "linkFailures" INTEGER NOT NULL DEFAULT 0,
    "mode" TEXT NOT NULL DEFAULT 'FAST',
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "categoriesSearched" INTEGER NOT NULL DEFAULT 0,
    "crossCategoryDuplicates" INTEGER NOT NULL DEFAULT 0,
    "unmappedCategories" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SourceRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SourceRun" ("avgDescriptionQuality", "descriptionFailures", "duplicates", "errorMessage", "errors", "finishedAt", "id", "jobsCreated", "jobsFetched", "linkChecks", "linkFailures", "sourceId", "startedAt", "status") SELECT "avgDescriptionQuality", "descriptionFailures", "duplicates", "errorMessage", "errors", "finishedAt", "id", "jobsCreated", "jobsFetched", "linkChecks", "linkFailures", "sourceId", "startedAt", "status" FROM "SourceRun";
DROP TABLE "SourceRun";
ALTER TABLE "new_SourceRun" RENAME TO "SourceRun";
CREATE INDEX "SourceRun_sourceId_idx" ON "SourceRun"("sourceId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "notificationsPaused" INTEGER NOT NULL DEFAULT 0,
    "matchThreshold" INTEGER NOT NULL DEFAULT 65,
    "pausedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "digestEnabled" INTEGER NOT NULL DEFAULT 1,
    "emailVerifiedAt" DATETIME,
    "lastActiveAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tokenInvalidatedAt" DATETIME
);
INSERT INTO "new_User" ("createdAt", "digestEnabled", "email", "emailVerifiedAt", "id", "lastActiveAt", "locale", "matchThreshold", "notificationsPaused", "passwordHash", "pausedUntil", "role", "status", "tokenInvalidatedAt") SELECT "createdAt", "digestEnabled", "email", "emailVerifiedAt", "id", "lastActiveAt", "locale", "matchThreshold", "notificationsPaused", "passwordHash", "pausedUntil", "role", "status", "tokenInvalidatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_status_lastActiveAt_idx" ON "User"("status", "lastActiveAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SourceRunCategory_sourceId_category_idx" ON "SourceRunCategory"("sourceId", "category");

-- CreateIndex
CREATE INDEX "SourceRunCategory_runId_idx" ON "SourceRunCategory"("runId");

-- CreateIndex
CREATE INDEX "Job_status_postedDate_idx" ON "Job"("status", "postedDate");

