// v2 Cliq alerts and scheduled posts.
import { doers } from "../people";
//  • Real-time alerts only for PLANNED deliverables of the current month
//  • One message per state change (Tight → At Risk → Overdue …); never the same state twice
//  • Follow-ups (Done, back on track) go into the task's thread
//  • 1st of month: old-task review per assignee + the monthly report with PDF
//  • Mondays: confidence check-in · weekdays (optional): morning digest
import type { User } from "@prisma/client";
import { prisma, getState, setState } from "../db";
import { config } from "../config";
import { getSettings } from "../settings";
import { ccLine, enqueue, mention } from "../cliq";
import { monthData, groupByClient, groupByPerson, previousFor, type MonthData, type Row } from "../metrics";
import { addMonths, currentMonth, fmtDate, IST_OFFSET_MS, monthLabel, startOfIstDay, DAY } from "../time";
import { istHour, workingDaysUntil } from "../workdays";
import { slipLabel, STATE_META, type TaskState } from "../status";

const ALERT_STATES: TaskState[] = ["TIGHT", "AT_RISK", "OVERDUE", "BLOCKED_CLIENT", "BLOCKED_INTERNAL"];
const TITLE: Partial<Record<TaskState, string>> = {
  TIGHT: "[TIGHT]",
  AT_RISK: "[AT RISK]",
  OVERDUE: "[OVERDUE]",
  BLOCKED_CLIENT: "[BLOCKED - CLIENT]",
  BLOCKED_INTERNAL: "[BLOCKED - INTERNAL]",
};

const who = (r: Row) => {
  const d = doers(r.task);
  const owners = r.task.assignees.filter((a) => a.role === "OWNER" && !d.includes(a));
  return (d.map((a) => mention(a.user)).join(" ") || "Unassigned") + (owners.length ? ` (owner: ${owners.map((a) => a.user.name).join(", ")})` : "");
};
const confText = (c: number | null) => (c === 1 ? "1 - At Risk" : c === 2 ? "2 - Watch" : c === 3 ? "3 - On Track" : "not set");

function dueText(r: Row, now: Date, workingDays: number[]): string {
  const due = r.task.dueDate ?? r.plannedDue;
  if (!due) return "no due date";
  if (r.state === "OVERDUE") return `${fmtDate(r.plannedDue ?? due)} (${r.daysLate} day${r.daysLate === 1 ? "" : "s"} overdue)`;
  const wd = workingDaysUntil(now, due, workingDays);
  return `${fmtDate(due)} (${wd <= 0 ? "due today" : `${wd} working day${wd === 1 ? "" : "s"} left`})`;
}

export async function alertText(r: Row, now: Date): Promise<string> {
  const s = await getSettings();
  const t = r.task;
  const last = t.comments[0];
  const lines = [
    `${TITLE[r.state]} ${r.client} - *${t.name}*`,
    `• Assignee: ${who(r)}`,
    `• Task: ${t.key ?? "—"}  |  Due: ${dueText(r, now, s.workingDays)}`,
    `• Status: ${t.zohoStatus}  |  Confidence: ${confText(t.userConfidence)}`,
  ];
  if (t.slipReason) lines.push(`• Reason: ${slipLabel(t.slipReason)}${t.slipNote ? ` — ${t.slipNote}` : ""}`);
  if (last) lines.push(`• Last update: ${fmtDate(last.createdAt)}, "${last.text.slice(0, 120)}"`);
  lines.push("", `Open in Zoho: ${t.url ?? "—"}  |  Update reason/date: ${config.appUrl}/tasks/${t.id}`, await ccLine());
  return lines.join("\n");
}

