// v2 metrics: every monthly number is measured against the month's Plan.
// Old open tasks and Backlog are kept out unless re-committed (see lib/plan.ts).
import type { ClientType, PlanItem, PlanSource, Prisma, RemoveReason, SlipReason, StatusBucket } from "@prisma/client";
import { prisma } from "./db";
import { clientOf } from "./clients";
import { addMonths, currentMonth, dayDiff, endOfIstDay, monthLabel, monthRange } from "./time";
import { getSettings, type AppSettings } from "./settings";
import { workingDaysUntil, weeksOfMonth } from "./workdays";
import { getPlan, parkedTaskIds, type PlanWithItems } from "./plan";
import type { TaskState } from "./status";
import { slipLabel } from "./status";
import { delegatedTo, doers, isDoer } from "./people";

export const taskInclude = {
  project: true,
  assignees: { include: { user: true } },
  comments: { include: { author: true }, orderBy: { createdAt: "desc" } },
  reasonReviews: { include: { decidedBy: true }, orderBy: { submittedAt: "desc" }, take: 1 },
} satisfies Prisma.TaskInclude;

export type FullTask = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;
export const ALL = "all";

/**
 * Tasks shown on the dashboard. People removed in Settings are taken out completely:
 * tasks assigned only to them are dropped, and their names are hidden on shared tasks.
 */
export async function loadTasks(where: Prisma.TaskWhereInput = {}): Promise<FullTask[]> {
  const tasks = await prisma.task.findMany({
    where: {
      deleted: false,
      project: { active: true },
      NOT: { AND: [{ assignees: { some: {} } }, { assignees: { every: { user: { active: false } } } }] },
      ...where,
    },
    include: taskInclude,
    orderBy: [{ dueDate: "asc" }, { name: "asc" }],
  });
  for (const t of tasks) t.assignees = t.assignees.filter((a) => a.user.active);
  return tasks;
}

/** When the task was actually finished, if we know: Zoho's completion time, else the sync that saw it flip. */
export const doneAtOf = (t: FullTask): Date | null => t.completedAt ?? t.observedDoneAt ?? null;

export type Row = {
  task: FullTask;
  client: string;
  clientType: ClientType;
  source: PlanSource | "UNPLANNED" | "VIRTUAL";
  plannedDue: Date | null;
  dueChanged: boolean; // current Zoho due differs from planned due
  done: boolean;
  doneAt: Date | null;
  onTime: boolean | null; // null = not done, or done with unknown completion time
  slip: null | "OPEN" | "LATE" | "MOVED";
  waitingClient: boolean;
  blockedInternal: boolean;
  atRisk: boolean;
  daysLate: number;
  state: TaskState;
  removed?: { reason: RemoveReason | null; note: string | null; at: Date };
  delegatedTo?: string; // set on a person's view when they own the task but someone else is assigned to it
};

export type Pct = { value: number | null; n: number; d: number; small: boolean };
export const pct = (n: number, d: number): Pct => ({ value: d ? Math.round((n / d) * 1000) / 10 : null, n, d, small: d > 0 && d < 5 });

export type Metrics = {
  planned: number;
  completed: number;
  delivery: Pct;
  client: { planned: number; completed: number; delivery: Pct };
  internal: { planned: number; completed: number; delivery: Pct };
  onTime: Pct; // completed on/before planned due ÷ completed (known completion times only)
  slipped: number;
  slipOpen: number;
  slipLate: number;
  slipMoved: number;
  waitingClient: number;
  blockedInternal: number;
  atRisk: number;
  unplannedDone: number;
  oldPending: number;
  avgReviewDays: number | null;
  reasons: { reason: SlipReason; label: string; count: number }[];
};

const inRange = (d: Date | null | undefined, start: Date, end: Date) => !!d && d >= start && d < end;

