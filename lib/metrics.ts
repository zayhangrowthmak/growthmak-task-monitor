// Month views and team metrics. Everything here is time-first: what got done,
// what was on time, what slipped, what is stuck, and what rolled over.
import type { ClientType, Prisma, ReasonCategory, StatusBucket } from "@prisma/client";
import { prisma } from "./db";
import { clientOf } from "./clients";
import { addMonths, currentMonth, dayDiff, endOfIstDay, monthLabel, monthRange } from "./time";
import { BUCKETS, reasonLabel } from "./status";

export const taskInclude = {
  project: true,
  assignees: { include: { user: true } },
  comments: { include: { author: true }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.TaskInclude;

export type FullTask = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export type MonthTask = {
  task: FullTask;
  client: string;
  clientType: ClientType;
  state: StatusBucket; // status as of month end (or now, for the current month)
  done: boolean;
  onTime: boolean | null; // null = no due date or not done
  overdueOpen: boolean;
  finishedLate: boolean;
  carried: boolean; // came in from an earlier month unfinished
  daysLate: number;
};

export type Metrics = {
  total: number;
  completed: number;
  completedPct: number;
  onTimePct: number | null;
  missed: number;
  missedPct: number;
  overdueOpen: number;
  finishedLate: number;
  buckets: Record<StatusBucket, number>;
  bucketPct: Record<StatusBucket, number>;
  atRisk: number;
  tight: number;
  noDue: number;
  carried: number;
  avgDaysLate: number | null;
  hours: number;
};

export const ALL = "all";

export async function loadTasks(where: Prisma.TaskWhereInput = {}): Promise<FullTask[]> {
  return prisma.task.findMany({
    where: { deleted: false, project: { active: true }, ...where },
    include: taskInclude,
    orderBy: [{ dueDate: "asc" }, { name: "asc" }],
  });
}

/** Which tasks belong to a month, and what their state was in that month. */
export function monthView(tasks: FullTask[], month: string, now = new Date()): MonthTask[] {
  const out: MonthTask[] = [];
  const isAll = month === ALL;
  const { start, end } = isAll ? { start: new Date(0), end: new Date(8.64e15) } : monthRange(month);
  const asOf = now < end ? now : new Date(end.getTime() - 1);
  const isCurrent = isAll || month === currentMonth(now);

  for (const t of tasks) {
    const created = t.createdAtZoho ?? t.startDate ?? t.dueDate;
    if (!isAll && created && created >= end) continue;
    const completedBy = t.completedAt && t.completedAt <= asOf ? t.completedAt : null;
    const completedBeforeStart = t.completedAt && t.completedAt < start;

    let include = false;
    let carried = false;
    if (isAll) include = true;
    else if (t.dueDate && t.dueDate >= start && t.dueDate < end) include = true;
    else if (t.completedAt && t.completedAt >= start && t.completedAt < end) include = true;
    else if (!t.dueDate && created && created >= start && created < end) include = true;
    else if (!completedBeforeStart && ((t.dueDate && t.dueDate < start) || (!t.dueDate && created && created < start))) {
      // Unfinished at the start of this month → carried over
      if (!t.isClosed || (t.completedAt && t.completedAt >= start)) {
        include = true;
        carried = true;
      }
    }
    if (!include) continue;
    if (carried === false && !isAll && t.dueDate && t.dueDate < start) carried = true;

    const done = isCurrent ? t.isClosed : Boolean(completedBy);
    let state: StatusBucket = done ? "COMPLETED" : t.bucket;
    if (!done && state === "COMPLETED") state = "IN_PROGRESS"; // finished only after that month ended

    const dueEnd = t.dueDate ? endOfIstDay(t.dueDate) : null;
    const finishAt = done ? t.completedAt ?? asOf : null;
    const finishedLate = Boolean(done && dueEnd && finishAt && finishAt > dueEnd);
    const overdueOpen = Boolean(!done && dueEnd && asOf > dueEnd);
    const daysLate = finishedLate ? dayDiff(t.dueDate!, finishAt!) : overdueOpen ? dayDiff(t.dueDate!, asOf) : 0;
    const c = clientOf(t, t.project);

    out.push({
      task: t,
      client: c.name,
      clientType: c.type,
      state,
      done,
      onTime: done && dueEnd ? !finishedLate : null,
      overdueOpen,
      finishedLate,
      carried,
      daysLate,
    });
  }
  return out;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export function computeMetrics(items: MonthTask[], live: boolean): Metrics {
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b.key, 0])) as Record<StatusBucket, number>;
  let completed = 0, onTime = 0, doneWithDue = 0, overdueOpen = 0, finishedLate = 0;
  let atRisk = 0, tight = 0, noDue = 0, carried = 0, lateDays = 0, lateCount = 0, hours = 0;
  for (const m of items) {
    buckets[m.state]++;
    if (m.done) completed++;
    if (m.onTime !== null) {
      doneWithDue++;
      if (m.onTime) onTime++;
    }
    if (m.overdueOpen) overdueOpen++;
    if (m.finishedLate) finishedLate++;
    if (m.daysLate > 0) {
      lateDays += m.daysLate;
      lateCount++;
    }
    if (!m.task.dueDate) noDue++;
    if (m.carried) carried++;
    hours += m.task.loggedHours;
    if (live && !m.done) {
      if (m.task.confidence === "AT_RISK") atRisk++;
      if (m.task.confidence === "TIGHT") tight++;
    }
  }
  const total = items.length;
  const missed = overdueOpen + finishedLate;
  return {
    total,
    completed,
    completedPct: pct(completed, total),
    onTimePct: doneWithDue ? pct(onTime, doneWithDue) : null,
    missed,
    missedPct: pct(missed, total),
    overdueOpen,
    finishedLate,
    buckets,
    bucketPct: Object.fromEntries(BUCKETS.map((b) => [b.key, pct(buckets[b.key], total)])) as Record<StatusBucket, number>,
    atRisk,
    tight,
    noDue,
    carried,
    avgDaysLate: lateCount ? Math.round((lateDays / lateCount) * 10) / 10 : null,
    hours: Math.round(hours * 10) / 10,
  };
}