/** Work out each planned task's state and queue a post when it changes. */
export async function runAlerts(now = new Date(), opts: { silentBaseline?: boolean } = {}) {
  const s = await getSettings();
  const month = currentMonth(now);
  const d = await monthData(month);
  const existing = new Map((await prisma.cliqMessage.findMany({ where: { month } })).map((m) => [m.taskId, m]));
  const baselineKey = `cliq.v2.baseline.${month}`;
  const silent = opts.silentBaseline ?? !(await getState(baselineKey));
  let queued = 0;

  for (const r of d.rows) {
    const prev = existing.get(r.task.id);
    const state = r.state;
    const alertable = ALERT_STATES.includes(state);
    if (!prev) {
      if (!alertable) continue;
      await prisma.cliqMessage.create({ data: { taskId: r.task.id, month, lastState: state } });
      if (!silent && s.alertsEnabled) {
        await enqueue({ kind: "alert", taskId: r.task.id, month, state, text: await alertText(r, now) });
        queued++;
      }
      continue;
    }
    if (prev.lastState === state) continue;
    // Same "bucket" of trouble with no change worth posting
    if (!alertable && prev.lastState === "ON_TRACK") {
      await prisma.cliqMessage.update({ where: { id: prev.id }, data: { lastState: state } });
      continue;
    }
    await prisma.cliqMessage.update({ where: { id: prev.id }, data: { lastState: state } });
    if (silent || !s.alertsEnabled) continue;
    if (state === "DONE" || state === "DONE_LATE") {
      const by = doers(r.task).map((a) => mention(a.user)).join(" ") || "the team";
      const when = r.doneAt ? fmtDate(r.doneAt) : fmtDate(now);
      const tag = r.onTime === null ? "" : r.onTime ? " (on time)" : ` (${r.daysLate} day${r.daysLate === 1 ? "" : "s"} late)`;
      await enqueue({ kind: "reply", taskId: r.task.id, month, state, text: `[DONE] Completed ${when} by ${by}${tag}` });
    } else if (alertable) {
      await enqueue({ kind: "reply", taskId: r.task.id, month, state, text: await alertText(r, now) });
    } else if (state === "MOVED") {
      await enqueue({ kind: "reply", taskId: r.task.id, month, state, text: `[MOVED] Due date moved to ${fmtDate(r.task.dueDate)}, outside ${monthLabel(month)}. Counts as slipped (moved) this month.` });
    } else {
      await enqueue({ kind: "reply", taskId: r.task.id, month, state, text: `[RESOLVED] Back on track — due ${fmtDate(r.task.dueDate)}` });
    }
    queued++;
  }
  if (silent) await setState(baselineKey, now.toISOString());
  return { queued, silent };
}

const onceKey = (kind: string, day: string) => `cliq.once.${kind}.${day}`;
const istDay = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const istDow = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).getUTCDay();
const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).getUTCDate();

async function once(kind: string, now: Date, fn: () => Promise<void>) {
  const key = onceKey(kind, istDay(now));
  if (await getState(key)) return;
  await setState(key, now.toISOString());
  await fn();
}

/** 7.4 — one message per assignee with old open tasks, once a month. */
export async function postOldTaskReviews(now = new Date()) {
  const month = currentMonth(now);
  const d = await monthData(month);
  const plan = d.plan;
  const decideBy = plan ? fmtDate(plan.locksAt) : "the 3rd working day";
  const byUser = new Map<string, { user: User; items: typeof d.old }>();
  for (const o of d.old) for (const a of doers(o.task)) {
    const e = byUser.get(a.userId) ?? { user: a.user, items: [] };
    e.items.push(o);
    byUser.set(a.userId, e);
  }
  const cc = await ccLine();
  for (const { user, items } of byUser.values()) {
    const top = items.slice(0, 3).map((o) => `• ${o.task.key ?? ""} ${o.client} - ${o.task.name} (due ${fmtDate(o.task.dueDate)})`);
    const more = items.length > 3 ? [`• ...and ${items.length - 3} more`] : [];
    await enqueue({
      kind: "review",
      month,
      text: [
        `[MONTHLY REVIEW] Old open tasks - ${monthLabel(month)}`,
        "",
        `${mention(user)}, you have ${items.length} open task${items.length === 1 ? "" : "s"} from earlier months. Should we work on them this month, move them to backlog, or close them?`,
        "",
        ...top,
        ...more,
        "",
        `Decide by: ${decideBy}  |  Review now: ${config.appUrl}/review`,
        `Not decided by then = excluded from ${monthLabel(month).split(" ")[0]} and listed in the report.`,
        cc,
      ].join("\n"),
    });
  }
}

