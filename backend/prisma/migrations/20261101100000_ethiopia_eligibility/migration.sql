-- Ethiopia-only ingestion policy (Abdi JobPilot ET, Phase 2).
-- Existing rows default to REVIEW: a stored job with no policy decision is
-- never recommended until the backfill classifies it.
ALTER TABLE "Job" ADD COLUMN "eligibility" TEXT NOT NULL DEFAULT 'REVIEW';
ALTER TABLE "Job" ADD COLUMN "eligibilityReason" TEXT;

CREATE INDEX "Job_eligibility_idx" ON "Job"("eligibility");
