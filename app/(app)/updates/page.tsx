import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma, getState } from "@/lib/db";
import { config } from "@/lib/config";
import { loadTasks } from "@/lib/metrics";
import { clientOf } from "@/lib/clients";
import { peopleLabel, doers } from "@/lib/people";
import { feed, markUpdatesSeen, seenKey, MAX_DAYS, NEW_TASK_DAYS, type FeedWhy } from "@/lib/updates";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { Icon, type IconName } from "@/components/Icon";
import { Empty } from "@/components/ui";
import { Bubble } from "@/components/ZohoComments";
import { UpdateForm } from "@/components/UpdateForm";
import { refreshThreadAction } from "@/app/actions";

const DAY = 86_400_000;
const FILTERS: { key: string; label: string; icon: IconName }[] = [
  { key: "all", label: "Everything recent", icon: "layers" },
  { key: "feedback", label: "Needs your feedback", icon: "message" },
  { key: "comments", label: "New comments", icon: "send" },
  { key: "review", label: "Review / QA", icon: "eye" },
  { key: "blocked", label: "Blocked", icon: "pause" },
  { key: "new", label: "New tasks", icon: "sparkles" },
  { key: "overdue", label: "Overdue", icon: "alert" },
];
const WINDOWS = [3, 7, 14, 35];

function ago(d: Date, now: Date) {
  const m = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000));
  if (m < 60) return m <= 1 ? "just now" : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// Task updates: only what needs a manager's eye now. Tasks commented on recently, waiting in
