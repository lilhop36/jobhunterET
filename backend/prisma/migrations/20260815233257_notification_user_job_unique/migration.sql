-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_jobId_key" ON "Notification"("userId", "jobId");