export type PersonRow = {
  userId: string;
  name: string;
  email: string;
  metrics: Metrics;
  clients: string[];
};

export type ClientRow = {
  name: string;
  type: ClientType;
  metrics: Metrics;
  people: { userId: string; name: string; metrics: Metrics }[];
  items: MonthTask[];
};

export function groupByPerson(items: MonthTask[], live: boolean): PersonRow[] {
  const map = new Map<string, { name: string; email: string; items: MonthTask[] }>();
  for (const m of items) {
    for (const a of m.task.assignees) {
      if (!a.user.active) continue; // people removed in Settings don't appear in people views
      const e = map.get(a.userId) ?? { name: a.user.name, email: a.user.email, items: [] };
      e.items.push(m);
      map.set(a.userId, e);
    }
  }
  return [...map.entries()]
    .map(([userId, e]) => ({
      userId,
      name: e.name,
      email: e.email,
      metrics: computeMetrics(e.items, live),
      clients: [...new Set(e.items.map((i) => i.client))].sort(),
    }))
    .sort((a, b) => b.metrics.total - a.metrics.total);
}

export function groupByClient(items: MonthTask[], live: boolean): ClientRow[] {
  const map = new Map<string, { type: ClientType; items: MonthTask[] }>();
  for (const m of items) {
    const e = map.get(m.client) ?? { type: m.clientType, items: [] };
    e.items.push(m);
    map.set(m.client, e);
  }
  return [...map.entries()]
    .map(([name, e]) => ({
      name,
      type: e.type,
      metrics: computeMetrics(e.items, live),
      people: groupByPerson(e.items, live).map((p) => ({ userId: p.userId, name: p.name, metrics: p.metrics })),
      items: e.items,
    }))
    .sort((a, b) => (a.type === b.type ? b.metrics.total - a.metrics.total : a.type === "CLIENT" ? -1 : 1));
}

