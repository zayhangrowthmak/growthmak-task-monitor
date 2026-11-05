import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { computeMetrics, groupByClient, groupByPerson, loadTasks, monthView, periodData } from "../metrics";
import { currentMonth, addMonths } from "../time";
import { renderReportPdf } from "../report";
import { acquireLock, releaseLock } from "../lock";

/** Freeze month-end metrics so later edits in Zoho don't rewrite history. */
export async function snapshotMonth(month: string) {
  const tasks = await loadTasks();
  const items = monthView(tasks, month);
  const rows: { scope: string; metrics: unknown }[] = [{ scope: "overall", metrics: computeMetrics(items, false) }];
  for (const c of groupByClient(items, false)) rows.push({ scope: `client:${c.name}`, metrics: c.metrics });
  for (const p of groupByPerson(items, false)) rows.push({ scope: `user:${p.userId}`, metrics: p.metrics });
  for (const r of rows) {
    await prisma.monthlySnapshot.upsert({
      where: { month_scope: { month, scope: r.scope } },
      create: { month, scope: r.scope, metrics: r.metrics as Prisma.InputJsonValue },
      update: { metrics: r.metrics as Prisma.InputJsonValue },
    });
  }
  return rows.length;
}

/** Report for a finished month: available from the 1st of the following month. */
export function reportAvailable(month: string, now = new Date()): boolean {
  return month < currentMonth(now);
}

export async function generateReport(month: string, force = false): Promise<Buffer> {
  if (!force) {
    const existing = await prisma.monthlyReport.findUnique({ where: { month } });
    if (existing) return Buffer.from(existing.pdf);
  }
  const data = await periodData(month);
  const reviews = await prisma.monthlyReview.findMany({ where: { month }, include: { user: true } });
  const pdf = new Uint8Array(await renderReportPdf(month, data, reviews));
  await prisma.monthlyReport.upsert({ where: { month }, create: { month, pdf }, update: { pdf, generatedAt: new Date() } });
  return Buffer.from(pdf);
}

/** Runs on/after the 1st: snapshot + build last month's report once. */
export async function closePreviousMonthIfNeeded() {
  const last = addMonths(currentMonth(), -1);
  const done = await prisma.monthlySnapshot.findUnique({ where: { month_scope: { month: last, scope: "overall" } } });
  if (done) return null;
  if (!(await acquireLock("month-end", 15))) return null;
  const log = await prisma.syncLog.create({ data: { kind: "month-end", detail: last } });
  try {
    await snapshotMonth(last);
    await generateReport(last, true);
    await prisma.syncLog.update({ where: { id: log.id }, data: { ok: true, finishedAt: new Date() } });
    return last;
  } catch (e: any) {
    await prisma.syncLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), detail: `${last}: ${e?.message}` } });
    throw e;
  } finally {
    await releaseLock("month-end");
  }
}
