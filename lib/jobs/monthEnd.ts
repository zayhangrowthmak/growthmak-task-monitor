import { prisma, getState, setState } from "../db";
import { currentMonth, addMonths, IST_OFFSET_MS } from "../time";
import { renderReportPdf } from "../report";
import { acquireLock, releaseLock } from "../lock";
import { getPlan, lockPlan } from "../plan";
import { loadTasks } from "../metrics";

/** Report for a finished month: available from the 1st of the following month. */
export function reportAvailable(month: string, now = new Date()): boolean {
  return month < currentMonth(now);
}

export async function generateReport(month: string, force = false): Promise<Buffer> {
  if (!force) {
    const existing = await prisma.monthlyReport.findUnique({ where: { month } });
    if (existing) return Buffer.from(existing.pdf);
  }
  const pdf = new Uint8Array(await renderReportPdf(month));
  await prisma.monthlyReport.upsert({ where: { month }, create: { month, pdf }, update: { pdf, generatedAt: new Date() } });
  return Buffer.from(pdf);
}

/** From 00:30 IST on the 1st: make sure last month's plan is locked, then build its report once. */
export async function closePreviousMonthIfNeeded(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  if (ist.getUTCDate() === 1 && ist.getUTCHours() * 60 + ist.getUTCMinutes() < 30) return null;
  const last = addMonths(currentMonth(now), -1);
  if (await getState(`month.closed.${last}`)) return null;
  // Don't close a month before any data has synced (that broke the October trend in v1)
  if (!(await getState("sync.last_ok")) && !(await prisma.task.count())) return null;
  if (!(await acquireLock("month-end", 15))) return null;
  const log = await prisma.syncLog.create({ data: { kind: "month-end", detail: last } });
  try {
    const plan = await getPlan(last);
    if (plan && plan.status === "DRAFT") await lockPlan(last, await loadTasks(), null);
    await generateReport(last, true);
    await setState(`month.closed.${last}`, now.toISOString());
    await prisma.syncLog.update({ where: { id: log.id }, data: { ok: true, finishedAt: new Date() } });
    return last;
  } catch (e: any) {
    await prisma.syncLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), detail: `${last}: ${e?.message}` } });
    throw e;
  } finally {
    await releaseLock("month-end");
  }
}