/** Count the reason categories on comments made during the month for these tasks. */
export function reasonCounts(items: MonthTask[], month: string): { reason: ReasonCategory; label: string; count: number }[] {
  const counts = new Map<ReasonCategory, number>();
  for (const m of items) {
    const cs = month === ALL ? m.task.comments : m.task.comments.filter((c) => c.month === month);
    // Use the latest comment per task so one task can't dominate the pattern
    const latest = cs[0];
    if (latest) counts.set(latest.reason, (counts.get(latest.reason) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, label: reasonLabel(reason), count })).sort((a, b) => b.count - a.count);
}

export type Insight = { tone: "good" | "warn" | "crit" | "info"; text: string };

export function buildInsights(args: {
  metrics: Metrics;
  prev?: Metrics | null;
  people: PersonRow[];
  clients: ClientRow[];
  reasons: { label: string; count: number }[];
  live: boolean;
}): Insight[] {
  const { metrics: m, prev, people, clients, reasons, live } = args;
  const out: Insight[] = [];
  if (!m.total) return [{ tone: "info", text: "No tasks fall in this period yet." }];

  if (prev && prev.total) {
    const d = Math.round((m.completedPct - prev.completedPct) * 10) / 10;
    if (Math.abs(d) >= 1)
      out.push({ tone: d > 0 ? "good" : "crit", text: `Completion is ${d > 0 ? "up" : "down"} ${Math.abs(d)} pts on ${live ? "the same point last month" : "last month"} (from ${prev.completedPct}% to ${m.completedPct}%).` });
    else out.push({ tone: "info", text: `Completion is flat on ${live ? "the same point last month" : "last month"} at ${m.completedPct}%. No progress means something needs a push.` });
  }

  const open = m.total - m.completed;
  if (open > 0) {
    const top = (["BLOCKED", "IN_PROGRESS", "REVIEW", "READY"] as StatusBucket[]).map((b) => ({ b, n: m.buckets[b] })).sort((a, b) => b.n - a.n)[0];
    const share = Math.round((top.n / open) * 100);
    const label = { BLOCKED: "Blocked / Waiting", IN_PROGRESS: "In Progress", REVIEW: "Review / QA", READY: "Ready (not started)", COMPLETED: "" }[top.b];
    if (share >= 40) out.push({ tone: top.b === "BLOCKED" ? "crit" : top.b === "READY" ? "warn" : "info", text: `${share}% of unfinished work is ${label} (${top.n} of ${open}).` });
  }

  const stuck = people
    .map((p) => ({ name: p.name, n: p.metrics.overdueOpen + p.metrics.buckets.BLOCKED }))
    .filter((p) => p.n > 0)
    .sort((a, b) => b.n - a.n);
  const stuckTotal = m.overdueOpen + m.buckets.BLOCKED;
  if (stuck[0] && stuckTotal >= 3 && stuck[0].n / stuckTotal >= 0.4)
    out.push({ tone: "warn", text: `${stuck[0].name} holds ${stuck[0].n} of the ${stuckTotal} overdue or blocked tasks.` });

  if (m.missed > 0) out.push({ tone: "crit", text: `${m.missed} task${m.missed === 1 ? "" : "s"} missed the deadline (${m.overdueOpen} still open, ${m.finishedLate} finished late).` });
  if (m.onTimePct !== null && m.onTimePct >= 90 && m.completed >= 5) out.push({ tone: "good", text: `${m.onTimePct}% of finished work landed on time.` });

  const laggard = clients.filter((c) => c.metrics.total >= 3).sort((a, b) => a.metrics.completedPct - b.metrics.completedPct)[0];
  if (laggard && laggard.metrics.completedPct < m.completedPct - 15)
    out.push({ tone: "warn", text: `${laggard.name} is lagging: ${laggard.metrics.completedPct}% complete vs ${m.completedPct}% overall.` });

  if (reasons[0] && reasons[0].count >= 2) out.push({ tone: "info", text: `Most common reason given for delays: ${reasons[0].label} (${reasons[0].count} tasks).` });
  if (m.carried > 0) out.push({ tone: "info", text: `${m.carried} task${m.carried === 1 ? "" : "s"} carried over from earlier months.` });
  if (live && m.atRisk > 0) out.push({ tone: "crit", text: `${m.atRisk} open task${m.atRisk === 1 ? " is" : "s are"} At Risk right now, ${m.tight} Tight.` });
  if (m.noDue > 0) out.push({ tone: "warn", text: `${m.noDue} task${m.noDue === 1 ? " has" : "s have"} no due date in Zoho, so time can't be tracked on ${m.noDue === 1 ? "it" : "them"}.` });
  return out;
}

