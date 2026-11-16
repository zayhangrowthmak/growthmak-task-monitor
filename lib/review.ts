// Monthly Old-Task Review: each assignee decides Keep / Backlog / Close for old open tasks.
// The decision counts in the dashboard straight away; Zoho is only changed when a manager
// approves the matching ZohoChange on the Approvals page.
import type { ReviewDecision, User } from "@prisma/client";
import { prisma } from "./db";
import { addMonths } from "./time";
import { getSettings } from "./settings";
import { audit } from "./audit";
import { updateDueDate, clearDueDate, setStatus, addComment, createTask } from "./zoho/write";
import { syncOneTask } from "./zoho/sync";
import { fmtDate } from "./time";

export async function canActOn(user: User, taskId: string): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  return !!(await prisma.taskAssignee.findFirst({ where: { taskId, userId: user.id } }));
}

/** How many consecutive previous months this task was already Kept. */
async function consecutiveKeeps(taskId: string, month: string): Promise<number> {
  let n = 0;
  for (let m = addMonths(month, -1); ; m = addMonths(m, -1)) {
    const r = await prisma.oldTaskReview.findUnique({ where: { taskId_month: { taskId, month: m } } });
    if (r?.decision !== "KEEP") return n;
    n++;
    if (n > 24) return n;
  }
}

export async function decide(
  user: User,
  input: { taskId: string; month: string; decision: ReviewDecision; newDueDate?: Date | null; note?: string | null }
) {
  if (!(await canActOn(user, input.taskId))) throw new Error("Not your task");
  const task = await prisma.task.findUnique({ where: { id: input.taskId }, include: { assignees: true } });
  if (!task) throw new Error("Task not found");
  const s = await getSettings();
  if (input.decision === "KEEP" && !input.newDueDate) throw new Error("Pick a due date for this month");
  const keeps = input.decision === "KEEP" ? await consecutiveKeeps(task.id, input.month) : 0;
  const needsApproval = input.decision === "KEEP" && keeps >= s.maxKeepMonths;
  const autoApproved = needsApproval && user.role === "ADMIN";
  const assigneeId = task.assignees.find((a) => a.userId === user.id)?.userId ?? task.assignees[0]?.userId ?? null;

  await prisma.oldTaskReview.upsert({
    where: { taskId_month: { taskId: task.id, month: input.month } },
    create: { taskId: task.id, month: input.month, userId: assigneeId, decision: input.decision, newDueDate: input.newDueDate ?? null, note: input.note ?? null, decidedById: user.id, needsApproval, approvedById: autoApproved ? user.id : null },
    update: { decision: input.decision, newDueDate: input.newDueDate ?? null, note: input.note ?? null, decidedById: user.id, decidedAt: new Date(), needsApproval, approvedById: autoApproved ? user.id : null },
  });

  // Replace any earlier pending Zoho change from a review of this task
  await prisma.zohoChange.deleteMany({ where: { taskId: task.id, source: "review", status: "PENDING" } });
  const label = `${task.key ? `${task.key} · ` : ""}${task.name}`;
  const base = { taskId: task.id, projectId: task.projectId, source: "review", requestedById: user.id };
  if (input.decision === "KEEP") {
    await prisma.zohoChange.create({ data: { ...base, kind: "UPDATE_DUE", payload: { due: input.newDueDate!.toISOString(), month: input.month }, summary: `${label}: due ${fmtDate(task.dueDate)} → ${fmtDate(input.newDueDate!)}` } });
  } else if (input.decision === "BACKLOG") {
    await prisma.zohoChange.create({ data: { ...base, kind: "SET_STATUS", payload: { status: s.backlogStatusName, clearDue: true, month: input.month }, summary: `${label}: move to "${s.backlogStatusName}" and clear the due date` } });
  } else {
    await prisma.zohoChange.create({ data: { ...base, kind: "SET_STATUS", payload: { status: s.closedStatusName, comment: input.note ?? null, month: input.month }, summary: `${label}: close as "${s.closedStatusName}"${input.note ? ` — "${input.note}"` : ""}` } });
  }
  await audit(user, `review.${input.decision.toLowerCase()}`, "Task", task.id, { month: input.month, newDueDate: input.newDueDate, note: input.note, needsApproval });
  return { needsApproval: needsApproval && !autoApproved };
}

