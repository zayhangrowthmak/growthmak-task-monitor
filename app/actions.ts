"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { currentMonth, isValidMonth } from "@/lib/time";
import { refreshConfidence } from "@/lib/jobs/confidence";
import { fullSync } from "@/lib/zoho/sync";
import { postToCliq } from "@/lib/cliq";
import { generateReport } from "@/lib/jobs/monthEnd";
import { submitFeedbackFor } from "@/lib/feedback";

const REASON = z.enum(["CLIENT_DEPENDENCY", "WAITING_APPROVAL", "INTERNAL_DELAY", "RESOURCE_ABSENT", "SCOPE_CHANGE", "TOOL_ACCESS", "OTHER"]);

/** Per-task comment, added during the review call. Assignees comment on their own tasks; admins on any. */
export async function addComment(form: FormData) {
  const user = await requireUser();
  const data = z
    .object({ taskId: z.string(), reason: REASON, text: z.string().trim().min(2).max(2000), month: z.string().optional(), flag: z.string().optional() })
    .parse(Object.fromEntries(form));
  const task = await prisma.task.findUnique({ where: { id: data.taskId }, include: { assignees: true } });
  if (!task) throw new Error("Task not found");
  if (user.role !== "ADMIN" && !task.assignees.some((a) => a.userId === user.id)) throw new Error("Not your task");
  await prisma.taskComment.create({
    data: { taskId: task.id, authorId: user.id, reason: data.reason, text: data.text, month: isValidMonth(data.month) ? data.month : currentMonth() },
  });
  if (data.flag === "on" && !task.isClosed) {
    await prisma.task.update({ where: { id: task.id }, data: { flaggedAtRisk: true } });
    await refreshConfidence({ taskIds: [task.id] });
  }
  revalidatePath("/", "layout");
}

export async function clearFlag(form: FormData) {
  const user = await requireUser();
  const taskId = String(form.get("taskId"));
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { assignees: true } });
  if (!task) return;
  if (user.role !== "ADMIN" && !task.assignees.some((a) => a.userId === user.id)) return;
  await prisma.task.update({ where: { id: taskId }, data: { flaggedAtRisk: false } });
  await refreshConfidence({ taskIds: [taskId], silent: true });
  revalidatePath("/", "layout");
}

/** Monthly review: super admin's overall comment + 1–10 rating per person per month. */
export async function saveReview(form: FormData) {
  const admin = await requireAdmin();
  const d = z
    .object({ userId: z.string(), month: z.string().refine(isValidMonth), rating: z.coerce.number().int().min(1).max(10), comment: z.string().trim().max(4000) })
    .parse(Object.fromEntries(form));
  await prisma.monthlyReview.upsert({
    where: { userId_month: { userId: d.userId, month: d.month } },
    create: { userId: d.userId, month: d.month, rating: d.rating, comment: d.comment, reviewerId: admin.id },
    update: { rating: d.rating, comment: d.comment, reviewerId: admin.id },
  });
  // A changed review should show up in a regenerated report
  await prisma.monthlyReport.deleteMany({ where: { month: d.month } });
  revalidatePath("/", "layout");
}

export async function setProjectClient(form: FormData) {
  await requireAdmin();
  const id = String(form.get("projectId"));
  const name = String(form.get("clientOverride") ?? "").trim();
  const type = String(form.get("clientType") ?? "");
  await prisma.project.update({
    where: { id },
    data: { clientOverride: name || null, clientTypeOverride: type === "CLIENT" || type === "INTERNAL" ? type : null },
  });
  revalidatePath("/", "layout");
}

export async function setRole(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("userId"));
  if (id === admin.id) return; // can't demote yourself
  const role = form.get("role") === "ADMIN" ? "ADMIN" : "MEMBER";
  await prisma.user.update({ where: { id }, data: { role } });
  revalidatePath("/settings");
}

/** Remove someone from the dashboard (ex-employees, placeholder users) or bring them back. */
export async function setUserActive(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("userId"));
  if (id === admin.id) return;
  await prisma.user.update({ where: { id }, data: { active: form.get("active") === "true" } });
  revalidatePath("/", "layout");
}

export async function syncNow() {
  await requireAdmin();
  fullSync().catch((e) => console.error("[sync] manual sync failed", e));
  await new Promise((r) => setTimeout(r, 1500));
  revalidatePath("/settings");
}

export async function testCliq() {
  await requireAdmin();
  const r = await postToCliq("✅ Growthmak Task Monitor is connected. Tight / At Risk alerts will appear in this channel.");
  await prisma.syncLog.create({ data: { kind: "cliq-test", ok: r.ok, finishedAt: new Date(), detail: r.error ?? "sent" } });
  revalidatePath("/settings");
}

export async function regenerateReport(form: FormData) {
  await requireAdmin();
  const month = String(form.get("month"));
  if (!isValidMonth(month) || month >= currentMonth()) return;
  await generateReport(month, true);
  revalidatePath("/reports");
}

/** Feedback form (any signed-in user). Returns a small result for the dialog to show. */
export async function submitFeedback(_prev: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const parsed = z
    .object({
      type: z.enum(["FEATURE", "PROBLEM", "DATA_ISSUE", "OTHER"]),
      subject: z.string().trim().min(3, "Add a short subject").max(150),
      message: z.string().trim().min(5, "Tell us a bit more").max(5000),
      page: z.string().max(300).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the form" };
  const r = await submitFeedbackFor(user, parsed.data);
  revalidatePath("/settings");
  return { ok: true, message: r.emailed ? "Thanks! Your feedback was sent." : "Thanks! Your feedback was saved (email is not set up yet, so an admin will see it in Settings)." };
}
