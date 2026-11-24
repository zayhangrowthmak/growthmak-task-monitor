"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { currentMonth, isValidMonth } from "@/lib/time";
import { fullSync } from "@/lib/zoho/sync";
import { postToCliq } from "@/lib/cliq";
import { generateReport } from "@/lib/jobs/monthEnd";
import { submitFeedbackFor } from "@/lib/feedback";
import { audit } from "@/lib/audit";
import { promoteToPlan, removeFromPlan, restoreToPlan, lockPlan } from "@/lib/plan";
import { loadTasks } from "@/lib/metrics";
import { saveSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { setState } from "@/lib/db";
import { enqueue } from "@/lib/cliq";
import { runAlerts } from "@/lib/jobs/alerts";

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

/** Task updates: reply or follow up on a task. Posted as a comment on the Zoho task; tagged people get a Cliq ping. */
export async function postUpdateAction(form: FormData) {
  const user = await requireAdmin();
  const d = z
    .object({ taskId: z.string().min(1), text: z.string().trim().min(2).max(2000), kind: z.enum(["reply", "follow_up"]).default("reply") })
    .parse({ taskId: form.get("taskId"), text: form.get("text"), kind: form.get("kind") ?? undefined });
  const tags = form.getAll("tag").map(String).filter(Boolean).slice(0, 10);
  const { postUpdate, flushZohoComments } = await import("@/lib/updates");
  await postUpdate(user, d.taskId, d.text, tags, d.kind);
  // Send now rather than on the next scheduler tick
  await flushZohoComments(5).catch((e) => console.error("[zoho comments]", e));
  void import("@/lib/cliq").then((m) => m.flushOutbox()).catch((e) => console.error("[cliq]", e));
  revalidatePath("/", "layout");
}

/** Task updates: read the latest Zoho comments for one task now. */
export async function refreshThreadAction(form: FormData) {
  await requireAdmin();
  const { refreshComments } = await import("@/lib/updates");
  await refreshComments(String(form.get("taskId"))).catch((e) => console.error("[updates]", e));
  revalidatePath("/updates");
}
