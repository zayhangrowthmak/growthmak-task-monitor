import type { Confidence, StatusBucket } from "@prisma/client";
import { DAY, dayDiff, endOfIstDay } from "./time";

// Time-based confidence score. Nobody sets it by hand: it is worked out from the
// task's dates and progress, and re-evaluated as days pass.
//
//   At Risk  — overdue and not done; or Blocked/Waiting; or flagged by the assignee;
//              or due within 1 day with less than half the work done
//   Tight    — under 25% of the time window left, or due within 2 days;
//              or progress well behind the share of time already used
//   On Track — everything else
//   No due date — can't be judged on time; flagged so someone adds one

export const RULES = {
  tightWindowShare: 0.25, // < 25% of the window left → Tight
  tightDays: 2, // due within 2 days → Tight
  riskDays: 1, // due within 1 day and < riskProgress done → At Risk
  riskProgress: 50,
  behindGap: 0.4, // progress more than 40 pts behind time used → Tight
  reviewProgressFloor: 90, // a task in Review/QA counts as at least 90% done
};

export type ConfidenceInput = {
  bucket: StatusBucket;
  isClosed: boolean;
  startDate?: Date | null;
  dueDate?: Date | null;
  createdAt?: Date | null;
  completedAt?: Date | null;
  completionPct?: number | null;
  flaggedAtRisk?: boolean;
};

export type ConfidenceResult = { level: Confidence; reason: string };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function computeConfidence(t: ConfidenceInput, now = new Date()): ConfidenceResult {
  if (t.isClosed || t.bucket === "COMPLETED") {
    if (t.dueDate && t.completedAt && t.completedAt > endOfIstDay(t.dueDate)) {
      return { level: "DONE", reason: `Completed ${plural(dayDiff(t.dueDate, t.completedAt), "day")} late` };
    }
    return { level: "DONE", reason: "Completed" };
  }
  if (!t.dueDate) {
    if (t.bucket === "BLOCKED") return { level: "AT_RISK", reason: "Blocked / waiting, and no due date set" };
    return { level: "NO_DUE_DATE", reason: "No due date in Zoho — add one so time can be tracked" };
  }

  const dueEnd = endOfIstDay(t.dueDate);
  const msLeft = dueEnd.getTime() - now.getTime();
  const daysLeft = dayDiff(now, t.dueDate); // 0 = due today

  if (msLeft < 0) return { level: "AT_RISK", reason: `Overdue by ${plural(Math.max(1, dayDiff(t.dueDate, now)), "day")}` };
  if (t.bucket === "BLOCKED") return { level: "AT_RISK", reason: `Blocked / waiting, due in ${plural(daysLeft, "day")}` };
  if (t.flaggedAtRisk) return { level: "AT_RISK", reason: "Flagged At Risk by the team" };

  let pct = Math.max(0, Math.min(100, t.completionPct ?? 0));
  if (t.bucket === "REVIEW") pct = Math.max(pct, RULES.reviewProgressFloor);

  if (daysLeft <= RULES.riskDays && pct < RULES.riskProgress) {
    return { level: "AT_RISK", reason: `Due ${daysLeft === 0 ? "today" : "tomorrow"} with ${pct}% done` };
  }

  const windowStart = t.startDate ?? t.createdAt ?? new Date(dueEnd.getTime() - 7 * DAY);
  const total = Math.max(DAY, dueEnd.getTime() - windowStart.getTime());
  const used = Math.min(1, Math.max(0, (now.getTime() - windowStart.getTime()) / total));
  const leftShare = 1 - used;

  if (daysLeft <= RULES.tightDays && pct < 100) {
    return { level: "TIGHT", reason: `Due in ${plural(daysLeft, "day")}, ${pct}% done` };
  }
  if (leftShare < RULES.tightWindowShare) {
    return { level: "TIGHT", reason: `${Math.round(leftShare * 100)}% of time left, ${pct}% done` };
  }
  if (used - pct / 100 > RULES.behindGap) {
    return { level: "TIGHT", reason: `${Math.round(used * 100)}% of time used but ${pct}% done` };
  }
  return { level: "ON_TRACK", reason: `Due in ${plural(daysLeft, "day")}, ${pct}% done` };
}

const SEVERITY: Record<Confidence, number> = { DONE: 0, ON_TRACK: 1, NO_DUE_DATE: 1, TIGHT: 2, AT_RISK: 3 };

/** Alert when a task moves into Tight or At Risk from something less severe. */
export function shouldAlert(prev: Confidence | null | undefined, next: Confidence): boolean {
  if (next !== "TIGHT" && next !== "AT_RISK") return false;
  return SEVERITY[next] > SEVERITY[prev ?? "ON_TRACK"];
}
