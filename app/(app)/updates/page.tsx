import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { loadTasks } from "@/lib/metrics";
import { clientOf } from "@/lib/clients";
import { peopleLabel, doers } from "@/lib/people";
import { followedTasks, markUpdatesSeen, seenKey } from "@/lib/updates";
import { getState } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/ui";
import { Bubble } from "@/components/ZohoComments";
import { UpdateForm } from "@/components/UpdateForm";
import { refreshThreadAction } from "@/app/actions";

const DAY = 86_400_000;
const FILTERS = [
  { key: "all", label: "All", icon: "layers" },
  { key: "reply", label: "Waiting for you", icon: "message" },
  { key: "quiet", label: "Quiet 5+ days", icon: "hourglass" },
  { key: "overdue", label: "Overdue", icon: "alert" },
] as const;

// Task updates: the Zoho comment threads on this month's planned deliverables and on overdue tasks.
// Read from a local copy that the scheduler refreshes a few tasks at a time; replies go onto the Zoho task.
export default async function Updates({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const filter = (FILTERS.find((f) => f.key === sp.f)?.key ?? "all") as (typeof FILTERS)[number]["key"];
  const now = new Date();
  const seenRaw = await getState(seenKey(me.id));
  const seen = seenRaw ? new Date(seenRaw) : new Date(now.getTime() - 3 * DAY);
  const { ids, planned } = await followedTasks(now);
  const [tasks, comments, people] = await Promise.all([
    loadTasks({ id: { in: ids } }),
    prisma.zohoComment.findMany({ where: { taskId: { in: ids } }, orderBy: { at: "desc" } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  await markUpdatesSeen(me.id);
  const managers = new Set((await prisma.user.findMany({ where: { email: { in: config.adminEmails } }, select: { name: true } })).map((u) => u.name.toLowerCase()));
  const byTask = new Map<string, typeof comments>();
  for (const c of comments) byTask.set(c.taskId, [...(byTask.get(c.taskId) ?? []), c]);

  const threads = tasks
    .filter((t) => !sp.user || doers(t).some((a) => a.userId === sp.user))
    .map((t) => {
      const cs = byTask.get(t.id) ?? [];
      const last = cs[0];
      const lastIsManager = !!last && (last.fromDashboard || managers.has(last.author.toLowerCase()));
      const overdue = !!t.dueDate && t.dueDate < now;
      const quietDays = Math.floor((now.getTime() - (last?.at ?? t.updatedAtZoho ?? now).getTime()) / DAY);
      return {
        t,
        cs,
        last,
        fresh: cs.filter((c) => c.at > seen && !c.fromDashboard).length,
        waiting: !!last && !lastIsManager,
        overdue,
        daysOver: overdue ? Math.floor((now.getTime() - t.dueDate!.getTime()) / DAY) : 0,
        quietDays,
        planned: planned.has(t.id),
        client: clientOf(t, t.project).name,
      };
    });
  const count = {
    all: threads.length,
    reply: threads.filter((x) => x.waiting).length,
    quiet: threads.filter((x) => x.quietDays >= 5).length,
    overdue: threads.filter((x) => x.overdue).length,
  };
  const shown = threads
    .filter((x) => (filter === "reply" ? x.waiting : filter === "quiet" ? x.quietDays >= 5 : filter === "overdue" ? x.overdue : true))
    .sort((a, b) => b.fresh - a.fresh || (b.last?.at.getTime() ?? 0) - (a.last?.at.getTime() ?? 0) || b.daysOver - a.daysOver);
  const oldestCheck = tasks.reduce<Date | null>((m, t) => (!t.commentsCheckedAt ? m : !m || t.commentsCheckedAt < m ? t.commentsCheckedAt : m), null);
  const unchecked = tasks.filter((t) => !t.commentsCheckedAt).length;
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ f: filter, user: sp.user, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/updates${p.size ? `?${p}` : ""}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><span className="chip" aria-hidden><Icon name="message" size={16} /></span>Task updates</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">
            Comments from Zoho on this month&apos;s planned deliverables and on overdue tasks. Your reply is posted on the Zoho task, and the people you tag get a Cliq message.
          </p>
          <p className="mt-1 text-xs text-ink-3">
            {threads.length} tasks followed · refreshed a few at a time every 5 minutes{oldestCheck ? ` · oldest copy ${fmtDateTime(oldestCheck)}` : ""}{unchecked ? ` · ${unchecked} not read yet` : ""}
          </p>
        </div>
        <form className="flex items-center gap-2 text-sm">
          <input type="hidden" name="f" value={filter} />
          <label htmlFor="up-user" className="text-ink-2">Person</label>
          <select id="up-user" name="user" defaultValue={sp.user ?? ""}>
            <option value="">Everyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn">Show</button>
        </form>
      </div>

      <div className="mt-4 max-w-full rounded-lg border border-line bg-field p-0.5 w-fit">
        <div className="scroll-x no-scrollbar flex gap-1 text-sm" role="tablist" aria-label="Filter threads">
          {FILTERS.map((f) => (
            <Link key={f.key} href={q({ f: f.key === "all" ? undefined : f.key })} role="tab" aria-selected={filter === f.key} className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 transition-colors max-sm:py-2 ${filter === f.key ? "bg-brand-soft font-medium text-brand-dark" : "text-ink-2 hover:bg-plane hover:text-ink"}`}>
              <Icon name={f.icon} size={14} />{f.label} <span className="num text-ink-3">{count[f.key]}</span>
            </Link>
          ))}
        </div>
      </div>

      {!shown.length ? (
        <div className="mt-6"><Empty>{filter === "all" ? "No followed tasks right now: nothing planned is open and nothing is overdue." : "Nothing here."}</Empty></div>
      ) : (
        <ul className="mt-4 grid items-start gap-4 xl:grid-cols-2 min-[1860px]:grid-cols-3">
          {shown.map((x) => (
            <li key={x.t.id} className={`card flex flex-col p-4 ${x.fresh ? "ring-1 ring-brand/50" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="num text-[11px] text-ink-3">{x.t.key} · {x.client}</div>
                  <Link href={`/tasks/${x.t.id}`} className="mt-0.5 block font-medium leading-snug hover:text-brand">{x.t.name}</Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
                    <span className="inline-flex items-center gap-1"><Icon name="user" size={12} />{peopleLabel(x.t)}</span>
                    <span className="num">Due {fmtDate(x.t.dueDate)}</span>
                    <span>{x.t.zohoStatus}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {x.fresh > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">{x.fresh} new</span>}
                  {x.overdue ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-crit/10 px-2 py-0.5 text-[11px] font-semibold text-crit"><Icon name="alert" size={12} />{x.daysOver}d overdue</span>
                  ) : x.planned ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-plane px-2 py-0.5 text-[11px] text-ink-2"><Icon name="calendar" size={12} />Planned</span>
                  ) : null}
                  {x.waiting && <span className="inline-flex items-center gap-1 rounded-full bg-warn/20 px-2 py-0.5 text-[11px] font-semibold text-warnText"><Icon name="message" size={12} />Waiting for you</span>}
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {x.cs.length ? (
                  <>
                    {x.cs.slice(0, 2).reverse().map((c) => <Bubble key={c.id} author={c.author} at={c.at} text={c.text} mine={c.fromDashboard} />)}
                    {x.cs.length > 2 && (
                      <details>
                        <summary className="cursor-pointer text-xs text-brand hover:underline">{x.cs.length - 2} earlier comment{x.cs.length - 2 === 1 ? "" : "s"}</summary>
                        <div className="mt-2 space-y-2">{x.cs.slice(2, 20).reverse().map((c) => <Bubble key={c.id} author={c.author} at={c.at} text={c.text} mine={c.fromDashboard} />)}</div>
                      </details>
                    )}
                  </>
                ) : (
                  <p className="rounded-lg border border-dashed border-line px-3 py-2 text-sm text-ink-3">
                    {x.t.commentsCheckedAt ? `No comments in Zoho. Quiet for ${x.quietDays} days.` : "Comments not read from Zoho yet."}
                  </p>
                )}
              </div>

              <details className="mt-3">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                  <span className="btn btn-primary"><Icon name="send" size={14} />{x.waiting ? "Reply" : "Follow up"}</span>
                  {x.t.url && <a href={x.t.url} target="_blank" rel="noreferrer" className="btn">Open in Zoho<Icon name="external" size={13} /></a>}
                </summary>
                <div className="mt-3"><UpdateForm taskId={x.t.id} kind={x.waiting ? "reply" : "follow_up"} compact /></div>
              </details>
              <form action={refreshThreadAction} className="mt-2 self-end">
                <input type="hidden" name="taskId" value={x.t.id} />
                <button className="inline-flex min-h-[32px] items-center gap-1 px-1 text-[11px] text-ink-3 hover:text-ink" title="Read this task's comments from Zoho now">
                  <Icon name="refresh" size={11} />{x.t.commentsCheckedAt ? `Checked ${fmtDateTime(x.t.commentsCheckedAt)}` : "Read now"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
