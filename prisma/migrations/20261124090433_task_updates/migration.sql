-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "commentsCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastCommentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ZohoComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorId" TEXT,
    "text" TEXT NOT NULL,
    "raw" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "fromDashboard" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ZohoComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZohoComment_taskId_at_idx" ON "ZohoComment"("taskId", "at");

-- CreateIndex
CREATE INDEX "ZohoComment_at_idx" ON "ZohoComment"("at");

-- AddForeignKey
ALTER TABLE "ZohoComment" ADD CONSTRAINT "ZohoComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