/** Turn a task + its plan entry into a scored row, as of a moment. */
export function scoreRow(
  t: FullTask,
  opts: { month: string; plannedDue: Date | null; source: Row["source"]; asOf: Date; settings: AppSettings; live: boolean }
): Row {
  const { end } = monthRange(opts.month);
  const c = clientOf(t, t.project);
  const doneAtRaw = doneAtOf(t);
  const isDoneNow = t.bucket === "COMPLETED";
  // Done by asOf? With a known time we check it; without one we trust the current status.
  const done = doneAtRaw ? doneAtRaw <= opts.asOf : isDoneNow && opts.live;
  const doneAt = done ? doneAtRaw : null;
  const dueEnd = opts.plannedDue ? endOfIstDay(opts.plannedDue) : null;
  const onTime = done && doneAt && dueEnd ? doneAt <= dueEnd : null;
  const moved = !done && !!t.dueDate && t.dueDate >= end && !!opts.plannedDue && opts.plannedDue < end;
  const overdue = !done && !!dueEnd && opts.asOf > dueEnd;
  let slip: Row["slip"] = null;
  if (done && onTime === false) slip = "LATE";
  else if (moved) slip = "MOVED";
  else if (overdue) slip = "OPEN";
  const waitingClient = !done && t.bucket === "BLOCKED" && t.blockedType === "CLIENT";
  const blockedInternal = !done && t.bucket === "BLOCKED" && t.blockedType !== "CLIENT";
  const wd = t.dueDate ? workingDaysUntil(opts.asOf, t.dueDate, opts.settings.workingDays) : null;
  const atRisk = opts.live && !done && !slip && !waitingClient && (t.userConfidence === 1 || (wd !== null && wd <= 2 && t.bucket !== "REVIEW"));
  const daysLate = slip === "LATE" && doneAt && opts.plannedDue ? dayDiff(opts.plannedDue, doneAt) : slip === "OPEN" && opts.plannedDue ? dayDiff(opts.plannedDue, opts.asOf) : 0;

  let state: TaskState = "ON_TRACK";
  if (done) state = onTime === false ? "DONE_LATE" : "DONE";
  else if (moved) state = "MOVED";
  else if (waitingClient) state = "BLOCKED_CLIENT";
  else if (blockedInternal) state = "BLOCKED_INTERNAL";
  else if (overdue) state = "OVERDUE";
  else if (!t.dueDate && !opts.plannedDue) state = "NO_DUE";
  else if (opts.live && (t.userConfidence === 1 || (wd !== null && wd <= 1 && t.bucket !== "REVIEW"))) state = "AT_RISK";
  else if (opts.live && wd !== null && wd <= 2 && t.bucket !== "REVIEW") state = "TIGHT";

  return {
    task: t,
    client: c.name,
    clientType: c.type,
    source: opts.source,
    plannedDue: opts.plannedDue,
    dueChanged: !!opts.plannedDue && !!t.dueDate && Math.abs(opts.plannedDue.getTime() - t.dueDate.getTime()) > 60_000,
    done,
    doneAt,
    onTime,
    slip,
    waitingClient,
    blockedInternal,
    atRisk,
    daysLate,
    state,
  };
}

export function computeMetrics(rows: Row[], extra: { unplannedDone: number; oldPending: number; avgReviewDays: number | null }): Metrics {
  const done = rows.filter((r) => r.done);
  const known = done.filter((r) => r.onTime !== null);
  const cl = rows.filter((r) => r.clientType === "CLIENT");
  const inl = rows.filter((r) => r.clientType === "INTERNAL");
  const reasons = new Map<SlipReason, number>();
  for (const r of rows) if ((r.slip || r.waitingClient || r.blockedInternal) && r.task.slipReason) reasons.set(r.task.slipReason, (reasons.get(r.task.slipReason) ?? 0) + 1);
  const cDone = cl.filter((r) => r.done).length;
  const iDone = inl.filter((r) => r.done).length;
  return {
    planned: rows.length,
    completed: done.length,
    delivery: pct(done.length, rows.length),
    client: { planned: cl.length, completed: cDone, delivery: pct(cDone, cl.length) },
    internal: { planned: inl.length, completed: iDone, delivery: pct(iDone, inl.length) },
    onTime: pct(known.filter((r) => r.onTime).length, known.length),
    slipped: rows.filter((r) => r.slip).length,
    slipOpen: rows.filter((r) => r.slip === "OPEN").length,
    slipLate: rows.filter((r) => r.slip === "LATE").length,
    slipMoved: rows.filter((r) => r.slip === "MOVED").length,
    waitingClient: rows.filter((r) => r.waitingClient).length,
    blockedInternal: rows.filter((r) => r.blockedInternal).length,
    atRisk: rows.filter((r) => r.atRisk).length,
    unplannedDone: extra.unplannedDone,
    oldPending: extra.oldPending,
    avgReviewDays: extra.avgReviewDays,
    reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, label: slipLabel(reason), count })).sort((a, b) => b.count - a.count),
  };
}

