ALTER TABLE "Application" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "ApplicationTransition" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "fromStage" "ApplicationStage",
  "toStage" "ApplicationStage" NOT NULL,
  "transitionedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationTransition_pkey" PRIMARY KEY ("id")
);
INSERT INTO "ApplicationTransition" ("id", "applicationId", "fromStage", "toStage", "transitionedAt")
SELECT concat('legacy_', "id"), "id", NULL, "stage", "stageSince" FROM "Application";
WITH inserted AS (
  INSERT INTO "Application" ("id", "userId", "jobId", "stage", "stageSince", "followUp", "version")
  SELECT concat('saved_', s."id"), s."userId", s."jobId", 'SAVED'::"ApplicationStage", s."createdAt", NULL, 1
  FROM "SavedJob" s LEFT JOIN "Application" a ON a."userId" = s."userId" AND a."jobId" = s."jobId" WHERE a."id" IS NULL
  RETURNING "id", "stage", "stageSince"
)
INSERT INTO "ApplicationTransition" ("id", "applicationId", "fromStage", "toStage", "transitionedAt")
SELECT concat('initial_', "id"), "id", 'DISCOVERED'::"ApplicationStage", "stage", "stageSince" FROM inserted;
CREATE INDEX "ApplicationTransition_applicationId_transitionedAt_idx" ON "ApplicationTransition"("applicationId", "transitionedAt");
ALTER TABLE "ApplicationTransition" ADD CONSTRAINT "ApplicationTransition_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP TABLE "SavedJob";