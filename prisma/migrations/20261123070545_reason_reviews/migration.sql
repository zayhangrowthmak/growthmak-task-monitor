-- CreateEnum
CREATE TYPE "ReasonVerdict" AS ENUM ('PENDING', 'AGREED', 'DISAGREED', 'PROOF_REQUESTED', 'PROOF_SENT');

-- AlterEnum
ALTER TYPE "ChangeKind" ADD VALUE 'ADD_COMMENT';

-- AlterTable
ALTER TABLE "ZohoChange" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "auto" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ReasonReview" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "reason" "SlipReason" NOT NULL,
    "note" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ReasonVerdict" NOT NULL DEFAULT 'PENDING',
    "managerNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "proofAskedAt" TIMESTAMP(3),
    "proofSentAt" TIMESTAMP(3),
    "proofNote" TEXT,

    CONSTRAINT "ReasonReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReasonReview_status_idx" ON "ReasonReview"("status");

-- CreateIndex
CREATE INDEX "ReasonReview_taskId_idx" ON "ReasonReview"("taskId");

-- CreateIndex
CREATE INDEX "ZohoChange_auto_status_idx" ON "ZohoChange"("auto", "status");

-- AddForeignKey
ALTER TABLE "ReasonReview" ADD CONSTRAINT "ReasonReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReasonReview" ADD CONSTRAINT "ReasonReview_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReasonReview" ADD CONSTRAINT "ReasonReview_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