/** 7.5 — the monthly report summary, with the PDF attached. */
export async function postMonthlyReport(month: string) {
  const s = await getSettings();
  const d = await monthData(month);
  const m = d.metrics;
  const prev = await previousFor(d);
  void prev;
  const people = await groupByPerson(d);
  const clients = await groupByClient(d);
  const best = people.filter((p) => p.metrics.planned >= 5).sort((a, b) => (b.metrics.delivery.value ?? 0) - (a.metrics.delivery.value ?? 0))[0];
  const needs = clients.filter((c) => c.type === "CLIENT" && c.metrics.planned >= 3).sort((a, b) => (a.metrics.delivery.value ?? 0) - (b.metrics.delivery.value ?? 0))[0];
  const waiting = clients.flatMap((c) => c.waiting.map((w) => ({ ...w, client: c.name }))).sort((a, b) => b.days - a.days)[0];
  const reviews = await prisma.oldTaskReview.findMany({ where: { month } });
  const k = (x: string) => reviews.filter((r) => r.decision === x).length;
  const pctText = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
  const text = [
    `[MONTHLY REPORT] ${monthLabel(month)} deliverables ${s.reportRecipients.map((e) => `{@${e}}`).join(" ")}`,
    "",
    `• Planned: ${m.planned}  |  Completed: ${m.completed}  |  Delivery: ${pctText(m.delivery.value)} (Client ${pctText(m.client.delivery.value)}, Internal ${pctText(m.internal.delivery.value)})`,
    `• On time: ${pctText(m.onTime.value)}  |  Slipped: ${m.slipped} (${m.slipOpen} open, ${m.slipLate} late, ${m.slipMoved} moved)`,
    `• Waiting on client: ${m.waitingClient}${waiting ? ` (oldest: ${waiting.client} · ${waiting.row.task.name}, ${waiting.days} days)` : ""}`,
    m.reasons.length ? `• Top slip reasons: ${m.reasons.slice(0, 3).map((r) => `${r.label} (${r.count})`).join(", ")}` : "• Top slip reasons: none recorded",
    best ? `• Best delivery: ${best.name} ${pctText(best.metrics.delivery.value)} (${best.metrics.completed}/${best.metrics.planned})` : "",
    needs ? `• Needs attention: ${needs.name} ${needs.metrics.completed}/${needs.metrics.planned} done${needs.metrics.waitingClient ? `, ${needs.metrics.waitingClient} waiting on client` : ""}` : "",
    `• Old tasks: ${k("KEEP")} kept, ${k("BACKLOG")} backlog, ${k("CLOSE")} closed`,
    "",
    `Full report attached: Growthmak_Deliverables_${month}.pdf`,
    `Dashboard: ${config.appUrl}/overview?month=${month}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  await enqueue({ kind: "report", month, text, fileMonth: month, ignoreQuiet: true });
}

/** Monday 09:00 — ask each assignee to confirm confidence for planned tasks due this week. */
export async function postCheckins(now = new Date()) {
  const d = await monthData(currentMonth(now));
  const weekEnd = new Date(startOfIstDay(now).getTime() + 7 * DAY);
  const by = new Map<string, { user: User; rows: Row[] }>();
  for (const r of d.rows) {
    if (r.done || !r.task.dueDate || r.task.dueDate >= weekEnd) continue;
    for (const a of doers(r.task)) {
      const e = by.get(a.userId) ?? { user: a.user, rows: [] };
      e.rows.push(r);
      by.set(a.userId, e);
    }
  }
  for (const { user, rows } of by.values()) {
    await enqueue({
      kind: "checkin",
      text: [
        `[CONFIDENCE CHECK-IN] ${rows.length} planned deliverable${rows.length === 1 ? "" : "s"} due this week`,
        `${mention(user)}, please set confidence (1 At Risk · 2 Watch · 3 On Track):`,
        ...rows.slice(0, 6).map((r) => `• ${r.task.key ?? ""} ${r.client} - ${r.task.name} (due ${fmtDate(r.task.dueDate)}, now: ${confText(r.task.userConfidence)})`),
        rows.length > 6 ? `• ...and ${rows.length - 6} more` : "",
        `Update here: ${config.appUrl}/me`,
      ].filter(Boolean).join("\n"),
    });
  }
}

/** Optional weekday 09:00 digest: due today, newly at risk, waiting on client > 7 days. */
export async function postDigest(now = new Date()) {
  const d = await monthData(currentMonth(now));
  const today = istDay(now);
  const dueToday = d.rows.filter((r) => !r.done && r.task.dueDate && istDay(r.task.dueDate) === today);
  const risk = d.rows.filter((r) => r.state === "AT_RISK");
  const clients = await groupByClient(d);
  const longWait = clients.flatMap((c) => c.waiting.filter((w) => w.days > 7).map((w) => ({ ...w, client: c.name })));
  if (!dueToday.length && !risk.length && !longWait.length) return;
  const line = (r: Row) => `• ${r.client} - ${r.task.name} · ${who(r)}`;
  await enqueue({
    kind: "digest",
    text: [
      `[MORNING DIGEST] ${fmtDate(now)}`,
      dueToday.length ? `Due today (${dueToday.length}):` : "",
      ...dueToday.slice(0, 8).map(line),
      risk.length ? `At risk (${risk.length}):` : "",
      ...risk.slice(0, 8).map(line),
      longWait.length ? `Waiting on client > 7 days (${longWait.length}):` : "",
      ...longWait.slice(0, 8).map((w) => `• ${w.client} - ${w.row.task.name} (${w.days} days) · ${who(w.row)}`),
      `Dashboard: ${config.appUrl}/overview`,
    ].filter(Boolean).join("\n"),
  });
}

/** Called every minute by the scheduler. */
export async function cliqScheduleTick(now = new Date()) {
  const s = await getSettings();
  const h = istHour(now);
  const dow = istDow(now);
  const date = istDate(now);
  const workday = s.workingDays.includes(dow);
  if (date === 1 && h >= s.reportPostHour) {
    await once("monthly-report", now, () => postMonthlyReport(addMonths(currentMonth(now), -1)));
    await once("old-task-review", now, () => postOldTaskReviews(now));
  }
  if (s.checkinEnabled && dow === 1 && h >= 9) await once("checkin", now, () => postCheckins(now));
  if (s.digestEnabled && workday && h >= 9) await once("digest", now, () => postDigest(now));
}

export { STATE_META };
export type { MonthData };
