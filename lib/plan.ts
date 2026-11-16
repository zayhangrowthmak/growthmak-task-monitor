// Monthly Plan: the deliverables the team committed to for a month.
// Every monthly number, alert and the report is measured against the Plan.
//
//   1st of month ─ draft plan = open tasks due in the month + recurring deliverables
//   1st → Nth working day ─ planning window (due-date changes in Zoho flow in; Keep decisions join)
//   end of Nth working day ─ Plan locks; "planned due" is frozen per task
//   after lock ─ newly due tasks are Unplanned (a manager can promote them, logged)
import type { MonthPlan, PlanItem, PlanSource, RemoveReason, User } from "@prisma/client";
import { prisma } from "./db";
import { getSettings } from "./settings";
import { workingDaysFromNowEnd, nthWorkingDayEnd } from "./workdays";
import { currentMonth, monthRange } from "./time";
import { audit } from "./audit";
import type { FullTask } from "./metrics";

export type PlanWithItems = MonthPlan & { items: PlanItem[] };

const inMonth = (d: Date | null | undefined, month: string) => {
  if (!d) return false;
  const { start, end } = monthRange(month);
  return d >= start && d < end;
};

/** Parked = moved to Backlog / Closed, in Zoho or by a review decision still waiting on Zoho. */
export async function parkedTaskIds(): Promise<Set<string>> {
  const decisions = await prisma.oldTaskReview.findMany({ where: { decision: { in: ["BACKLOG", "CLOSE"] } }, select: { taskId: true } });
  if (!decisions.length) return new Set();
  const ids = decisions.map((d) => d.taskId);
  const [tasks, changes] = await Promise.all([
    prisma.task.findMany({ where: { id: { in: ids } }, select: { id: true, bucket: true } }),
    prisma.zohoChange.findMany({ where: { taskId: { in: ids }, source: "review" }, orderBy: { requestedAt: "desc" }, select: { taskId: true, status: true } }),
  ]);
  const latestChange = new Map<string, string>();
  for (const c of changes) if (c.taskId && !latestChange.has(c.taskId)) latestChange.set(c.taskId, c.status);
  const out = new Set<string>();
  for (const t of tasks) {
    const st = latestChange.get(t.id);
    // Waiting for approval, failed to apply, or Zoho already shows it parked → still parked
    if (st !== "APPLIED" || t.bucket === "BACKLOG" || t.bucket === "CLOSED") out.add(t.id);
  }
  return out;
}

export const isParkedBucket = (t: Pick<FullTask, "bucket">) => t.bucket === "BACKLOG" || t.bucket === "CLOSED";

/** Tasks that belong in a month's draft plan, with the reason they're in it. */
export async function draftCandidates(month: string, tasks: FullTask[]): Promise<Map<string, { source: PlanSource; plannedDue: Date | null }>> {
  const parked = await parkedTaskIds();
  const [templates, kept] = await Promise.all([
    prisma.recurringTemplate.findMany({ where: { active: true } }),
    prisma.oldTaskReview.findMany({ where: { month, decision: "KEEP" } }),
  ]);
  const out = new Map<string, { source: PlanSource; plannedDue: Date | null }>();
  for (const t of tasks) {
    if (parked.has(t.id) || isParkedBucket(t)) continue;
    const recurring = templates.some(
      (r) => r.projectId === t.projectId && t.name.toLowerCase().includes(r.title.toLowerCase()) && (inMonth(t.dueDate, month) || (!t.dueDate && inMonth(t.createdAtZoho, month)))
    );
    if (recurring) out.set(t.id, { source: "RECURRING", plannedDue: t.dueDate });
    else if (inMonth(t.dueDate, month)) out.set(t.id, { source: "DUE_DATE", plannedDue: t.dueDate });
  }
  for (const k of kept) {
    if (k.needsApproval && !k.approvedById) continue; // 3rd consecutive Keep waits for a manager
    if (parked.has(k.taskId)) continue;
    out.set(k.taskId, { source: "KEPT", plannedDue: k.newDueDate });
  }
  return out;
}

export async function getPlan(month: string): Promise<PlanWithItems | null> {
  return prisma.monthPlan.findUnique({ where: { month }, include: { items: true } });
}

/** Create the month's plan record if missing (draft, with its lock deadline). */
export async function ensurePlan(month: string): Promise<PlanWithItems> {
  const existing = await getPlan(month);
  if (existing) return existing;
  const s = await getSettings();
  // A plan first created after its normal lock day (e.g. v2 deployed mid-month) gets a short
  // planning window instead of locking at once, so people can still review old tasks.
  const now = new Date();
  let locksAt = nthWorkingDayEnd(month, s.lockWorkingDay, s.workingDays);
  if (locksAt < now && month === currentMonth(now)) locksAt = workingDaysFromNowEnd(now, 3, month, s.workingDays);
  await prisma.monthPlan.create({ data: { month, locksAt } }).catch(() => null);
  return (await getPlan(month))!;
}

