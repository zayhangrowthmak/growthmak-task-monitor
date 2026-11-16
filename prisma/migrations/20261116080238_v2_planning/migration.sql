-- CreateEnum
CREATE TYPE "BlockedType" AS ENUM ('CLIENT', 'INTERNAL');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'LOCKED');

-- CreateEnum
CREATE TYPE "PlanSource" AS ENUM ('DUE_DATE', 'RECURRING', 'KEPT', 'PROMOTED');

-- CreateEnum
CREATE TYPE "RemoveReason" AS ENUM ('CLIENT_CANCELLED', 'SCOPE_CHANGE', 'MOVED_NEXT_MONTH', 'OTHER');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('KEEP', 'BACKLOG', 'CLOSE');

-- CreateEnum
CREATE TYPE "SlipReason" AS ENUM ('CLIENT_INPUT', 'CLIENT_APPROVAL', 'SCOPE_CHANGE', 'CAPACITY', 'INTERNAL_DEPENDENCY', 'TECH_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "ChangeKind" AS ENUM ('UPDATE_DUE', 'SET_STATUS', 'CLEAR_DUE', 'CREATE_TASK');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StatusBucket" ADD VALUE 'BACKLOG';
ALTER TYPE "StatusBucket" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "MonthlyReview" ADD COLUMN     "cooRemarks" TEXT,
ADD COLUMN     "delivery" INTEGER,
ADD COLUMN     "managerRemarks" TEXT,
ADD COLUMN     "onTime" INTEGER,
ADD COLUMN     "ownership" INTEGER,
ADD COLUMN     "quality" INTEGER,
ALTER COLUMN "rating" DROP NOT NULL,
ALTER COLUMN "comment" SET DEFAULT '';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "blockedType" "BlockedType",
ADD COLUMN     "observedDoneAt" TIMESTAMP(3),
ADD COLUMN     "slipAt" TIMESTAMP(3),
ADD COLUMN     "slipNote" TEXT,
ADD COLUMN     "slipReason" "SlipReason",
ADD COLUMN     "userConfidence" INTEGER,
ADD COLUMN     "userConfidenceAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cliqEmail" TEXT;

-- CreateTable
CREATE TABLE "MonthPlan" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "locksAt" TIMESTAMP(3) NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "plannedDue" TIMESTAMP(3),
    "source" "PlanSource" NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedReason" "RemoveReason",
    "removedNote" TEXT,
    "removedById" TEXT,

    CONSTRAINT "PlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DueDateChange" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "oldDate" TIMESTAMP(3),
    "newDate" TIMESTAMP(3),
    "changedBy" TEXT,
    "source" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DueDateChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusChange" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "from" "StatusBucket",
    "to" "StatusBucket" NOT NULL,
    "fromName" TEXT,
    "toName" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OldTaskReview" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "userId" TEXT,
    "decision" "ReviewDecision" NOT NULL,
    "newDueDate" TIMESTAMP(3),
    "note" TEXT,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "needsApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,

    CONSTRAINT "OldTaskReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZohoChange" (
    "id" TEXT NOT NULL,
    "kind" "ChangeKind" NOT NULL,
    "taskId" TEXT,
    "projectId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ChangeStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "ZohoChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 28,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CliqMessage" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "messageId" TEXT,
    "lastState" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CliqMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CliqOutbox" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "taskId" TEXT,
    "month" TEXT,
    "state" TEXT,
    "text" TEXT NOT NULL,
    "fileMonth" TEXT,
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CliqOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthPlan_month_key" ON "MonthPlan"("month");

-- CreateIndex
CREATE INDEX "PlanItem_taskId_idx" ON "PlanItem"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanItem_planId_taskId_key" ON "PlanItem"("planId", "taskId");

-- CreateIndex
CREATE INDEX "DueDateChange_taskId_idx" ON "DueDateChange"("taskId");

-- CreateIndex
CREATE INDEX "StatusChange_taskId_at_idx" ON "StatusChange"("taskId", "at");

-- CreateIndex
CREATE INDEX "OldTaskReview_month_idx" ON "OldTaskReview"("month");

-- CreateIndex
CREATE UNIQUE INDEX "OldTaskReview_taskId_month_key" ON "OldTaskReview"("taskId", "month");

-- CreateIndex
CREATE INDEX "ZohoChange_status_idx" ON "ZohoChange"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CliqMessage_taskId_month_key" ON "CliqMessage"("taskId", "month");

-- CreateIndex
CREATE INDEX "CliqOutbox_sentAt_notBefore_idx" ON "CliqOutbox"("sentAt", "notBefore");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MonthPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry v1 review comments into the new Manager remarks field
UPDATE "MonthlyReview" SET "managerRemarks" = "comment" WHERE "managerRemarks" IS NULL AND "comment" <> '';
