import { prisma } from "../db";
import { computeConfidence, shouldAlert } from "../confidence";
import { CONFIDENCE_META } from "../status";
import { postToCliq, cliqConfigured } from "../cliq";
import { clientOf } from "../clients";
import { config } from "../config";
import { fmtDate } from "../time";

/** Re-score every open task (time moves even when Zoho doesn't) and post Cliq alerts on worsening. */
export async function refreshConfidence(opts: { silent?: boolean; taskIds?: string[] } = {}): Promise<{ changed: number; alerts: number }> {
  const tasks = await prisma.task.findMany({
    where: { deleted: false, ...(opts.taskIds ? { id: { in: opts.taskIds } } : {}) },
    include: { project: true, assignees: { include: { user: true } } },
  });
  const now = new Date();
  let changed = 0;
  let alerts = 0;
  const pending: { taskId: string; level: "TIGHT" | "AT_RISK"; text: string; short: string }[] = [];

  for (const t of tasks) {
    const r = computeConfidence(
      {
        bucket: t.bucket,
        isClosed: t.isClosed,
        startDate: t.startDate,
        dueDate: t.dueDate,
        createdAt: t.createdAtZoho,
        completedAt: t.completedAt,
        completionPct: t.completionPct,
        flaggedAtRisk: t.flaggedAtRisk,
      },
      now
    );
    if (r.level === t.confidence && r.reason === t.confidenceReason) continue;
    changed++;
    const alert = !opts.silent && shouldAlert(t.confidence, r.level);
    await prisma.task.update({
      where: { id: t.id },
      data: { confidence: r.level, confidenceReason: r.reason, confidenceAt: now, ...(r.level === "DONE" ? { flaggedAtRisk: false } : {}) },
    });

    if (alert && cliqConfigured()) {
      const meta = CONFIDENCE_META[r.level];
      const client = clientOf(t, t.project).name;
      const who = t.assignees.map((a) => a.user.name).join(", ") || "Unassigned";
      const owner = t.project.ownerName ?? t.createdByName ?? "—";
      const text = [
        `${r.level === "AT_RISK" ? "🔴" : "🟡"} *${meta.label}*: ${t.key ? `[${t.key}] ` : ""}${t.name}`,
        `Client: ${client}  •  Due: ${fmtDate(t.dueDate)}  •  Status: ${t.zohoStatus}`,
        `Why: ${r.reason}`,
        `Assignee: ${who}  •  Owner: ${owner}`,
        `Dashboard: ${config.appUrl}/tasks/${t.id}${t.url ? `  •  Zoho: ${t.url}` : ""}`,
      ].join("\n");
      const short = `${r.level === "AT_RISK" ? "🔴" : "🟡"} ${t.key ? `[${t.key}] ` : ""}${t.name} (${client}) · ${who} · ${r.reason}`;
      pending.push({ taskId: t.id, level: r.level as "TIGHT" | "AT_RISK", text, short });
    }
  }

  // More than 5 at once (e.g. a batch going overdue at midnight) → one digest message
  if (pending.length > 5) {
    const atRisk = pending.filter((p) => p.level === "AT_RISK").length;
    const MAX = 20;
    const lines = pending.slice(0, MAX).map((p) => (p.short.length > 160 ? p.short.slice(0, 157) + "…" : p.short));
    if (pending.length > MAX) lines.push(`…and ${pending.length - MAX} more`);
    const text = [`*${pending.length} tasks changed confidence* (${atRisk} At Risk, ${pending.length - atRisk} Tight)`, ...lines, `Dashboard: ${config.appUrl}/overview`].join("\n");
    const res = await postToCliq(text);
    for (const p of pending) await prisma.alertLog.create({ data: { taskId: p.taskId, level: p.level, message: p.short, ok: res.ok, error: res.error } });
    if (res.ok) alerts += pending.length;
  } else {
    for (const p of pending) {
      const res = await postToCliq(p.text);
      await prisma.alertLog.create({ data: { taskId: p.taskId, level: p.level, message: p.text, ok: res.ok, error: res.error } });
      if (res.ok) alerts++;
    }
  }
  return { changed, alerts };
}