export type OldTask = { task: FullTask; client: string; clientType: ClientType; daysOverdue: number | null; decision: { decision: string; newDueDate: Date | null; note: string | null; needsApproval: boolean; approved: boolean } | null };

export type MonthData = {
  month: string;
  live: boolean;
  asOf: Date;
  plan: PlanWithItems | null;
  virtual: boolean; // no stored plan (months before v2): planned = due in month
  rows: Row[]; // planned deliverables
  removed: Row[]; // removed from the plan after lock, with reason
  unplannedDone: Row[];
  unplannedOpen: Row[];
  old: OldTask[]; // current month only: old open tasks and their review decision
  delegated: Row[]; // one person's view: tasks they own but someone else is assigned to (not in their numbers)
  backlog: FullTask[];
  closed: FullTask[];
  metrics: Metrics;
  tasks: FullTask[];
};

/** Average days tasks spent in Review/QA during the month (from observed status changes). */
async function avgReviewDays(taskIds: string[], month: string, asOf: Date): Promise<number | null> {
  if (!taskIds.length) return null;
  const { start } = monthRange(month);
  const changes = await prisma.statusChange.findMany({ where: { taskId: { in: taskIds } }, orderBy: [{ taskId: "asc" }, { at: "asc" }] });
  const byTask = new Map<string, typeof changes>();
  for (const c of changes) byTask.set(c.taskId, [...(byTask.get(c.taskId) ?? []), c]);
  const stints: number[] = [];
  for (const list of byTask.values()) {
    for (let i = 0; i < list.length; i++) {
      if (list[i].to !== "REVIEW") continue;
      const enter = list[i].at;
      const leave = list[i + 1]?.at ?? asOf;
      if (leave < start || enter > asOf) continue;
      stints.push((leave.getTime() - Math.max(enter.getTime(), start.getTime())) / 86_400_000);
    }
  }
  return stints.length ? Math.round((stints.reduce((a, b) => a + b, 0) / stints.length) * 10) / 10 : null;
}

/**
 * Everything for one month, optionally for one person.
 * asOf defaults to now (current month) or the month's last moment (past months).
 */
