import Link from "next/link";
import { Icon } from "@/components/Icon";
import { peopleLabel } from "@/lib/people";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ALL, monthData, type Row } from "@/lib/metrics";
import { resolvePeriod } from "@/lib/period";
import { addMonths, currentMonth, fmtDate, fmtDateTime, monthLabel, monthRange } from "@/lib/time";
import { REMOVE_REASONS, removeLabel } from "@/lib/status";
import { MonthPicker } from "@/components/Pickers";
import { StatePill, Empty } from "@/components/ui";
import { lockPlanNow, promoteAction, removeFromPlanAction, restoreToPlanAction } from "@/app/actions";

const SRC: Record<string, string> = { DUE_DATE: "Due date", RECURRING: "Recurring", KEPT: "Kept (review)", PROMOTED: "Promoted", VIRTUAL: "Due date" };

export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const { month: picked, options } = await resolvePeriod(sp);
  const month = picked === ALL ? currentMonth() : picked;
  const d = await monthData(month);
  const prevPlan = await prisma.monthPlan.findUnique({ where: { month: addMonths(month, -1) }, include: { items: true } });
  const prevIds = new Set((prevPlan?.items ?? []).filter((i) => !i.removedAt).map((i) => i.taskId));
  const carried = d.rows.filter((r) => prevIds.has(r.task.id));
  const templates = await prisma.recurringTemplate.findMany({ where: { active: true }, orderBy: { title: "asc" } });
  const projects = new Map((await prisma.project.findMany()).map((p) => [p.id, p.name]));
  const { start, end } = monthRange(month);
  const recurringStatus = templates.map((t) => ({
    t,
    hit: d.tasks.find((x) => x.projectId === t.projectId && x.name.toLowerCase().includes(t.title.toLowerCase()) && ((x.dueDate && x.dueDate >= start && x.dueDate < end) || (!x.dueDate && x.createdAtZoho && x.createdAtZoho >= start && x.createdAtZoho < end))),
  }));
  const byClient = new Map<string, Row[]>();
  for (const r of d.rows) byClient.set(r.client, [...(byClient.get(r.client) ?? []), r]);
  const editable = !d.virtual;
  const isCur = month === currentMonth();

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plan · {monthLabel(month)}</h1>
          <p className="text-sm text-ink-2 mt-1">
            {d.virtual
              ? "No stored plan for this month (before v2). Planned = deliverables due in the month."
              : d.plan!.status === "DRAFT"
                ? <>Planning window. Locks automatically at the end of <b>{fmtDate(d.plan!.locksAt)}</b>. Due-date changes in Zoho and Keep decisions flow in until then.</>
                : <>Locked {fmtDateTime(d.plan!.lockedAt)}. Newly due tasks are Unplanned until promoted. Removing a task needs a reason and shows in the report.</>}
          </p>
          <p className="text-xs text-ink-3 mt-1 num">
            {d.rows.length} planned · {d.rows.filter((r) => r.source === "RECURRING").length} recurring · {d.rows.filter((r) => r.source === "KEPT").length} kept · {d.rows.filter((r) => r.source === "PROMOTED").length} promoted · {d.removed.length} removed · {carried.length} carried from last month&apos;s plan
          </p>
        </div>
        <div className="flex items-center gap-3">
          {d.plan?.status === "DRAFT" && (
            <form action={lockPlanNow}><input type="hidden" name="month" value={month} /><button className="btn btn-primary"><Icon name="calendar" size={15} />Lock plan now</button></form>
          )}
          <MonthPicker months={options.filter((o) => o.value !== ALL)} value={month} />
        </div>
      </div>

      {!d.rows.length ? <div className="mt-6"><Empty>Nothing in this plan yet.</Empty></div> : (
        [...byClient.entries()].map(([client, rows]) => (
          <div key={client} className="mt-5">
            <h2 className="mb-2 text-sm font-semibold">{client} <span className="text-ink-3 font-normal">· {rows.length}</span></h2>
            <div className="card overflow-x-auto">
              <table className="tbl w-full">
                <thead><tr><th>Deliverable</th><th>Owner</th><th>Source</th><th>Planned due</th><th>State</th>{editable && <th>Remove from plan</th>}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.task.id}>
                      <td className="max-w-[300px]"><Link href={`/tasks/${r.task.id}`} className="hover:text-brand">{r.task.name}</Link>{prevIds.has(r.task.id) && <span className="ml-1 text-[10px] text-ink-3">carried</span>}</td>
                      <td className="whitespace-nowrap">{peopleLabel(r.task)}</td>
                      <td className="whitespace-nowrap text-xs">{SRC[r.source]}</td>
                      <td className="num whitespace-nowrap">{fmtDate(r.plannedDue)}{r.dueChanged && <div className="text-[11px] text-warnText">now {fmtDate(r.task.dueDate)}</div>}</td>
                      <td><StatePill state={r.state} /></td>
                      {editable && (
                        <td>
                          <form action={removeFromPlanAction} className="flex flex-wrap gap-1">
                            <input type="hidden" name="month" value={month} />
                            <input type="hidden" name="taskId" value={r.task.id} />
                            <select name="reason" required defaultValue="" aria-label="Reason">
                              <option value="" disabled>Reason…</option>
                              {REMOVE_REASONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                            </select>
                            <input name="note" placeholder="Note" className="w-28" />
                            <button className="btn">Remove</button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {editable && isCur && (
        <>
          <h2 className="mt-8 mb-2 text-base font-semibold flex items-center gap-2.5"><span className="chip chip-warn" aria-hidden><Icon name="zap" size={15} /></span>Unplanned this month ({d.unplannedOpen.length})</h2>
          <p className="text-sm text-ink-2 mb-3">Due in {monthLabel(month)} but added after the plan locked. Promote to count them in the plan (logged).</p>
          <div className="card divide-y divide-line">
            {d.unplannedOpen.map((r) => (
              <div key={r.task.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="flex-1">{r.task.key} {r.task.name} <span className="text-ink-3">· {r.client} · {peopleLabel(r.task)} · due {fmtDate(r.task.dueDate)}</span></span>
                <form action={promoteAction}><input type="hidden" name="month" value={month} /><input type="hidden" name="taskId" value={r.task.id} /><button className="btn">Promote to plan</button></form>
              </div>
            ))}
            {!d.unplannedOpen.length && <div className="p-3 text-sm text-ink-3">Nothing unplanned.</div>}
          </div>
        </>
      )}

      {d.removed.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-base font-semibold flex items-center gap-2.5"><span className="chip chip-crit" aria-hidden><Icon name="x" size={15} /></span>Removed from the plan ({d.removed.length})</h2>
          <div className="card divide-y divide-line">
            {d.removed.map((r) => (
              <div key={r.task.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="flex-1">{r.task.name} <span className="text-ink-3">· {r.client} · {r.removed?.reason ? removeLabel(r.removed.reason) : ""}{r.removed?.note ? `: ${r.removed.note}` : ""}</span></span>
                <form action={restoreToPlanAction}><input type="hidden" name="month" value={month} /><input type="hidden" name="taskId" value={r.task.id} /><button className="btn">Restore</button></form>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="mt-8 mb-2 text-base font-semibold flex items-center gap-2.5"><span className="chip chip-teal" aria-hidden><Icon name="history" size={15} /></span>Recurring deliverables</h2>
      <p className="text-sm text-ink-2 mb-3">Always planned. Templates are managed in Settings. If one has no Zoho task this month, you can ask to create it (needs approval).</p>
      <div className="card divide-y divide-line">
        {recurringStatus.map(({ t, hit }) => (
          <div key={t.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <Icon name={hit ? "check" : "alert"} size={15} className={hit ? "text-goodText" : "text-warnText"} label={hit ? "Found in Zoho" : "Missing in Zoho"} />
            <span className="flex-1">{t.title} <span className="text-ink-3">· {projects.get(t.projectId)}</span>{hit ? <span className="text-ink-3"> → {hit.key} {hit.name}</span> : <span className="text-warnText"> · no Zoho task found this month</span>}</span>
            {!hit && <span className="text-xs text-ink-3">Create it in Zoho to track it</span>}
          </div>
        ))}
        {!templates.length && <div className="p-3 text-sm text-ink-3">No recurring templates yet. Add them in Settings → Recurring deliverables.</div>}
      </div>
    </div>
  );
}
