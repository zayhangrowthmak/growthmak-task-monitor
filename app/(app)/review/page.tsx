import Link from "next/link";
import { Icon } from "@/components/Icon";
import { peopleLabel } from "@/lib/people";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { monthData } from "@/lib/metrics";
import { getSettings } from "@/lib/settings";
import { lastWorkingDay } from "@/lib/workdays";
import { currentMonth, fmtDate, monthLabel, IST_OFFSET_MS } from "@/lib/time";
import { decideOldTasks, undoOldTask, approveKeepAction } from "@/app/actions";
import { Empty } from "@/components/ui";

const ymd = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

export default async function Review({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const viewer = await requireUser();
  const sp = await searchParams;
  const admin = viewer.role === "ADMIN";
  const month = currentMonth();
  const targetId = admin ? (sp.user === "all" ? undefined : sp.user || undefined) : viewer.id;
  const d = await monthData(month, { userId: targetId });
  const s = await getSettings();
  const defaultDue = ymd(lastWorkingDay(month, s.workingDays));
  const people = admin ? await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [];
  const locksAt = d.plan?.locksAt;
  const pastDeadline = !!locksAt && new Date() > locksAt;
  const pending = d.old.filter((o) => !o.decision);
  const decided = d.old.filter((o) => o.decision);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Old open tasks · {monthLabel(month)}</h1>
          <p className="mt-1 text-sm text-ink-2 max-w-3xl">
            These are open tasks from earlier months. They don&apos;t count in {monthLabel(month).split(" ")[0]} unless you keep them. For each one choose <b>Keep this month</b> (pick a date), <b>Move to Backlog</b>, or <b>Close (not needed)</b>.
            Your choice counts in the dashboard right away; Zoho is updated once a manager approves it.
          </p>
          <p className="mt-1 text-sm">
            {locksAt ? <>Decide by <b>{fmtDate(locksAt)}</b>{pastDeadline ? " — the deadline has passed: kept tasks now show as Unplanned unless a manager promotes them." : "."}</> : null}
          </p>
        </div>
        {admin && (
          <form className="flex items-center gap-2 text-sm">
            <span className="text-ink-2">Person</span>
            <select name="user" defaultValue={sp.user ?? "all"}>
              <option value="all">Everyone</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn">Show</button>
          </form>
        )}
      </div>

      {!d.old.length ? (
        <div className="mt-6"><Empty>No old open tasks{targetId ? " for this person" : ""}. Nothing to review.</Empty></div>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <form id="bulk" action={decideOldTasks} className="mt-5 card flex flex-wrap items-end gap-3 p-3">
                <input type="hidden" name="month" value={month} />
                <div className="label w-full">Selected tasks</div>
                <label className="text-sm">Decision
                  <select name="decision" className="ml-2" defaultValue="BACKLOG">
                    <option value="KEEP">Keep this month</option>
                    <option value="BACKLOG">Move to Backlog</option>
                    <option value="CLOSE">Close (not needed)</option>
                  </select>
                </label>
                <label className="text-sm">New due (for Keep)
                  <input type="date" name="newDueDate" defaultValue={defaultDue} className="ml-2" />
                </label>
                <input name="note" placeholder="Note (optional)" className="min-w-56 flex-1" />
                <button className="btn btn-primary">Apply to selected</button>
              </form>

              {/* Phones: one card per task, decision controls in reach */}
              <ul className="mt-3 space-y-3 md:hidden">
                {pending.map((o) => (
                  <li key={o.task.id} className="card p-3">
                    <div className="flex items-start gap-3">
                      <input type="checkbox" name="taskId" value={o.task.id} form="bulk" aria-label={`Select ${o.task.name}`} className="mt-1" />
                      <div className="min-w-0 flex-1">
                        <div className="num text-[11px] text-ink-3">{o.task.key}</div>
                        <a href={o.task.url ?? "#"} target="_blank" rel="noreferrer" className="font-medium hover:text-brand">{o.task.name}</a>
                        <div className="mt-0.5 text-xs text-ink-2">
                          {o.client}{!targetId && <> · {peopleLabel(o.task)}</>} · due {fmtDate(o.task.dueDate)}
                          {o.daysOverdue !== null && <span className="text-crit"> · {o.daysOverdue} days overdue</span>}
                        </div>
                      </div>
                    </div>
                    <form action={decideOldTasks} className="mt-3 grid grid-cols-3 gap-2">
                      <input type="hidden" name="month" value={month} />
                      <input type="hidden" name="taskId" value={o.task.id} />
                      <label className="col-span-3 flex items-center gap-2 text-xs text-ink-2">
                        New due if kept
                        <input type="date" name="newDueDate" defaultValue={defaultDue} className="flex-1" />
                      </label>
                      <input name="note" placeholder="Note (optional)" aria-label="Note" className="col-span-3" />
                      <button name="decision" value="KEEP" className="btn">Keep</button>
                      <button name="decision" value="BACKLOG" className="btn">Backlog</button>
                      <button name="decision" value="CLOSE" className="btn">Close</button>
                    </form>
                  </li>
                ))}
              </ul>

              <div className="mt-3 card overflow-x-auto max-md:hidden">
                <table className="tbl w-full">
                  <thead>
                    <tr><th className="w-8"><span className="sr-only">Select</span></th><th>Task</th><th>Client</th>{!targetId && <th>Owner</th>}<th>Original due</th><th>Overdue</th><th>Last update</th><th>Decide</th></tr>
                  </thead>
                  <tbody>
                    {pending.map((o) => (
                      <tr key={o.task.id} className="align-top">
                        <td><input type="checkbox" name="taskId" value={o.task.id} form="bulk" aria-label={`Select ${o.task.name}`} /></td>
                        <td className="min-w-[200px] max-w-[300px]"><div className="num text-[11px] text-ink-3">{o.task.key}</div><a href={o.task.url ?? "#"} target="_blank" rel="noreferrer" className="hover:text-brand">{o.task.name}</a></td>
                        <td className="whitespace-nowrap">{o.client}</td>
                        {!targetId && <td className="whitespace-nowrap">{peopleLabel(o.task)}</td>}
                        <td className="num whitespace-nowrap">{fmtDate(o.task.dueDate)}</td>
                        <td className="num whitespace-nowrap">{o.daysOverdue !== null ? `${o.daysOverdue} days` : "no due date"}</td>
                        <td className="num whitespace-nowrap">{fmtDate(o.task.updatedAtZoho)}</td>
                        <td className="min-w-[330px]">
                          <form action={decideOldTasks} className="flex flex-wrap items-center gap-1.5">
                            <input type="hidden" name="month" value={month} />
                            <input type="hidden" name="taskId" value={o.task.id} />
                            <input type="date" name="newDueDate" defaultValue={defaultDue} aria-label="New due date" className="w-36" />
                            <button name="decision" value="KEEP" className="btn">Keep</button>
                            <button name="decision" value="BACKLOG" className="btn">Backlog</button>
                            <button name="decision" value="CLOSE" className="btn">Close</button>
                            <input name="note" placeholder="Note" className="w-full mt-1" />
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {decided.length > 0 && (
            <>
              <h2 className="mt-8 mb-3 text-base font-semibold">Decided ({decided.length})</h2>
              <div className="card divide-y divide-line">
                {decided.map((o) => (
                  <div key={o.task.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                    <span className="rounded bg-plane border border-line px-1.5 py-0.5 text-[11px] font-semibold">{o.decision!.decision === "KEEP" ? `Keep → ${fmtDate(o.decision!.newDueDate)}` : o.decision!.decision === "BACKLOG" ? "Backlog" : "Close"}</span>
                    <span className="flex-1">{o.task.key} {o.task.name} <span className="text-ink-3">· {o.client}</span></span>
                    {o.decision!.needsApproval && !o.decision!.approved && <span className="text-xs text-warnText">3rd month kept in a row — needs a manager&apos;s OK</span>}
                    {admin && o.decision!.needsApproval && !o.decision!.approved && (
                      <form action={approveKeepAction}><input type="hidden" name="taskId" value={o.task.id} /><input type="hidden" name="month" value={month} /><button className="btn">Approve keep</button></form>
                    )}
                    <form action={undoOldTask}><input type="hidden" name="taskId" value={o.task.id} /><input type="hidden" name="month" value={month} /><button className="btn">Undo</button></form>
                  </div>
                ))}
              </div>
            </>
          )}
          {admin && <p className="mt-4 text-sm"><Link href="/approvals" className="text-brand hover:underline">Approve the Zoho updates for these decisions <Icon name="arrowRight" size={14} className="inline -mt-0.5" /></Link></p>}
        </>
      )}
    </div>
  );
}