export async function monthData(month: string, opts: { userId?: string; asOf?: Date; tasks?: FullTask[] } = {}): Promise<MonthData> {
  const settings = await getSettings();
  const now = new Date();
  const { start, end } = monthRange(month);
  const cur = currentMonth(now);
  const live = month === cur && !opts.asOf;
  const asOf = opts.asOf ?? (now < end ? now : new Date(end.getTime() - 1));
  const allTasks = opts.tasks ?? (await loadTasks());
  // For one person: count the tasks they do. Tasks they own but delegated are listed separately.
  const mine = (t: FullTask) => !opts.userId || isDoer(t, opts.userId);
  const delegatedOf = (t: FullTask) => (opts.userId ? delegatedTo(t, opts.userId) : null);
  const delegated: Row[] = [];
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const plan = month <= cur ? await getPlan(month) : null;
  const parked = await parkedTaskIds();
  const virtual = !plan;

  const rows: Row[] = [];
  const removed: Row[] = [];
  const inPlan = new Set<string>();
  if (plan) {
    for (const it of plan.items) {
      const t = byId.get(it.taskId);
      if (!t) continue;
      inPlan.add(t.id);
      if (!mine(t)) {
        const to = delegatedOf(t);
        if (to && !it.removedAt) delegated.push({ ...scoreRow(t, { month, plannedDue: it.plannedDue, source: it.source, asOf, settings, live }), delegatedTo: to });
        continue;
      }
      const r = scoreRow(t, { month, plannedDue: it.plannedDue, source: it.source, asOf, settings, live });
      if (it.removedAt) removed.push({ ...r, removed: { reason: it.removedReason, note: it.removedNote, at: it.removedAt } });
      else rows.push(r);
    }
  } else {
    for (const t of allTasks) {
      if (parked.has(t.id) || t.bucket === "BACKLOG" || t.bucket === "CLOSED") continue;
      if (!inRange(t.dueDate, start, end)) continue;
      inPlan.add(t.id);
      if (mine(t)) rows.push(scoreRow(t, { month, plannedDue: t.dueDate, source: "VIRTUAL", asOf, settings, live }));
      else { const to = delegatedOf(t); if (to) delegated.push({ ...scoreRow(t, { month, plannedDue: t.dueDate, source: "VIRTUAL", asOf, settings, live }), delegatedTo: to }); }
    }
  }

  // Unplanned: finished this month but not in the plan; or (current month) open and newly due here
  const unplannedDone: Row[] = [];
  const unplannedOpen: Row[] = [];
  for (const t of allTasks) {
    if (inPlan.has(t.id) || t.bucket === "BACKLOG" || t.bucket === "CLOSED") continue;
    if (!mine(t)) {
      const to = delegatedOf(t);
      if (to && live && !parked.has(t.id) && inRange(t.dueDate, start, end)) delegated.push({ ...scoreRow(t, { month, plannedDue: t.dueDate, source: "UNPLANNED", asOf, settings, live }), delegatedTo: to });
      continue;
    }
    const d = doneAtOf(t);
    if (t.bucket === "COMPLETED" && inRange(d, start, end) && d! <= asOf) unplannedDone.push(scoreRow(t, { month, plannedDue: t.dueDate, source: "UNPLANNED", asOf, settings, live }));
    else if (live && t.bucket !== "COMPLETED" && !parked.has(t.id) && inRange(t.dueDate, start, end))
      unplannedOpen.push(scoreRow(t, { month, plannedDue: t.dueDate, source: "UNPLANNED", asOf, settings, live }));
  }

  // Old open tasks (current month only): due before this month, or no due date and created earlier
  const old: OldTask[] = [];
  if (month === cur) {
    const decisions = await prisma.oldTaskReview.findMany({ where: { month } });
    const dec = new Map(decisions.map((d) => [d.taskId, d]));
    for (const t of allTasks) {
      if (!mine(t) || t.bucket === "COMPLETED") continue;
      const d = dec.get(t.id);
      // Decided tasks stay listed (so they can be undone) even after they join the plan or Zoho is updated
      if (!d) {
        if (inPlan.has(t.id) || t.bucket === "BACKLOG" || t.bucket === "CLOSED") continue;
        const isOld = t.dueDate ? t.dueDate < start : !!t.createdAtZoho && t.createdAtZoho < start;
        if (!isOld) continue;
      }
      if (!d && parked.has(t.id)) continue; // parked in an earlier month
      const c = clientOf(t, t.project);
      old.push({
        task: t,
        client: c.name,
        clientType: c.type,
        daysOverdue: t.dueDate ? dayDiff(t.dueDate, now) : null,
        decision: d ? { decision: d.decision, newDueDate: d.newDueDate, note: d.note, needsApproval: d.needsApproval, approved: !!d.approvedById } : null,
      });
    }
    old.sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1));
  }

  const backlog = allTasks.filter((t) => mine(t) && t.bucket !== "COMPLETED" && (t.bucket === "BACKLOG" || (parked.has(t.id) && t.bucket !== "CLOSED")));
  const closed = allTasks.filter((t) => mine(t) && (t.bucket === "CLOSED" || (parked.has(t.id) && t.bucket !== "BACKLOG" && t.bucket !== "COMPLETED")));

  const metrics = computeMetrics(rows, {
    unplannedDone: unplannedDone.length,
    oldPending: old.filter((o) => !o.decision).length,
    avgReviewDays: await avgReviewDays(rows.map((r) => r.task.id), month, asOf),
  });
  return { month, live, asOf, plan, virtual, rows, removed, unplannedDone, unplannedOpen, old, backlog, closed, metrics, delegated, tasks: allTasks };
}

/** The same month last month, as of the same point (for a running month) or in full. */
export async function previousFor(d: MonthData, userId?: string): Promise<Metrics | null> {
  const prevMonth = addMonths(d.month, -1);
  const asOf = d.live ? new Date(monthRange(prevMonth).start.getTime() + (d.asOf.getTime() - monthRange(d.month).start.getTime())) : undefined;
  const prev = await monthData(prevMonth, { userId, asOf, tasks: d.tasks });
  return prev.rows.length ? prev.metrics : null;
}

// ── Grouping ────────────────────────────────────────────────────────────

export type PersonRow = { userId: string; name: string; email: string; metrics: Metrics; personSlipped: number; clients: { name: string; planned: number; completed: number }[]; rows: Row[] };

