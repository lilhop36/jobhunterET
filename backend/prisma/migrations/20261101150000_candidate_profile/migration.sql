-- Complete candidate profile (Abdi JobPilot ET, Phase 5).
--
-- Adds the structured sections a real application needs (education, experience,
-- projects, certifications, languages) plus personal details, and turns the CV
-- table into a small document store. Every new column is nullable or defaulted,
-- so existing profiles keep working unchanged.

ALTER TABLE "CandidateProfile" ADD COLUMN "fullName" TEXT;
ALTER TABLE "CandidateProfile" ADD COLUMN "phone" TEXT;
ALTER TABLE "CandidateProfile" ADD COLUMN "city" TEXT;
ALTER TABLE "CandidateProfile" ADD COLUMN "country" TEXT DEFAULT 'Ethiopia';
ALTER TABLE "CandidateProfile" ADD COLUMN "linkedinUrl" TEXT;
ALTER TABLE "CandidateProfile" ADD COLUMN "githubUrl" TEXT;
ALTER TABLE "CandidateProfile" ADD COLUMN "portfolioUrl" TEXT;

ALTER TABLE "CvFile" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CV';
ALTER TABLE "CvFile" ADD COLUMN "label" TEXT;
CREATE INDEX "CvFile_userId_kind_idx" ON "CvFile"("userId", "kind");

CREATE TABLE "CandidateEducation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "degree" TEXT,
    "field" TEXT,
    "startYear" INTEGER,
    "endYear" INTEGER,
    "grade" TEXT,
    CONSTRAINT "CandidateEducation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CandidateEducation_userId_idx" ON "CandidateEducation"("userId");

CREATE TABLE "CandidateExperience" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "startYear" INTEGER,
    "endYear" INTEGER,
    "current" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    CONSTRAINT "CandidateExperience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CandidateExperience_userId_idx" ON "CandidateExperience"("userId");

CREATE TABLE "CandidateProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "year" INTEGER,
    CONSTRAINT "CandidateProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CandidateProject_userId_idx" ON "CandidateProject"("userId");

CREATE TABLE "CandidateCertification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "year" INTEGER,
    "credentialUrl" TEXT,
    CONSTRAINT "CandidateCertification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CandidateCertification_userId_idx" ON "CandidateCertification"("userId");

CREATE TABLE "CandidateLanguage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "proficiency" TEXT NOT NULL DEFAULT 'INTERMEDIATE',
    CONSTRAINT "CandidateLanguage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CandidateLanguage_userId_language_key" ON "CandidateLanguage"("userId", "language");
