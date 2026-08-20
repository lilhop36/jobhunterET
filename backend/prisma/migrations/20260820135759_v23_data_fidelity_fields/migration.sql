-- CreateEnum
CREATE TYPE "TelegramLinkStatus" AS ENUM ('ACTIVE', 'UNREACHABLE');

-- CreateEnum
CREATE TYPE "ApplyMethod" AS ENUM ('ONLINE_URL', 'EMAIL', 'IN_PERSON', 'SOURCE_ACCOUNT', 'PDF_FORM');

-- CreateEnum
CREATE TYPE "DescriptionSource" AS ENUM ('API', 'LIST', 'DETAIL', 'PDF');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "applyEmail" TEXT,
ADD COLUMN     "applyMethod" "ApplyMethod" NOT NULL DEFAULT 'ONLINE_URL',
ADD COLUMN     "applyUrl" TEXT,
ADD COLUMN     "applyUrlRaw" TEXT,
ADD COLUMN     "descriptionFetchedAt" TIMESTAMP(3),
ADD COLUMN     "descriptionQuality" INTEGER,
ADD COLUMN     "descriptionSource" "DescriptionSource",
ADD COLUMN     "finalUrl" TEXT;

-- AlterTable
ALTER TABLE "SourceRun" ADD COLUMN     "avgDescriptionQuality" DOUBLE PRECISION,
ADD COLUMN     "descriptionFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "linkChecks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "linkFailures" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TelegramLink" ADD COLUMN     "status" "TelegramLinkStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "matchThreshold" SET DEFAULT 75;

-- CreateIndex
CREATE INDEX "Application_userId_stage_idx" ON "Application"("userId", "stage");

-- CreateIndex
CREATE INDEX "Job_status_deadline_idx" ON "Job"("status", "deadline");

-- CreateIndex
CREATE INDEX "Job_status_urlStatus_idx" ON "Job"("status", "urlStatus");

-- CreateIndex
CREATE INDEX "JobMatch_userId_score_idx" ON "JobMatch"("userId", "score");
