import Link from "next/link";
import { Meter, SplitBar, PartsLegend, PaceBand, paceTone, onTimeTone, TONE } from "@/components/Viz";
import { workdayProgress } from "@/lib/workdays";
import { Icon } from "@/components/Icon";
import { peopleLabel } from "@/lib/people";
import { requireAdmin } from "@/lib/auth";
import { ALL, monthData, previousFor, groupByPerson, groupByClient, buildInsights, trend, workload, type PersonRow, type Row } from "@/lib/metrics";
import { resolvePeriod } from "@/lib/period";
import { currentMonth, fmtDate, fmtDateTime } from "@/lib/time";
import { getState, prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { MonthPicker } from "@/components/Pickers";
import { CardTitle, Kpi, Bar, SectionTitle, ClientTypeBadge, Empty, PctText, pctBig, StatePill } from "@/components/ui";
import { TrendChart, ReasonBars } from "@/components/Charts";
import { WorkloadStrip } from "@/components/Workload";
import { slipLabel } from "@/lib/status";

const toneStyle = { good: "text-goodText", crit: "text-crit", warn: "text-warnText", info: "text-ink-2" };
const toneIcon = { good: "up", crit: "down", warn: "diamond", info: "dot" } as const;

const SORTS: Record<string, (p: PersonRow) => number | string> = {
  name: (p) => p.name,
  planned: (p) => p.metrics.planned,
  completed: (p) => p.metrics.completed,
  delivery: (p) => p.metrics.delivery.value ?? -1,
  ontime: (p) => p.metrics.onTime.value ?? -1,
  slipped: (p) => p.personSlipped,
  waiting: (p) => p.metrics.waitingClient,
  unplanned: (p) => p.metrics.unplannedDone,
  old: (p) => p.metrics.oldPending,
};

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const { month: picked, options, label } = await resolvePeriod(sp);
  const month = picked === ALL ? currentMonth() : picked;
  const settings = await getSettings();
  const elapsed = workdayProgress(month, new Date(), settings.workingDays);
  const d = await monthData(month);
  const m = d.metrics;
  const prev = await previousFor(d);
  const people = await groupByPerson(d);
  const clients = await groupByClient(d);
  const insights = await buildInsights(d, prev, people, clients);
  const tr = await trend(6, month, d.tasks);
  const wl = workload(d, people);
  const lastSync = await getState("sync.last_ok");
  const reviews = await prisma.monthlyReview.findMany({ where: { month } });
  const overallBy = new Map(
    reviews.map((r) => {
      const xs = [r.delivery, r.onTime, r.quality, r.ownership].filter((x): x is number => typeof x === "number");
      return [r.userId, xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null];
    })
  );
  const vs = d.live ? "vs same day last month" : "vs last month";
  const dl = (a: number | null | undefined, b: number | null | undefined) => (a === null || a === undefined || b === null || b === undefined ? null : a - b);

  // Needs attention: planned only, Client first, then nearest/most overdue
  const attention = d.rows
    .filter((r) => !r.done && ["OVERDUE", "AT_RISK", "TIGHT", "BLOCKED_CLIENT", "BLOCKED_INTERNAL"].includes(r.state))
    .sort((a, b) => (a.clientType === b.clientType ? 0 : a.clientType === "CLIENT" ? -1 : 1) || (a.task.dueDate?.getTime() ?? 0) - (b.task.dueDate?.getTime() ?? 0))
    .slice(0, 10);

  const sortKey = SORTS[sp.sort ?? ""] ? sp.sort : "planned";
  const dir = sp.dir === "asc" ? 1 : -1;
  const sorted = [...people].sort((a, b) => {
    const x = SORTS[sortKey](a), y = SORTS[sortKey](b);
    return (x < y ? -1 : x > y ? 1 : 0) * (sortKey === "name" ? -dir : dir);
  });
  const sortHref = (k: string) => `?month=${month}&sort=${k}&dir=${sortKey === k && sp.dir !== "asc" ? "asc" : "desc"}`;
  const Th = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <th aria-sort={sortKey === k ? (sp.dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={sortHref(k)} className="-my-1 inline-flex items-center gap-1 py-1 hover:text-brand">
        {children}
        {sortKey === k && <Icon name={sp.dir === "asc" ? "up" : "down"} size={12} />}
      </Link>
    </th>
  );

  const reasonFilter = sp.reason;
  const reasonRows: Row[] = reasonFilter ? d.rows.filter((r) => r.task.slipReason === reasonFilter) : [];

  let planLine = "";
  if (d.virtual) planLine = "No stored plan for this month (before v2): planned = deliverables due in the month";
  else if (d.plan?.status === "DRAFT") planLine = `Planning window — locks ${fmtDate(d.plan.locksAt)}`;
  else if (d.plan) planLine = `Plan locked ${fmtDate(d.plan.lockedAt)}, ${m.planned} planned`;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team overview · {picked === ALL ? label : label}</h1>
          <div className="text-xs text-ink-3 mt-1">
            {planLine} · {d.live ? <span className="inline-flex items-center gap-1.5"><span className="live-dot" aria-hidden />Live</span> : "Month closed"} · Last Zoho sync {lastSync ? fmtDateTime(new Date(lastSync)) : "not yet"} · <Link href={`/plan?month=${month}`} className="text-brand hover:underline">Plan</Link>
          </div>
        </div>
        <MonthPicker months={options.filter((o) => o.value !== ALL)} value={month} />
      </div>

      {!m.planned && !m.unplannedDone ? (
        <div className="mt-6"><Empty>Nothing was planned for {label}. Pick another month, or check the Plan and the Zoho sync.</Empty></div>
      ) : (
        <>
          <PaceBand
            completed={m.completed}
            planned={m.planned}
            inReview={d.rows.filter((r) => !r.done && r.task.bucket === "REVIEW").length}
            elapsed={elapsed}
            live={d.live}
          />

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi vs={vs} label="Client delivery" icon="briefcase" tone="brand" value={pctBig(m.client.delivery)} sub={`${m.client.completed} of ${m.client.planned} planned`} small={m.client.delivery.small} delta={dl(m.client.delivery.value, prev?.client.delivery.value)}
              viz={<Meter value={m.client.delivery.value} tone={m.client.delivery.small ? "none" : paceTone(m.client.completed, m.client.planned, d.live ? elapsed.done / elapsed.total : 1).tone} delay={100} label={`Client delivery ${pctBig(m.client.delivery)}`} />} />
            <Kpi vs={vs} label="Internal delivery" icon="building" tone="teal" value={pctBig(m.internal.delivery)} sub={`${m.internal.completed} of ${m.internal.planned} planned`} small={m.internal.delivery.small} delta={dl(m.internal.delivery.value, prev?.internal.delivery.value)}
              viz={<Meter value={m.internal.delivery.value} tone={m.internal.delivery.small ? "none" : paceTone(m.internal.completed, m.internal.planned, d.live ? elapsed.done / elapsed.total : 1).tone} delay={160} label={`Internal delivery ${pctBig(m.internal.delivery)}`} />} />
            <Kpi vs={vs} label="On time" icon="clock" tone="teal" value={pctBig(m.onTime)} sub={`${m.onTime.n} of ${m.onTime.d} finished`} small={m.onTime.small} delta={dl(m.onTime.value, prev?.onTime.value)} title="Completed on or before the planned due date, out of completed deliverables with a known finish date"
              viz={<Meter value={m.onTime.value} tone={m.onTime.small ? "none" : onTimeTone(m.onTime.value)} delay={220} label={`On time ${pctBig(m.onTime)}`} />} />
            <Kpi vs={vs} label="Slipped" icon="trendDown" tone="crit" value={String(m.slipped)} sub={undefined} delta={dl(m.slipped, prev?.slipped)} goodWhenUp={false} unit="tasks"
              viz={<><SplitBar delay={280} label={`${m.slipOpen} still open, ${m.slipLate} finished late, ${m.slipMoved} moved out`} parts={[{ label: "open", value: m.slipOpen }, { label: "late", value: m.slipLate }, { label: "moved", value: m.slipMoved }]} /><PartsLegend parts={[{ label: "open", value: m.slipOpen }, { label: "late", value: m.slipLate }, { label: "moved", value: m.slipMoved }]} /></>} />
            <Kpi vs={vs} label="Waiting on client" icon="hourglass" tone="warn" value={String(m.waitingClient)} sub={undefined} delta={dl(m.waitingClient, prev?.waitingClient)} goodWhenUp={false} unit="tasks"
              viz={<><SplitBar delay={340} label={`${m.waitingClient} waiting on client, ${m.blockedInternal} blocked internally`} parts={[{ label: "on client", value: m.waitingClient, color: "var(--c-series-2)" }, { label: "internal", value: m.blockedInternal, color: "var(--c-series-1)" }]} /><PartsLegend parts={[{ label: "on client", value: m.waitingClient, color: "var(--c-series-2)" }, { label: "blocked internally", value: m.blockedInternal, color: "var(--c-series-1)" }]} /></>} />
            <Kpi vs={vs} label="Unplanned work" icon="zap" tone="brand" value={String(m.unplannedDone)} sub="done, not in the plan" delta={dl(m.unplannedDone, prev?.unplannedDone)} unit="tasks" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <div className="card p-4">
              <CardTitle icon="sparkles" tone="teal">What stands out</CardTitle>
              <ul className="space-y-2">
                {insights.map((i, k) => (
                  <li key={k} className="flex gap-2 text-sm">
                    <Icon name={toneIcon[i.tone]} size={14} className={`${toneStyle[i.tone]} mt-[3px]`} />
                    <span>{i.text}</span>
                  </li>
                ))}
              </ul>
              {d.live && m.oldPending > 0 && <Link href="/review" className="mt-3 inline-block text-sm text-brand hover:underline">Open the old-task review <Icon name="arrowRight" size={14} className="inline -mt-0.5" /></Link>}
            </div>
            <div className="card p-4">
              <CardTitle icon="flag" tone="crit" note="Planned deliverables only · Client first">Needs attention now</CardTitle>
              {attention.length ? (
                <ul className="divide-y divide-line">
                  {attention.map((r) => (
                    <li key={r.task.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 py-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                      <StatePill state={r.state} />
                      <Link href={`/tasks/${r.task.id}`} className="truncate py-0.5 hover:text-brand" title={`${r.task.name} · ${r.client}`}>
                        {r.task.name} <span className="text-ink-3">· {r.client}</span>
                      </Link>
                      <span className="col-start-2 truncate text-xs text-ink-2 sm:col-start-3 sm:max-w-[14rem] sm:text-right">{peopleLabel(r.task)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-ink-3 py-4">{d.live ? "No planned deliverable needs attention right now." : "Tracked live for the current month."}</div>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="card p-4 lg:col-span-2">
              <CardTitle icon="trendUp" tone="teal">Delivery & on-time, last 6 months</CardTitle>
              <TrendChart data={tr} />
            </div>
            <div className="card p-4">
              <CardTitle icon="help" tone="warn">Why work is pending</CardTitle>
              <ReasonBars rows={m.reasons.map((r) => ({ label: r.label, count: r.count, href: `?month=${month}&reason=${r.reason}#reason-list` }))} />
            </div>
          </div>

          {reasonFilter && (
            <div id="reason-list" className="mt-4 card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="label">Slip reason: {slipLabel(reasonFilter as never)} ({reasonRows.length})</div>
                <Link href={`?month=${month}`} className="text-xs text-brand">Clear</Link>
              </div>
              <ul className="divide-y divide-line text-sm">
                {reasonRows.map((r) => (
                  <li key={r.task.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                    <StatePill state={r.state} />
                    <Link href={`/tasks/${r.task.id}`} className="min-w-0 flex-1 truncate hover:text-brand">{r.task.name} <span className="text-ink-3">· {r.client}</span></Link>
                    <span className="text-xs text-ink-2">{r.task.slipNote}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <SectionTitle icon="users" right={<span className="text-xs text-ink-3">Click a column to sort · waiting-on-client never counts as a person&apos;s slip</span>}>Team</SectionTitle>
          <div className="card overflow-x-auto">
            <table className="tbl w-full">
              <thead>
                <tr>
                  <Th k="name">Person</Th><Th k="planned">Planned</Th><Th k="completed">Completed</Th><Th k="delivery">Delivery</Th><Th k="ontime">On time</Th>
                  <Th k="slipped">Slipped</Th><Th k="waiting"><span className="leading-tight">Waiting on<br />client</span></Th><Th k="unplanned"><span className="leading-tight">Unplanned<br />done</span></Th><Th k="old"><span className="leading-tight">Old<br />pending</span></Th><th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p, idx) => (
                  <tr key={p.userId} className="hover:bg-plane/60">
                    <td>
                      <Link href={`/people/${p.userId}?month=${month}`} className="font-medium hover:text-brand">{p.name}</Link>
                      {p.clients.length > 0 && <div className="text-[11px] text-ink-3" title={p.clients.map((c) => `${c.name} ${c.completed}/${c.planned}`).join("\n")}>{p.clients.length} client{p.clients.length === 1 ? "" : "s"}</div>}
                    </td>
                    <td className="num">{p.metrics.planned}</td>
                    <td className="num">{p.metrics.completed}</td>
                    <td><div className="flex items-center gap-2 min-w-32"><Bar value={p.metrics.delivery.value ?? 0} color={p.metrics.delivery.small ? "rgb(var(--ink-3))" : TONE[paceTone(p.metrics.completed, p.metrics.planned, d.live ? elapsed.done / elapsed.total : 1).tone].fill} delay={idx * 60} /><PctText p={p.metrics.delivery} className="text-xs whitespace-nowrap" /></div></td>
                    <td className="text-xs whitespace-nowrap"><PctText p={p.metrics.onTime} /></td>
                    <td className={`num ${p.personSlipped ? "text-crit font-semibold" : ""}`}>{p.personSlipped}</td>
                    <td className="num">{p.metrics.waitingClient}</td>
                    <td className="num">{p.metrics.unplannedDone}</td>
                    <td className={`num ${p.metrics.oldPending ? "text-warnText font-semibold" : ""}`}>{d.live ? p.metrics.oldPending : "—"}</td>
                    <td className="num">{overallBy.get(p.userId) ? `${overallBy.get(p.userId)}/5` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionTitle icon="layers" right={<span className="text-xs text-ink-3">Open planned deliverables by due week</span>}>Workload</SectionTitle>
          <WorkloadStrip weeks={wl.weeks} rows={wl.rows} green={settings.workloadGreen} amber={settings.workloadAmber} month={month} />

          <SectionTitle icon="briefcase" right={<Link href={`/clients?month=${month}`} className="text-xs text-brand hover:underline">Clients page <Icon name="arrowRight" size={14} className="inline -mt-0.5" /></Link>}>By client</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {clients.map((c) => (
              <Link key={c.name} href={`/clients?month=${month}#${encodeURIComponent(c.name)}`} className="card lift p-4 hover:border-brand">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate">{c.name}</span>
                  <ClientTypeBadge type={c.type} />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Bar value={c.metrics.delivery.value ?? 0} color={c.metrics.delivery.small ? "rgb(var(--ink-3))" : TONE[paceTone(c.metrics.completed, c.metrics.planned, d.live ? elapsed.done / elapsed.total : 1).tone].fill} />
                  <PctText p={c.metrics.delivery} className="text-sm font-semibold whitespace-nowrap" />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-ink-2 num">
                  <span>{c.metrics.planned} planned</span>
                  <span>{c.metrics.completed} done</span>
                  <span className={c.metrics.slipped ? "text-crit font-semibold" : ""}>{c.metrics.slipped} slipped</span>
                  <span>{c.metrics.waitingClient} waiting on client</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
