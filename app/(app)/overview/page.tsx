import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ALL, periodData, trend } from "@/lib/metrics";
import { resolvePeriod } from "@/lib/period";
import { currentMonth, fmtDateTime } from "@/lib/time";
import { getState, prisma } from "@/lib/db";
import { MonthPicker } from "@/components/Pickers";
import { Kpi, Bar, SectionTitle, ClientTypeBadge, pctText, Empty, StatusTag } from "@/components/ui";
import { TrendChart, StatusMix, ReasonBars } from "@/components/Charts";
import { ConfidencePill } from "@/components/ui";

const toneStyle = { good: "text-goodText", crit: "text-crit", warn: "text-[#9a6a00]", info: "text-ink-2" };
const toneIcon = { good: "▲", crit: "▼", warn: "◆", info: "●" };

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const { month, options, label } = await resolvePeriod(sp);
  const d = await periodData(month);
  const m = d.metrics;
  const p = d.prev;
  const tr = await trend(6, d.tasks, "overall", month === ALL ? currentMonth() : month);
  const lastSync = await getState("sync.last_ok");
  const reviews = month === ALL ? [] : await prisma.monthlyReview.findMany({ where: { month } });
  const ratingBy = new Map(reviews.map((r) => [r.userId, r.rating]));
  const vs = d.live && month !== ALL ? "vs same day last month" : "vs last month";
  const dl = (a: number | null | undefined, b: number | null | undefined) => (a === null || a === undefined || b === null || b === undefined || !p?.total ? null : a - b);
  const watch = d.items
    .filter((i) => !i.done && (i.task.confidence === "AT_RISK" || i.task.confidence === "TIGHT"))
    .sort((a, b) => (a.task.confidence === b.task.confidence ? b.daysLate - a.daysLate : a.task.confidence === "AT_RISK" ? -1 : 1))
    .slice(0, 8);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Manager view</div>
          <h1 className="text-2xl font-semibold tracking-tight">Team overview · {label}</h1>
          <div className="text-xs text-ink-3 mt-1">
            {d.live ? "Live" : "Month closed"} · Last Zoho sync {lastSync ? fmtDateTime(new Date(lastSync)) : "not yet"}
          </div>
        </div>
        <MonthPicker months={options} value={month} />
      </div>

      {!m.total ? (
        <div className="mt-6"><Empty>No tasks fall in {label}. Pick another month, or check the Zoho sync in Settings.</Empty></div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi vs={vs} label="Completed" value={pctText(m.completedPct)} sub={`${m.completed} of ${m.total} tasks`} delta={dl(m.completedPct, p?.completedPct)} />
            <Kpi vs={vs} label="On time" value={pctText(m.onTimePct)} sub="of finished tasks with a due date" delta={dl(m.onTimePct, p?.onTimePct)} />
            <Kpi vs={vs} label="Missed deadline" value={pctText(m.missedPct)} sub={`${m.missed} tasks · ${m.overdueOpen} open, ${m.finishedLate} late`} delta={dl(m.missedPct, p?.missedPct)} goodWhenUp={false} />
            <Kpi vs={vs} label="Blocked / waiting" value={pctText(m.bucketPct.BLOCKED)} sub={`${m.buckets.BLOCKED} tasks`} delta={dl(m.bucketPct.BLOCKED, p?.bucketPct?.BLOCKED)} goodWhenUp={false} />
            <Kpi vs={vs} label="In progress" value={pctText(m.bucketPct.IN_PROGRESS)} sub={`${m.buckets.IN_PROGRESS} in progress · ${m.buckets.REVIEW} in review`} delta={dl(m.bucketPct.IN_PROGRESS, p?.bucketPct?.IN_PROGRESS)} goodWhenUp={false} />
            <Kpi vs={vs} label="Total tasks" value={String(m.total)} sub={`${m.carried} carried over · ${m.noDue} without due date`} delta={p?.total ? m.total - p.total : null} unit="tasks" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <div className="card p-4">
              <div className="label mb-2">What stands out</div>
              <ul className="space-y-2">
                {d.insights.map((i, k) => (
                  <li key={k} className="flex gap-2 text-sm">
                    <span className={`${toneStyle[i.tone]} text-xs mt-0.5`} aria-hidden>{toneIcon[i.tone]}</span>
                    <span>{i.text}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="label">Needs attention now</div>
                <span className="text-xs text-ink-3">{m.atRisk} At Risk · {m.tight} Tight</span>
              </div>
              {watch.length ? (
                <ul className="divide-y divide-line">
                  {watch.map((i) => (
                    <li key={i.task.id} className="flex items-center gap-3 py-1.5 text-sm">
                      <ConfidencePill level={i.task.confidence} />
                      <Link href={`/tasks/${i.task.id}`} className="min-w-0 flex-1 truncate hover:text-brand" title={i.task.confidenceReason ?? ""}>
                        {i.task.name} <span className="text-ink-3">· {i.client}</span>
                      </Link>
                      <span className="text-xs text-ink-2 whitespace-nowrap">{i.task.assignees.map((a) => a.user.name).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-ink-3 py-4">{d.live ? "Nothing is Tight or At Risk right now." : "Confidence is tracked live for the current month."}</div>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="card p-4">
              <div className="label mb-2">Completion & on-time, last 6 months</div>
              <TrendChart data={tr} />
            </div>
            <div className="card p-4">
              <div className="label mb-3">Status mix by client</div>
              <StatusMix rows={d.clients.slice(0, 10).map((c) => ({ name: c.name, buckets: c.metrics.buckets, total: c.metrics.total }))} />
            </div>
            <div className="card p-4">
              <div className="label mb-3">Why work is pending</div>
              <ReasonBars rows={d.reasons} />
            </div>
          </div>

          <SectionTitle right={<span className="text-xs text-ink-3">Click a name to open their dashboard</span>}>Team</SectionTitle>
          <div className="card overflow-x-auto">
            <table className="tbl w-full">
              <thead>
                <tr>
                  <th>Person</th><th>Tasks</th><th className="w-40">Completed</th><th>On time</th><th>Missed</th>
                  <th>In progress</th><th>Blocked</th><th>Review</th><th>At risk</th><th>Rating</th><th>Clients</th>
                </tr>
              </thead>
              <tbody>
                {d.people.map((pp) => (
                  <tr key={pp.userId} className="hover:bg-plane/60">
                    <td><Link href={`/people/${pp.userId}?month=${month}`} className="font-medium hover:text-brand">{pp.name}</Link></td>
                    <td className="num">{pp.metrics.total}</td>
                    <td><div className="flex items-center gap-2"><Bar value={pp.metrics.completedPct} /><span className="num text-xs w-11 text-right">{pp.metrics.completedPct}%</span></div></td>
                    <td className="num">{pctText(pp.metrics.onTimePct)}</td>
                    <td className={`num ${pp.metrics.missed ? "text-crit font-semibold" : ""}`}>{pp.metrics.missed}</td>
                    <td className="num">{pp.metrics.buckets.IN_PROGRESS}</td>
                    <td className={`num ${pp.metrics.buckets.BLOCKED ? "text-[#b4471d] font-semibold" : ""}`}>{pp.metrics.buckets.BLOCKED}</td>
                    <td className="num">{pp.metrics.buckets.REVIEW}</td>
                    <td className="num">{d.live ? pp.metrics.atRisk : "—"}</td>
                    <td className="num">{ratingBy.get(pp.userId) ? `${ratingBy.get(pp.userId)}/10` : "—"}</td>
                    <td className="text-xs text-ink-2 max-w-[220px] truncate" title={pp.clients.join(", ")}>{pp.clients.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionTitle>By client</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {d.clients.map((c) => (
              <details key={c.name} className="card p-4 group">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold truncate">{c.name}</span>
                      <ClientTypeBadge type={c.type} />
                    </div>
                    <span className="text-xs text-ink-3 group-open:rotate-180 transition">▾</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Bar value={c.metrics.completedPct} />
                    <span className="num text-sm font-semibold w-12 text-right">{c.metrics.completedPct}%</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-ink-2 num">
                    <span>{c.metrics.total} tasks</span>
                    <span>{c.metrics.completed} done</span>
                    <span className={c.metrics.missed ? "text-crit font-semibold" : ""}>{c.metrics.missed} missed</span>
                    <span>{c.metrics.buckets.BLOCKED} blocked</span>
                  </div>
                  <div className="mt-3 space-y-1">
                    {c.people.map((pp) => (
                      <div key={pp.userId} className="flex items-center justify-between text-xs">
                        <span>{pp.name}</span>
                        <span className="text-ink-2 num">{pp.metrics.completed}/{pp.metrics.total} done · {pp.metrics.completedPct}%</span>
                      </div>
                    ))}
                  </div>
                </summary>
                <ul className="mt-3 border-t border-line pt-2 space-y-1.5">
                  {c.items.map((i) => (
                    <li key={i.task.id} className="flex items-center justify-between gap-2 text-xs">
                      <Link href={`/tasks/${i.task.id}`} className="truncate hover:text-brand">{i.task.name}</Link>
                      <StatusTag bucket={i.state} />
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