export async function undoDecision(user: User, taskId: string, month: string) {
  if (!(await canActOn(user, taskId))) throw new Error("Not your task");
  await prisma.oldTaskReview.deleteMany({ where: { taskId, month } });
  await prisma.zohoChange.deleteMany({ where: { taskId, source: "review", status: "PENDING" } });
  await audit(user, "review.undo", "Task", taskId, { month });
}

/** A manager OKs a 3rd consecutive Keep, so it can join the plan. */
export async function approveKeep(admin: User, taskId: string, month: string) {
  await prisma.oldTaskReview.update({ where: { taskId_month: { taskId, month } }, data: { approvedById: admin.id } });
  await audit(admin, "review.approve_keep", "Task", taskId, { month });
}

/** Apply an approved change to Zoho, then re-read the task. */
export async function applyChange(admin: User, changeId: string): Promise<{ ok: boolean; error?: string }> {
  const ch = await prisma.zohoChange.findUnique({ where: { id: changeId } });
  if (!ch || (ch.status !== "PENDING" && ch.status !== "FAILED")) return { ok: false, error: "Already handled" };
  const p = ch.payload as any;
  try {
    if (ch.kind === "UPDATE_DUE") await updateDueDate(ch.projectId, ch.taskId!, new Date(p.due));
    else if (ch.kind === "CLEAR_DUE") await clearDueDate(ch.projectId, ch.taskId!);
    else if (ch.kind === "SET_STATUS") {
      await setStatus(ch.projectId, ch.taskId!, p.status);
      if (p.clearDue) await clearDueDate(ch.projectId, ch.taskId!).catch(() => null);
      if (p.comment) await addComment(ch.projectId, ch.taskId!, `Closed from the Task Monitor review: ${p.comment}`);
    } else if (ch.kind === "CREATE_TASK") await createTask(ch.projectId, { name: p.name, due: new Date(p.due), ownerZpuid: p.ownerZpuid });
    await prisma.zohoChange.update({ where: { id: ch.id }, data: { status: "APPLIED", decidedById: admin.id, decidedAt: new Date(), error: null } });
    await audit(admin, "zoho.apply", "ZohoChange", ch.id, { summary: ch.summary });
    if (ch.taskId) await syncOneTask(ch.projectId, ch.taskId).catch(() => null);
    return { ok: true };
  } catch (e: any) {
    const error = String(e?.message ?? e).slice(0, 500);
    await prisma.zohoChange.update({ where: { id: ch.id }, data: { status: "FAILED", decidedById: admin.id, decidedAt: new Date(), error } });
    await audit(admin, "zoho.apply_failed", "ZohoChange", ch.id, { summary: ch.summary, error });
    return { ok: false, error };
  }
}

/** Reject: Zoho stays as it is and the review decision is undone (the task goes back to pending). */
export async function rejectChange(admin: User, changeId: string) {
  const ch = await prisma.zohoChange.findUnique({ where: { id: changeId } });
  if (!ch || ch.status === "APPLIED") return;
  await prisma.zohoChange.update({ where: { id: ch.id }, data: { status: "REJECTED", decidedById: admin.id, decidedAt: new Date() } });
  const month = (ch.payload as any)?.month as string | undefined;
  if (ch.source === "review" && ch.taskId && month) await prisma.oldTaskReview.deleteMany({ where: { taskId: ch.taskId, month } });
  await audit(admin, "zoho.reject", "ZohoChange", ch.id, { summary: ch.summary });
}