/** One row per active person — including people with no tasks this month. Waiting-on-client never counts as their miss. */
export async function groupByPerson(d: MonthData): Promise<PersonRow[]> {
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const oldBy = new Map<string, number>();
  for (const o of d.old) if (!o.decision) for (const a of doers(o.task)) oldBy.set(a.userId, (oldBy.get(a.userId) ?? 0) + 1);
  const out: PersonRow[] = [];
  for (const u of users) {
    const rows = d.rows.filter((r) => isDoer(r.task, u.id));
    const unplanned = d.unplannedDone.filter((r) => isDoer(r.task, u.id)).length;
    // Admins with no tasks at all are managers, not delivery people — skip them
    if (!rows.length && !unplanned && !oldBy.get(u.id) && u.role === "ADMIN") continue;
    const metrics = computeMetrics(rows, { unplannedDone: unplanned, oldPending: oldBy.get(u.id) ?? 0, avgReviewDays: null });
    const clients = new Map<string, { planned: number; completed: number }>();
    for (const r of rows) {
      const c = clients.get(r.client) ?? { planned: 0, completed: 0 };
      c.planned++;
      if (r.done) c.completed++;
      clients.set(r.client, c);
    }
    out.push({
      userId: u.id,
      name: u.name,
      email: u.email,
      metrics,
      personSlipped: rows.filter((r) => r.slip && !r.waitingClient).length,
      clients: [...clients.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.planned - a.planned),
      rows,
    });
  }
  return out.sort((a, b) => b.metrics.planned - a.metrics.planned || a.name.localeCompare(b.name));
}

export type ClientRow = { name: string; type: ClientType; metrics: Metrics; rows: Row[]; waiting: { row: Row; days: number }[] };

export async function groupByClient(d: MonthData): Promise<ClientRow[]> {
  const map = new Map<string, { type: ClientType; rows: Row[] }>();
  for (const r of d.rows) {
    const e = map.get(r.client) ?? { type: r.clientType, rows: [] };
    e.rows.push(r);
    map.set(r.client, e);
  }
  const waitingSince = await blockedSince(d.rows.filter((r) => r.waitingClient).map((r) => r.task.id));
  return [...map.entries()]
    .map(([name, e]) => ({
      name,
      type: e.type,
      rows: e.rows,
      metrics: computeMetrics(e.rows, { unplannedDone: d.unplannedDone.filter((u) => u.client === name).length, oldPending: 0, avgReviewDays: null }),
      waiting: e.rows.filter((r) => r.waitingClient).map((row) => ({ row, days: dayDiff(waitingSince.get(row.task.id) ?? row.task.updatedAtZoho ?? d.asOf, d.asOf) })),
    }))
    .sort((a, b) => (a.type === b.type ? b.metrics.planned - a.metrics.planned : a.type === "CLIENT" ? -1 : 1));
}

/** When each task last entered Blocked (from observed status changes). */
export async function blockedSince(taskIds: string[]): Promise<Map<string, Date>> {
  if (!taskIds.length) return new Map();
  const rows = await prisma.statusChange.findMany({ where: { taskId: { in: taskIds }, to: "BLOCKED" }, orderBy: { at: "desc" } });
  const out = new Map<string, Date>();
  for (const r of rows) if (!out.has(r.taskId)) out.set(r.taskId, r.at);
  return out;
}

// ── Insights, trend, workload ───────────────────────────────────────────

export type Insight = { tone: "good" | "warn" | "crit" | "info"; text: string };
const f = (p: Pct) => (p.value === null ? "—" : `${p.value}% (${p.n}/${p.d})`);

