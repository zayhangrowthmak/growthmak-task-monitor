-- How someone is on a task: Zoho Owner, the custom "Assigned To" field, or both
CREATE TYPE "AssigneeRole" AS ENUM ('OWNER', 'ASSIGNED', 'BOTH');
ALTER TABLE "TaskAssignee" ADD COLUMN "role" "AssigneeRole" NOT NULL DEFAULT 'OWNER';
