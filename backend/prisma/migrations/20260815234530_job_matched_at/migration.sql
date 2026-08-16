-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "matchedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Job_status_matchedAt_idx" ON "Job"("status", "matchedAt");
