-- Explainable requirement matching (Abdi JobPilot ET, Phase 6).
--
-- Persists the deterministic verdicts that explain a match score: which
-- qualifications were required or preferred, which were met / missing /
-- unknown, the profile evidence behind them, and the vacancy risk.
-- Every column is defaulted, so pre-Phase 6 match rows stay readable.

ALTER TABLE "JobMatch" ADD COLUMN "requiredRequirements" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "JobMatch" ADD COLUMN "preferredRequirements" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "JobMatch" ADD COLUMN "missingRequirements" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "JobMatch" ADD COLUMN "unknownRequirements" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "JobMatch" ADD COLUMN "evidence" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "JobMatch" ADD COLUMN "vacancyRisk" TEXT NOT NULL DEFAULT 'OK';
