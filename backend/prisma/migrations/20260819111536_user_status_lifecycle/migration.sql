-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DORMANT', 'DISABLED', 'DELETED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "lastActiveAt" TIMESTAMP(3),
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "tokenInvalidatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_status_lastActiveAt_idx" ON "User"("status", "lastActiveAt");