/** Everything a dashboard page needs for one period. */
export async function periodData(month: string, filterUserId?: string) {
  const tasks = await loadTasks(filterUserId ? { assignees: { some: { userId: filterUserId } } } : {});
  const now = new Date();
  const live = month === ALL || month === currentMonth(now);
  const items = monthView(tasks, month, now);
  const metrics = computeMetrics(items, live);
  const prevMonth = month === ALL ? null : addMonths(month, -1);
  let prev: Metrics | null = null;
  if (prevMonth && month === currentMonth(now)) {
    // Month still running: compare with last month at the same point, not its full total
    const samePoint = new Date(monthRange(prevMonth).start.getTime() + (now.getTime() - monthRange(month).start.getTime()));
    prev = computeMetrics(monthView(tasks, prevMonth, samePoint), false);
  } else if (prevMonth) {
    prev = await metricsFor(prevMonth, tasks, filterUserId ? `user:${filterUserId}` : "overall");
  }
  const people = groupByPerson(items, live);
  const clients = groupByClient(items, live);
  const reasons = reasonCounts(items, month);
  const insights = buildInsights({ metrics, prev, people, clients, reasons, live });
  return { tasks, items, metrics, prev, prevMonth, people, clients, reasons, insights, live };
}

/** Prefer a frozen month-end snapshot; otherwise compute from task dates. */
export async function metricsFor(month: string, tasks: FullTask[], scope: string): Promise<Metrics> {
  const snap = await prisma.monthlySnapshot.findUnique({ where: { month_scope: { month, scope } } });
  if (snap) return snap.metrics as unknown as Metrics;
  return computeMetrics(monthView(tasks, month), month === currentMonth());
}

export async function trend(months: number, tasks: FullTask[], scope = "overall", endMonth = currentMonth()) {
  const out: { month: string; label: string; completedPct: number; onTimePct: number | null; total: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const mo = addMonths(endMonth, -i);
    const m = await metricsFor(mo, tasks, scope);
    if (m.total) out.push({ month: mo, label: monthLabel(mo, true), completedPct: m.completedPct, onTimePct: m.onTimePct, total: m.total });
  }
  return out;
}

/** Months to offer in the timeline dropdown: from the first task month to now. */
export async function availableMonths(): Promise<string[]> {
  const first = await prisma.task.findFirst({
    where: { deleted: false, OR: [{ dueDate: { not: null } }, { createdAtZoho: { not: null } }] },
    orderBy: [{ createdAtZoho: "asc" }],
    select: { createdAtZoho: true, dueDate: true },
  });
  const cur = currentMonth();
  let start = first ? currentMonth(first.createdAtZoho ?? first.dueDate ?? new Date()) : cur;
  const out: string[] = [];
  for (let m = cur; out.length < 36; m = addMonths(m, -1)) {
    out.push(m);
    if (m <= start) break;
  }
  return out;
}
