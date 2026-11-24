import { Icon } from "@/components/Icon";
import { peopleLabel } from "@/lib/people";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { monthData } from "@/lib/metrics";
import { currentMonth, fmtDate, monthLabel } from "@/lib/time";
import { Empty } from "@/components/ui";
import { UpdateForm } from "@/components/UpdateForm";

// Old open tasks: read-only. The team brings a task back by giving it a new due date in Zoho
// (or closes / parks it there); managers follow up from here.
export default async function Review({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser();
  const sp = await searchParams;
  const month = currentMonth();
  const targetId = sp.user === "all" ? undefined : sp.user || undefined;
  const d = await monthData(month, { userId: targetId });
  const people = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const rows = [...d.old].sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><span className="chip chip-warn" aria-hidden><Icon name="history" size={16} /></span>Old open tasks · {monthLabel(month)}</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">
            Open tasks from earlier months. They don&apos;t count in {monthLabel(month).split(" ")[0]} until someone gives them a new due date in Zoho, closes them, or moves them to Backlog there. Follow up to ask.
          </p>
        </div>
        <form className="flex items-center gap-2 text-sm">
          <label htmlFor="rv-user" className="text-ink-2">Person</label>
          <select id="rv-user" name="user" defaultValue={sp.user ?? "all"}>
            <option value="all">Everyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn">Show</button>
        </form>
      </div>

      {!rows.length ? (
        <div className="mt-6"><Empty>No old open tasks{targetId ? " for this person" : ""}.</Empty></div>
      ) : (
        <ul className="mt-5 grid gap-3 lg:grid-cols-2 min-[1860px]:grid-cols-3">
          {rows.map((o) => (
            <li key={o.task.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="num text-[11px] text-ink-3">{o.task.key} · {o.client}</div>
                  <div className="mt-0.5 font-medium leading-snug">{o.task.name}</div>
                </div>
                {o.daysOverdue !== null ? (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-crit/10 px-2 py-0.5 text-[11px] font-semibold text-crit"><Icon name="alert" size={12} />{o.daysOverdue}d overdue</span>
                ) : (
                  <span className="shrink-0 rounded-full bg-plane px-2 py-0.5 text-[11px] text-ink-2">No due date</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
                <span className="inline-flex items-center gap-1"><Icon name="user" size={12} />{peopleLabel(o.task)}</span>
                <span className="num">Due {fmtDate(o.task.dueDate)}</span>
                <span className="num">Updated {fmtDate(o.task.updatedAtZoho)}</span>
                {o.task.lastCommentAt && <span className="num inline-flex items-center gap-1"><Icon name="message" size={12} />{fmtDate(o.task.lastCommentAt)}</span>}
                {o.decision && <span className="text-ink-3">Earlier decision: {o.decision.decision === "KEEP" ? `keep → ${fmtDate(o.decision.newDueDate)}` : o.decision.decision.toLowerCase()}</span>}
              </div>
              <details className="group mt-3">
                <summary className="flex cursor-pointer list-none items-center gap-2">
                  <span className="btn"><Icon name="send" size={14} />Follow up</span>
                  {o.task.url && <a href={o.task.url} target="_blank" rel="noreferrer" className="btn">Open in Zoho<Icon name="external" size={13} /></a>}
                </summary>
                <div className="mt-3"><UpdateForm taskId={o.task.id} kind="follow_up" compact /></div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
