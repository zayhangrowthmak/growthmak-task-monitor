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
import { audit } from "@/lib/audit";
import { decide, undoDecision, approveKeep, applyChange, rejectChange as rejectZohoChange, canActOn } from "@/lib/review";
import { promoteToPlan, removeFromPlan, restoreToPlan, lockPlan } from "@/lib/plan";
import { loadTasks } from "@/lib/metrics";
import { saveSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { setState } from "@/lib/db";
import { enqueue } from "@/lib/cliq";
import { runAlerts } from "@/lib/jobs/alerts";

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

/** Monthly review panel: 4 criteria (1–5) + Manager and COO remarks, per person per month. */
export async function saveReview(form: FormData) {
  const admin = await requireAdmin();
  const score = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().min(1).max(5).nullable());
  const d = z
    .object({
      userId: z.string(),
      month: z.string().refine(isValidMonth),
      delivery: score,
      onTime: score,
      quality: score,
      ownership: score,
      managerRemarks: z.string().trim().max(4000).optional(),
      cooRemarks: z.string().trim().max(4000).optional(),
    })
    .parse(Object.fromEntries(form));
  const data = { delivery: d.delivery, onTime: d.onTime, quality: d.quality, ownership: d.ownership, managerRemarks: d.managerRemarks || null, cooRemarks: d.cooRemarks || null, reviewerId: admin.id };
  await prisma.monthlyReview.upsert({
    where: { userId_month: { userId: d.userId, month: d.month } },
    create: { userId: d.userId, month: d.month, ...data },
    update: data,
  });
  await audit(admin, "review.remarks", "User", d.userId, { month: d.month, delivery: d.delivery, onTime: d.onTime, quality: d.quality, ownership: d.ownership });
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


// ── v2 ──────────────────────────────────────────────────────────────────

const parseDate = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00+05:30`) : null;
};

/** Assignee's confidence for a planned task: 1 At Risk, 2 Watch, 3 On Track. */
export async function setConfidence(form: FormData) {
  const user = await requireUser();
  const taskId = String(form.get("taskId"));
  if (!(await canActOn(user, taskId))) throw new Error("Not your task");
  const raw = String(form.get("confidence") ?? "");
  const value = raw === "" ? null : Math.min(3, Math.max(1, Number(raw)));
  await prisma.task.update({ where: { id: taskId }, data: { userConfidence: value, userConfidenceAt: new Date() } });
  await audit(user, "task.confidence", "Task", taskId, { value });
  await runAlerts().catch(() => null);
  revalidatePath("/", "layout");
}

const SLIP = z.enum(["CLIENT_INPUT", "CLIENT_APPROVAL", "SCOPE_CHANGE", "CAPACITY", "INTERNAL_DEPENDENCY", "TECH_ISSUE", "OTHER"]);

/** Why a planned task slipped (asked when it goes overdue or is moved out of the month). */
export async function setSlipReason(form: FormData) {
  const user = await requireUser();
  const d = z.object({ taskId: z.string(), reason: SLIP, note: z.string().trim().max(1000).optional() }).parse(Object.fromEntries(form));
  if (!(await canActOn(user, d.taskId))) throw new Error("Not your task");
  if (d.reason === "OTHER" && !d.note) throw new Error("Add a note for Other");
  await prisma.task.update({ where: { id: d.taskId }, data: { slipReason: d.reason, slipNote: d.note || null, slipAt: new Date() } });
  await audit(user, "task.slip_reason", "Task", d.taskId, { reason: d.reason, note: d.note });
  revalidatePath("/", "layout");
}

/** Old-task review: Keep (with a date) / Backlog / Close, for one task or several at once. */
/** Decisions count at once: bring the current plan up to date (cheap; draft plans only change). */
async function refreshCurrentPlan() {
  const { refreshPlan } = await import("@/lib/plan");
  const { loadTasks } = await import("@/lib/metrics");
  const { currentMonth } = await import("@/lib/time");
  await refreshPlan(currentMonth(), await loadTasks()).catch((e) => console.error("[plan] refresh failed", e));
}

export async function decideOldTasks(form: FormData) {
  const user = await requireUser();
  const month = String(form.get("month"));
  if (!isValidMonth(month)) throw new Error("Bad month");
  const decision = z.enum(["KEEP", "BACKLOG", "CLOSE"]).parse(form.get("decision"));
  const ids = form.getAll("taskId").map(String).filter(Boolean);
  const note = String(form.get("note") ?? "").trim() || null;
  const due = parseDate(form.get("newDueDate"));
  for (const taskId of ids) await decide(user, { taskId, month, decision, newDueDate: decision === "KEEP" ? due : null, note });
  await refreshCurrentPlan();
  revalidatePath("/", "layout");
}

export async function undoOldTask(form: FormData) {
  const user = await requireUser();
  await undoDecision(user, String(form.get("taskId")), String(form.get("month")));
  await refreshCurrentPlan();
  revalidatePath("/", "layout");
}

export async function approveKeepAction(form: FormData) {
  const admin = await requireAdmin();
  await approveKeep(admin, String(form.get("taskId")), String(form.get("month")));
  await refreshCurrentPlan();
  revalidatePath("/", "layout");
}

/** Approvals page: push approved changes to Zoho (one or many). */
export async function approveChanges(form: FormData) {
  const admin = await requireAdmin();
  for (const id of form.getAll("changeId").map(String)) await applyChange(admin, id);
  revalidatePath("/", "layout");
}

export async function rejectChanges(form: FormData) {
  const admin = await requireAdmin();
  for (const id of form.getAll("changeId").map(String)) await rejectZohoChange(admin, id);
  await refreshCurrentPlan();
  revalidatePath("/", "layout");
}

// Plan editor
export async function promoteAction(form: FormData) {
  const admin = await requireAdmin();
  await promoteToPlan(String(form.get("month")), String(form.get("taskId")), admin);
  revalidatePath("/", "layout");
}

export async function removeFromPlanAction(form: FormData) {
  const admin = await requireAdmin();
  const reason = z.enum(["CLIENT_CANCELLED", "SCOPE_CHANGE", "MOVED_NEXT_MONTH", "OTHER"]).parse(form.get("reason"));
  const note = String(form.get("note") ?? "").trim() || null;
  if (reason === "OTHER" && !note) throw new Error("Add a note for Other");
  await removeFromPlan(String(form.get("month")), String(form.get("taskId")), reason, note, admin);
  revalidatePath("/", "layout");
}

export async function restoreToPlanAction(form: FormData) {
  const admin = await requireAdmin();
  await restoreToPlan(String(form.get("month")), String(form.get("taskId")), admin);
  revalidatePath("/", "layout");
}

export async function lockPlanNow(form: FormData) {
  const admin = await requireAdmin();
  await lockPlan(String(form.get("month")), await loadTasks(), admin);
  revalidatePath("/", "layout");
}

// Recurring deliverables
export async function addRecurring(form: FormData) {
  const admin = await requireAdmin();
  const d = z.object({ projectId: z.string().min(1), title: z.string().trim().min(3).max(200), ownerUserId: z.string().optional(), dayOfMonth: z.coerce.number().int().min(1).max(31) }).parse(Object.fromEntries(form));
  const t = await prisma.recurringTemplate.create({ data: { projectId: d.projectId, title: d.title, ownerUserId: d.ownerUserId || null, dayOfMonth: d.dayOfMonth } });
  await audit(admin, "recurring.add", "RecurringTemplate", t.id, d);
  revalidatePath("/settings");
}

export async function toggleRecurring(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("id"));
  const t = await prisma.recurringTemplate.update({ where: { id }, data: { active: form.get("active") === "true" } });
  await audit(admin, t.active ? "recurring.on" : "recurring.off", "RecurringTemplate", id, { title: t.title });
  revalidatePath("/settings");
}

/** A recurring deliverable has no Zoho task this month → ask (via approval) to create it. */
export async function requestRecurringTask(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("id"));
  const month = String(form.get("month"));
  const t = await prisma.recurringTemplate.findUnique({ where: { id } });
  if (!t || !isValidMonth(month)) return;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const due = new Date(`${month}-${String(Math.min(t.dayOfMonth, lastDay)).padStart(2, "0")}T00:00:00+05:30`);
  const owner = t.ownerUserId ? await prisma.user.findUnique({ where: { id: t.ownerUserId } }) : null;
  await prisma.zohoChange.create({
    data: { kind: "CREATE_TASK", projectId: t.projectId, payload: { name: t.title, due: due.toISOString(), ownerZpuid: owner?.zohoUserId ?? null, month }, summary: `Create "${t.title}" due ${due.toISOString().slice(0, 10)}${owner ? ` for ${owner.name}` : ""}`, source: "recurring", requestedById: admin.id },
  });
  revalidatePath("/", "layout");
}

export async function setCliqEmail(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("userId"));
  const email = String(form.get("cliqEmail") ?? "").trim().toLowerCase();
  await prisma.user.update({ where: { id }, data: { cliqEmail: email || null } });
  await audit(admin, "cliq.mapping", "User", id, { cliqEmail: email || null });
  revalidatePath("/settings");
}

const list = (v: FormDataEntryValue | null) => String(v ?? "").split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const num = (v: FormDataEntryValue | null, def: number) => (v === null || v === "" ? def : Number(v));

export async function saveSettingsAction(form: FormData) {
  const admin = await requireAdmin();
  const days = form.getAll("workingDays").map(Number).filter((n) => n >= 0 && n <= 6);
  const next = await saveSettings({
    ccEmails: list(form.get("ccEmails")),
    reportRecipients: list(form.get("reportRecipients")),
    quietStart: num(form.get("quietStart"), DEFAULT_SETTINGS.quietStart),
    quietEnd: num(form.get("quietEnd"), DEFAULT_SETTINGS.quietEnd),
    alertsEnabled: form.get("alertsEnabled") === "on",
    digestEnabled: form.get("digestEnabled") === "on",
    checkinEnabled: form.get("checkinEnabled") === "on",
    lockWorkingDay: num(form.get("lockWorkingDay"), DEFAULT_SETTINGS.lockWorkingDay),
    maxKeepMonths: num(form.get("maxKeepMonths"), DEFAULT_SETTINGS.maxKeepMonths),
    workloadGreen: num(form.get("workloadGreen"), DEFAULT_SETTINGS.workloadGreen),
    workloadAmber: num(form.get("workloadAmber"), DEFAULT_SETTINGS.workloadAmber),
    workingDays: days.length ? days : DEFAULT_SETTINGS.workingDays,
    reportPostHour: num(form.get("reportPostHour"), DEFAULT_SETTINGS.reportPostHour),
    includeRatingsInClientPdf: form.get("includeRatingsInClientPdf") === "on",
    backlogStatusName: String(form.get("backlogStatusName") || DEFAULT_SETTINGS.backlogStatusName),
    closedStatusName: String(form.get("closedStatusName") || DEFAULT_SETTINGS.closedStatusName),
  });
  await audit(admin, "settings.save", "Settings", null, next);
  revalidatePath("/", "layout");
}

export async function saveReportSummary(form: FormData) {
  const admin = await requireAdmin();
  const month = String(form.get("month"));
  if (!isValidMonth(month)) return;
  await setState(`report.summary.${month}`, String(form.get("summary") ?? "").trim());
  await prisma.monthlyReport.deleteMany({ where: { month } });
  await audit(admin, "report.summary", "MonthlyReport", month, null);
  revalidatePath("/reports");
}

/** Post a finished month's report to Cliq now (normally automatic on the 1st). */
export async function postReportNow(form: FormData) {
  await requireAdmin();
  const month = String(form.get("month"));
  if (!isValidMonth(month) || month >= currentMonth()) return;
  const { postMonthlyReport } = await import("@/lib/jobs/alerts");
  await postMonthlyReport(month);
  revalidatePath("/reports");
}
void enqueue;