export async function buildInsights(d: MonthData, prev: Metrics | null, people: PersonRow[], clients: ClientRow[]): Promise<Insight[]> {
  const m = d.metrics;
  const out: Insight[] = [];
  if (!m.planned) return [{ tone: "info", text: d.virtual ? "No deliverables were due this month." : "Nothing is in this month's plan yet." }];
  if (prev && m.client.delivery.value !== null && prev.client.delivery.value !== null) {
    const delta = Math.round((m.client.delivery.value - prev.client.delivery.value) * 10) / 10;
    out.push({ tone: delta >= 0 ? "good" : "crit", text: `Client delivery ${f(m.client.delivery)}, ${delta >= 0 ? "up" : "down"} ${Math.abs(delta)} pts on ${d.live ? "the same day last month" : "last month"}.` });
  } else if (m.client.planned) out.push({ tone: "info", text: `Client delivery ${f(m.client.delivery)}.` });
  if (m.slipped) out.push({ tone: "crit", text: `${m.slipped} planned deliverable${m.slipped === 1 ? "" : "s"} slipped: ${m.slipOpen} still open, ${m.slipLate} finished late, ${m.slipMoved} moved out of the month.` });
  const worst = people.filter((p) => p.personSlipped >= 2).sort((a, b) => b.personSlipped - a.personSlipped)[0];
  if (worst && m.slipped >= 3 && worst.personSlipped / m.slipped >= 0.4) out.push({ tone: "warn", text: `${worst.name} holds ${worst.personSlipped} of the ${m.slipped} slipped deliverables.` });
  const waiting = clients.flatMap((c) => c.waiting.map((w) => ({ ...w, client: c.name }))).sort((a, b) => b.days - a.days)[0];
  if (waiting) out.push({ tone: "warn", text: `Longest waiting on client: ${waiting.client} · ${waiting.row.task.name} (${waiting.days} days).` });
  const reviewHeavy = people.map((p) => ({ name: p.name, n: p.rows.filter((r) => !r.done && r.task.bucket === "REVIEW").length })).sort((a, b) => b.n - a.n)[0];
  if (reviewHeavy && reviewHeavy.n >= 3) out.push({ tone: "info", text: `Biggest review backlog: ${reviewHeavy.name} has ${reviewHeavy.n} deliverables in Review/QA${m.avgReviewDays !== null ? ` (team average ${m.avgReviewDays} days in review)` : ""}.` });
  const lag = clients.filter((c) => c.metrics.planned >= 3 && c.type === "CLIENT").sort((a, b) => (a.metrics.delivery.value ?? 0) - (b.metrics.delivery.value ?? 0))[0];
  if (lag && (lag.metrics.delivery.value ?? 0) < (m.delivery.value ?? 0) - 15) out.push({ tone: "warn", text: `${lag.name} is lagging: ${f(lag.metrics.delivery)} delivered.` });
  if (m.reasons[0]) out.push({ tone: "info", text: `Top slip reason: ${m.reasons[0].label} (${m.reasons[0].count}).` });
  if (m.unplannedDone) out.push({ tone: "info", text: `${m.unplannedDone} unplanned task${m.unplannedDone === 1 ? "" : "s"} also finished this month (not penalised).` });
  if (m.oldPending) out.push({ tone: "warn", text: `${m.oldPending} old open task${m.oldPending === 1 ? " is" : "s are"} waiting for a Keep / Backlog / Close decision.` });
  if (d.live && m.atRisk) out.push({ tone: "crit", text: `${m.atRisk} planned deliverable${m.atRisk === 1 ? " is" : "s are"} at risk right now.` });
  return out;
}

export type TrendPoint = { month: string; label: string; client: number | null; internal: number | null; onTime: number | null; planned: number };

/** Last N months, always N points (empty months show as gaps, never disappear). */
export async function trend(n: number, endMonth: string, tasks: FullTask[], userId?: string): Promise<TrendPoint[]> {
  const out: TrendPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const mo = addMonths(endMonth, -i);
    const d = await monthData(mo, { tasks, userId });
    out.push({ month: mo, label: monthLabel(mo, true), client: d.metrics.client.delivery.value, internal: d.metrics.internal.delivery.value, onTime: d.metrics.onTime.value, planned: d.metrics.planned });
  }
  return out;
}

/** Open planned deliverables per person per week of the month. */
export function workload(d: MonthData, people: PersonRow[]) {
  const weeks = weeksOfMonth(d.month);
  return {
    weeks,
    rows: people.map((p) => ({
      userId: p.userId,
      name: p.name,
      counts: weeks.map((w) => p.rows.filter((r) => !r.done && (r.task.dueDate ?? r.plannedDue) && inRange(r.task.dueDate ?? r.plannedDue, w.start, w.end)).length),
    })),
  };
}

/** Months offered in the timeline dropdown: from the first task month to now. */
export async function availableMonths(): Promise<string[]> {
  const first = await prisma.task.findFirst({ where: { deleted: false, dueDate: { not: null } }, orderBy: { dueDate: "asc" }, select: { dueDate: true } });
  const cur = currentMonth();
  const start = first?.dueDate ? currentMonth(first.dueDate) : cur;
  const out: string[] = [];
  for (let m = cur; out.length < 36; m = addMonths(m, -1)) {
    out.push(m);
    if (m <= start) break;
  }
  return out;
}

export type { PlanItem };