// Review / QA, blocked, or just created — never anything without activity in the last 35 days.
export default async function Updates({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.f)?.key ?? "all";
  const days = WINDOWS.includes(Number(sp.d)) ? Number(sp.d) : MAX_DAYS;
  const now = new Date();
  const seenRaw = await getState(seenKey(me.id));
  const seen = seenRaw ? new Date(seenRaw) : new Date(now.getTime() - 3 * DAY);
  const items = await feed(now, days);
  const ids = items.map((i) => i.taskId);
  const [tasks, comments, people, managerUsers] = await Promise.all([
    loadTasks({ id: { in: ids } }),
    prisma.zohoComment.findMany({ where: { taskId: { in: ids } }, orderBy: { at: "desc" } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { email: { in: config.adminEmails } }, select: { name: true } }),
  ]);
  await markUpdatesSeen(me.id);
  const managers = new Set(managerUsers.map((u) => u.name.toLowerCase()));
  const isManager = (c: { fromDashboard: boolean; author: string }) => c.fromDashboard || managers.has(c.author.toLowerCase());
  const byTask = new Map<string, typeof comments>();
  for (const c of comments) byTask.set(c.taskId, [...(byTask.get(c.taskId) ?? []), c]);
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const threads = items
    .map((it) => {
      const t = taskById.get(it.taskId);
      if (!t) return null;
      const cs = byTask.get(t.id) ?? [];
      const last = cs[0];
      const lastManager = cs.find(isManager);
      // Waiting on a manager: the team spoke last, or it went to Review / QA and no manager has said anything since
      const reviewWaiting = it.why.includes("review") && (!lastManager || (it.statusSince ?? t.updatedAtZoho ?? now) > lastManager.at);
      const feedback = (!!last && !isManager(last)) || reviewWaiting;
      const daysOver = t.dueDate ? Math.floor((now.getTime() - t.dueDate.getTime()) / DAY) : 0;
      const overdue = daysOver >= 1;
      return {
        ...it,
        t,
        cs,
        last,
        feedback,
        overdue,
        daysOver,
        fresh: cs.filter((c) => c.at > seen && !isManager(c)).length,
        client: clientOf(t, t.project).name,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .filter((x) => !sp.user || doers(x.t).some((a) => a.userId === sp.user));

  const match = (x: (typeof threads)[number], f: string) =>
    f === "feedback" ? x.feedback
    : f === "comments" ? x.why.includes("comment")
    : f === "review" ? x.why.includes("review")
    : f === "blocked" ? x.why.includes("blocked")
    : f === "new" ? x.why.includes("new")
    : f === "overdue" ? x.overdue
    : true;
  const count = Object.fromEntries(FILTERS.map((f) => [f.key, threads.filter((x) => match(x, f.key)).length]));
  // Needing feedback first, then whatever moved most recently
  const shown = threads.filter((x) => match(x, filter)).sort((a, b) => Number(b.feedback) - Number(a.feedback) || b.activityAt.getTime() - a.activityAt.getTime());
  const unchecked = tasks.filter((t) => !t.commentsCheckedAt).length;
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ f: filter === "all" ? undefined : filter, d: days === MAX_DAYS ? undefined : String(days), user: sp.user, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/updates${p.size ? `?${p}` : ""}`;
  };
  const whyChip = (x: (typeof threads)[number], w: FeedWhy) => {
    const map: Record<FeedWhy, { icon: IconName; text: string; cls: string }> = {
      comment: { icon: "message", text: x.t.lastCommentAt ? `Commented ${ago(x.t.lastCommentAt, now)}` : "Commented", cls: "bg-brand-soft text-brand-dark" },
      review: { icon: "eye", text: `In Review / QA${x.statusSince ? ` since ${fmtDate(x.statusSince)}` : ""}`, cls: "bg-warn/20 text-warnText" },
      blocked: { icon: "pause", text: `Blocked${x.statusSince ? ` since ${fmtDate(x.statusSince)}` : ""}`, cls: "bg-crit/10 text-crit" },
      new: { icon: "sparkles", text: x.t.createdAtZoho ? `New task · ${ago(x.t.createdAtZoho, now)}` : "New task", cls: "bg-good/15 text-goodText" },
    };
    const m = map[w];
    return <span key={w} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}><Icon name={m.icon} size={12} />{m.text}</span>;
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><span className="chip" aria-hidden><Icon name="message" size={16} /></span>Task updates</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">
            What needs your eye now: tasks commented on in Zoho, waiting in Review / QA, blocked, or created in the last {NEW_TASK_DAYS} days. Nothing quiet for more than {MAX_DAYS} days shows here. Your reply is posted on the Zoho task, and the people you tag get a Cliq message.
          </p>
          <p className="mt-1 text-xs text-ink-3">
            {threads.length} task{threads.length === 1 ? "" : "s"} with activity in the last {days} days · comments re-read from Zoho every few minutes{unchecked ? ` · ${unchecked} not read yet` : ""}
          </p>
        </div>
        <form className="flex items-center gap-2 text-sm">
          {filter !== "all" && <input type="hidden" name="f" value={filter} />}
          {days !== MAX_DAYS && <input type="hidden" name="d" value={days} />}
          <label htmlFor="up-user" className="text-ink-2">Person</label>
          <select id="up-user" name="user" defaultValue={sp.user ?? ""}>
            <option value="">Everyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn">Show</button>
        </form>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="max-w-full rounded-lg border border-line bg-field p-0.5">
          <div className="scroll-x no-scrollbar flex gap-1 text-sm" role="tablist" aria-label="Filter">
            {FILTERS.map((f) => (
              <Link key={f.key} href={q({ f: f.key === "all" ? "" : f.key })} role="tab" aria-selected={filter === f.key} className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 transition-colors max-sm:py-2 ${filter === f.key ? "bg-brand-soft font-medium text-brand-dark" : "text-ink-2 hover:bg-plane hover:text-ink"}`}>
                <Icon name={f.icon} size={14} />{f.label} <span className="num text-ink-3">{count[f.key]}</span>
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-line bg-field p-0.5 text-sm" role="tablist" aria-label="How far back">
          <span className="px-2 text-xs text-ink-3">Last</span>
          {WINDOWS.map((w) => (
            <Link key={w} href={q({ d: w === MAX_DAYS ? "" : String(w) })} role="tab" aria-selected={days === w} className={`rounded-md px-2.5 py-1 num max-sm:py-2 ${days === w ? "bg-brand-soft font-medium text-brand-dark" : "text-ink-2 hover:bg-plane hover:text-ink"}`}>{w}d</Link>
          ))}
        </div>
      </div>

      {!shown.length ? (
        <div className="mt-6"><Empty>{filter === "all" ? `Nothing has moved in the last ${days} days.` : "Nothing here right now."}</Empty></div>
      ) : (
        <ul className="mt-4 grid items-start gap-4 xl:grid-cols-2 min-[1860px]:grid-cols-3">
          {shown.map((x) => (
            <li key={x.t.id} className={`card flex flex-col p-4 ${x.feedback ? "ring-1 ring-warn/60" : x.fresh ? "ring-1 ring-brand/50" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="num text-[11px] text-ink-3">{x.t.key} · {x.client}</div>
                  <Link href={`/tasks/${x.t.id}`} className="mt-0.5 block font-medium leading-snug hover:text-brand">{x.t.name}</Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
                    <span className="inline-flex items-center gap-1"><Icon name="user" size={12} />{peopleLabel(x.t)}</span>
                    <span className="num">Due {fmtDate(x.t.dueDate)}{x.overdue ? <span className="text-crit"> · {x.daysOver}d overdue</span> : null}</span>
                    <span>{x.t.zohoStatus}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {x.feedback && <span className="inline-flex items-center gap-1 rounded-full bg-warn px-2 py-0.5 text-[11px] font-semibold text-black/80"><Icon name="message" size={12} />Needs your feedback</span>}
                  {x.fresh > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">{x.fresh} new</span>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">{x.why.map((w) => whyChip(x, w))}</div>

              <div className="mt-3 space-y-2">
                {x.cs.length ? (
                  <>
                    {x.cs.slice(0, 2).reverse().map((c) => <Bubble key={c.id} author={c.author} at={c.at} text={c.text} mine={isManager(c)} />)}
                    {x.cs.length > 2 && (
                      <details>
                        <summary className="cursor-pointer text-xs text-brand hover:underline">{x.cs.length - 2} earlier comment{x.cs.length - 2 === 1 ? "" : "s"}</summary>
                        <div className="mt-2 space-y-2">{x.cs.slice(2, 20).reverse().map((c) => <Bubble key={c.id} author={c.author} at={c.at} text={c.text} mine={isManager(c)} />)}</div>
                      </details>
                    )}
                  </>
                ) : (
                  <p className="rounded-lg border border-dashed border-line px-3 py-2 text-sm text-ink-3">
                    {x.t.commentsCheckedAt ? "No comments in Zoho yet." : "Comments not read from Zoho yet."}
                  </p>
                )}
              </div>

              <details className="mt-3">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                  <span className="btn btn-primary"><Icon name="send" size={14} />{x.feedback ? "Give feedback" : "Follow up"}</span>
                  {x.t.url && <a href={x.t.url} target="_blank" rel="noreferrer" className="btn">Open in Zoho<Icon name="external" size={13} /></a>}
                </summary>
                <div className="mt-3"><UpdateForm taskId={x.t.id} kind={x.feedback ? "reply" : "follow_up"} compact /></div>
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