/**
 * Keep a plan in step with Zoho. While drafting: auto items follow due dates and Keep decisions.
 * After lock: only recurring deliverables are still auto-added (they are always planned).
 */
export async function refreshPlan(month: string, tasks: FullTask[]): Promise<PlanWithItems> {
  const plan = await ensurePlan(month);
  const cands = await draftCandidates(month, tasks);
  const byTask = new Map(plan.items.map((i) => [i.taskId, i]));

  if (plan.status === "DRAFT") {
    for (const [taskId, c] of cands) {
      const it = byTask.get(taskId);
      if (!it) await prisma.planItem.create({ data: { planId: plan.id, taskId, source: c.source, plannedDue: c.plannedDue } }).catch(() => null);
      else if (!it.removedAt && it.source !== "PROMOTED") {
        const due = c.plannedDue?.getTime() ?? null;
        if (it.source !== c.source || (it.plannedDue?.getTime() ?? null) !== due)
          await prisma.planItem.update({ where: { id: it.id }, data: { source: c.source, plannedDue: c.plannedDue } });
      }
    }
    // Auto items that no longer qualify leave the draft (manual removals and promotions stay as they are)
    const stale = plan.items.filter((i) => !i.removedAt && i.source !== "PROMOTED" && !cands.has(i.taskId)).map((i) => i.id);
    if (stale.length) await prisma.planItem.deleteMany({ where: { id: { in: stale } } });
  } else {
    for (const [taskId, c] of cands) {
      if (c.source === "RECURRING" && !byTask.has(taskId))
        await prisma.planItem.create({ data: { planId: plan.id, taskId, source: "RECURRING", plannedDue: c.plannedDue } }).catch(() => null);
    }
  }
  return (await getPlan(month))!;
}

/** Lock: freeze the planned due date of every item. */
export async function lockPlan(month: string, tasks: FullTask[], by: User | null): Promise<PlanWithItems> {
  const plan = await refreshPlan(month, tasks);
  if (plan.status === "LOCKED") return plan;
  const due = new Map(tasks.map((t) => [t.id, t.dueDate]));
  for (const it of plan.items) {
    if (it.source === "KEPT") continue; // a Keep carries the date the assignee picked
    if (due.has(it.taskId)) await prisma.planItem.update({ where: { id: it.id }, data: { plannedDue: due.get(it.taskId) ?? null } });
  }
  await prisma.monthPlan.update({ where: { id: plan.id }, data: { status: "LOCKED", lockedAt: new Date(), lockedById: by?.id } });
  const active = plan.items.filter((i) => !i.removedAt).length;
  await audit(by, "plan.lock", "MonthPlan", plan.id, { month, planned: active });
  return (await getPlan(month))!;
}

export async function promoteToPlan(month: string, taskId: string, by: User) {
  const plan = await ensurePlan(month);
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Task not found");
  await prisma.planItem.upsert({
    where: { planId_taskId: { planId: plan.id, taskId } },
    create: { planId: plan.id, taskId, source: "PROMOTED", plannedDue: task.dueDate, addedById: by.id },
    update: { source: "PROMOTED", removedAt: null, removedReason: null, removedNote: null, removedById: null, plannedDue: task.dueDate, addedById: by.id },
  });
  await audit(by, "plan.promote", "Task", taskId, { month, name: task.name });
}

export async function removeFromPlan(month: string, taskId: string, reason: RemoveReason, note: string | null, by: User) {
  const plan = await ensurePlan(month);
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  await prisma.planItem.upsert({
    where: { planId_taskId: { planId: plan.id, taskId } },
    create: { planId: plan.id, taskId, source: "DUE_DATE", plannedDue: task?.dueDate ?? null, removedAt: new Date(), removedReason: reason, removedNote: note, removedById: by.id },
    update: { removedAt: new Date(), removedReason: reason, removedNote: note, removedById: by.id },
  });
  await audit(by, "plan.remove", "Task", taskId, { month, reason, note, name: task?.name });
}

export async function restoreToPlan(month: string, taskId: string, by: User) {
  const plan = await ensurePlan(month);
  await prisma.planItem.updateMany({ where: { planId: plan.id, taskId }, data: { removedAt: null, removedReason: null, removedNote: null, removedById: null } });
  await audit(by, "plan.restore", "Task", taskId, { month });
}

/** Scheduler: make sure this month's plan exists, follows Zoho, and locks on time. */
export async function planTick(tasks: FullTask[], now = new Date()) {
  const month = currentMonth(now);
  const plan = await refreshPlan(month, tasks);
  if (plan.status === "DRAFT" && now >= plan.locksAt) await lockPlan(month, tasks, null);
}
