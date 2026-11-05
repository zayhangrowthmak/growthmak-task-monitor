import Link from "next/link";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ALL, periodData } from "@/lib/metrics";
import { resolvePeriod } from "@/lib/period";
import { BUCKETS, BUCKET_COLOR } from "@/lib/status";
import { currentMonth, monthLabel, fmtDateTime } from "@/lib/time";
import { MonthPicker, PersonPicker } from "./Pickers";
import { Kpi, pctText, Empty } from "./ui";
import { Kanban, TaskList, TaskDetail } from "./Tasks";
import { saveReview } from "@/app/actions";

export async function PersonDashboard({ person, viewer, sp, basePath }: { person: User; viewer: User; sp: Record<string, string>; basePath: string }) {
  const { month, options, label } = await resolvePeriod(sp);
  const view = sp.view === "list" ? "list" : "kanban";
  const d = await periodData(month, person.id);
  const m = d.metrics;
  const p = d.prev;
  const admin = viewer.role === "ADMIN";
  const reviewMonth = month === ALL ? currentMonth() : month;
  const review = await prisma.monthlyReview.findUnique({ where: { userId_month: { userId: person.id, month: reviewMonth } }, include: { reviewer: true } });
  const people = admin ? await prisma.user.findMany({ where: { active: true, assignments: { some: {} } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const qs = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams({ month, view, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) as Record<string, string> });
    return `${basePath}?${q.toString()}`;
  };
  const hrefFor = (id: string) => qs({ task: id });
  const openTask = sp.task ? d.items.find((i) => i.task.id === sp.task) : undefined;
  const vs = d.live && month !== ALL ? "vs same day last month" : "vs last month";
  const dl = (a: number | null | undefined, b: number | null | undefined) => (a === null || a === undefined || b === null || b === undefined || !p?.total ? null : a - b);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">{admin && viewer.id !== person.id ? "Individual view" : "My dashboard"}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{person.name} · {label}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {admin && people.length > 0 && <PersonPicker people={people} value={person.id} month={month} />}
          <MonthPicker months={options} value={month} />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi vs={vs} label="Completed" value={pctText(m.completedPct)} sub={`${m.completed} of ${m.total} tasks`} delta={dl(m.completedPct, p?.completedPct)} />
        <Kpi vs={vs} label="On time" value={pctText(m.onTimePct)} sub="of finished tasks" delta={dl(m.onTimePct, p?.onTimePct)} />
        <Kpi vs={vs} label="Missed deadline" value={pctText(m.missedPct)} sub={`${m.overdueOpen} overdue · ${m.finishedLate} late`} delta={dl(m.missedPct, p?.missedPct)} goodWhenUp={false} />
        <Kpi vs={vs} label="Blocked / waiting" value={pctText(m.bucketPct.BLOCKED)} sub={`${m.buckets.BLOCKED} tasks`} delta={dl(m.bucketPct.BLOCKED, p?.bucketPct?.BLOCKED)} goodWhenUp={false} />
        <Kpi vs={vs} label="At risk now" value={d.live ? String(m.atRisk) : "—"} sub={d.live ? `${m.tight} Tight` : "tracked live for the current month"} />
        <Kpi vs={vs} label="Logged hours" value={String(m.hours)} sub={`avg ${m.avgDaysLate ?? 0} days late when late`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="card p-4">
          <div className="label mb-3">Where my tasks are</div>
          {m.total ? (
            <>
              <div className="flex h-4 gap-[2px]">
                {BUCKETS.filter((b) => m.buckets[b.key]).map((b, i, arr) => (
                  <div key={b.key} title={`${b.label}: ${m.buckets[b.key]} (${m.bucketPct[b.key]}%)`}
                    className={`${i === 0 ? "rounded-l" : ""} ${i === arr.length - 1 ? "rounded-r" : ""}`}
                    style={{ width: `${m.bucketPct[b.key]}%`, background: BUCKET_COLOR[b.key] }} />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-5 gap-2">
                {BUCKETS.map((b) => (
                  <div key={b.key} className="text-xs">
                    <div className="flex items-center gap-1.5 text-ink-2"><span className="h-2 w-2 rounded-full" style={{ background: BUCKET_COLOR[b.key] }} />{b.label}</div>
                    <div className="mt-0.5 text-lg font-semibold num">{m.bucketPct[b.key]}%</div>
                    <div className="text-ink-3 num">{m.buckets[b.key]} tasks</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-ink-3">No tasks in this period.</div>
          )}
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div className="label">Monthly review · {monthLabel(reviewMonth)}</div>
            {review && <span className="text-xs text-ink-3">by {review.reviewer.name}, {fmtDateTime(review.updatedAt)}</span>}
          </div>
          {admin ? (
            <form action={saveReview} className="mt-2 space-y-2">
              <input type="hidden" name="userId" value={person.id} />
              <input type="hidden" name="month" value={reviewMonth} />
              <label className="flex items-center gap-2 text-sm">
                <span className="text-ink-2">Rating</span>
                <select name="rating" required defaultValue={review?.rating ?? ""} className="font-semibold">
                  <option value="" disabled>Select…</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} / 10</option>)}
                </select>
              </label>
              <textarea name="comment" rows={4} defaultValue={review?.comment ?? ""} placeholder="Overall review of the month: what went well, what slipped, what to change next month." className="w-full" />
              <button className="btn btn-primary">{review ? "Update review" : "Save review"}</button>
            </form>
          ) : review ? (
            <div className="mt-2">
              <div className="text-3xl font-semibold">{review.rating}<span className="text-base text-ink-3">/10</span></div>
              <p className="mt-2 text-sm whitespace-pre-wrap">{review.comment}</p>
            </div>
          ) : (
            <div className="mt-2 text-sm text-ink-3">No review yet for this month.</div>
          )}
        </div>
      </div>

      <div className="mt-8 mb-3 flex items-end justify-between">
        <h2 className="text-base font-semibold">Tasks <span className="text-ink-3 font-normal text-sm">· a read-only copy of Zoho Projects</span></h2>
        <div className="flex rounded-lg border border-line bg-field p-0.5 text-sm">
          <Link href={`${basePath}?month=${month}&view=kanban`} className={`rounded-md px-3 py-1 ${view === "kanban" ? "bg-brand-soft text-brand-dark font-medium" : "text-ink-2"}`}>Kanban</Link>
          <Link href={`${basePath}?month=${month}&view=list`} className={`rounded-md px-3 py-1 ${view === "list" ? "bg-brand-soft text-brand-dark font-medium" : "text-ink-2"}`}>List</Link>
        </div>
      </div>
      {d.items.length === 0 ? (
        <Empty>No tasks assigned in {label}.</Empty>
      ) : view === "kanban" ? (
        <Kanban items={d.items} hrefFor={hrefFor} />
      ) : (
        <TaskList items={d.items} hrefFor={hrefFor} />
      )}

      {openTask && (
        <>
          <Link href={qs({})} scroll={false} className="fixed inset-0 z-30 bg-black/20" aria-label="Close task" />
          <aside className="fixed right-0 top-0 z-40 h-full w-full max-w-[460px] overflow-y-auto border-l border-line bg-surface p-5 shadow-xl">
            <TaskDetail m={openTask} month={reviewMonth} canComment={admin || openTask.task.assignees.some((a) => a.userId === viewer.id)} closeHref={qs({})} />
          </aside>
        </>
      )}
    </div>
  );
}
