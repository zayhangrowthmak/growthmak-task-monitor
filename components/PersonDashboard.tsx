import Link from "next/link";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ALL, monthData, previousFor, type Row } from "@/lib/metrics";
import { resolvePeriod } from "@/lib/period";
import { currentMonth, fmtDate, fmtDateTime, monthLabel } from "@/lib/time";
import { MonthPicker, PersonPicker } from "./Pickers";
import { Kpi, Empty, PctText, pctBig, StatePill } from "./ui";
import { Kanban, TaskList, TaskDetail, SlipReasonForm } from "./Tasks";
import { saveReview } from "@/app/actions";
import { bucketLabel, slipLabel } from "@/lib/status";
import { VERDICT_LABEL } from "@/lib/reasons";
import { markProofSentAction } from "@/app/actions";
import { Icon } from "./Icon";
import { getSettings } from "@/lib/settings";
import { workdayProgress } from "@/lib/workdays";
import { Meter, SplitBar, PartsLegend, PaceBand, paceTone, onTimeTone } from "./Viz";

/** Data-suggested 1–5 score from a percentage. */
export const suggestScore = (v: number | null) => (v === null ? null : v >= 90 ? 5 : v >= 75 ? 4 : v >= 60 ? 3 : v >= 40 ? 2 : 1);

const TABS = [
  { key: "plan", label: "This month's plan" },
  { key: "unplanned", label: "Unplanned" },
  { key: "old", label: "Old (pending decision)" },
  { key: "backlog", label: "Backlog" },
  { key: "assigned", label: "Assigned to others" },
] as const;

export async function PersonDashboard({ person, viewer, sp, basePath }: { person: User; viewer: User; sp: Record<string, string>; basePath: string }) {
  const { month: picked, options, label } = await resolvePeriod(sp);
  const month = picked === ALL ? currentMonth() : picked;
  const view = sp.view === "list" ? "list" : "kanban";
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "plan") as (typeof TABS)[number]["key"];
  const d = await monthData(month, { userId: person.id });
  const elapsed = workdayProgress(month, new Date(), (await getSettings()).workingDays);
  const m = d.metrics;
  const prev = await previousFor(d, person.id);
  const admin = viewer.role === "ADMIN";
  const own = viewer.id === person.id;
  // Delay reasons this person gave (or on their tasks), and where each one stands with the managers
  const myReasons = await prisma.reasonReview.findMany({
    where: {
      OR: [{ submittedById: person.id }, { task: { assignees: { some: { userId: person.id } } } }],
      AND: [{ OR: [{ status: { in: ["PENDING", "PROOF_REQUESTED", "PROOF_SENT"] } }, { decidedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }] }],
    },
    include: { task: true, decidedBy: true },
    orderBy: { submittedAt: "desc" },
    take: 20,
  });
  const proofAsked = myReasons.filter((r) => r.status === "PROOF_REQUESTED");
  const review = await prisma.monthlyReview.findUnique({ where: { userId_month: { userId: person.id, month } }, include: { reviewer: true } });
  const people = admin ? await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const qs = (extra: Record<string, string | undefined>) => {
    const base: Record<string, string> = { month, view, tab };
    const q = new URLSearchParams({ ...base, ...(Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) as Record<string, string>) });
    return `${basePath}?${q.toString()}`;
  };
  const hrefFor = (id: string) => qs({ task: id });
  const all: Row[] = [...d.rows, ...d.unplannedOpen, ...d.unplannedDone, ...d.delegated];
  const openRow = sp.task ? all.find((r) => r.task.id === sp.task) : undefined;
  const dueChanges = openRow ? await prisma.dueDateChange.findMany({ where: { taskId: openRow.task.id }, orderBy: { changedAt: "desc" }, take: 10 }) : [];
  const needReason = (own || admin) && d.live ? d.rows.filter((r) => !r.done && (r.slip || r.waitingClient || r.blockedInternal) && !r.task.slipReason) : [];
  const vs = d.live ? "vs same day last month" : "vs last month";
  const dl = (a: number | null | undefined, b: number | null | undefined) => (a === null || a === undefined || b === null || b === undefined ? null : a - b);
  const sugDelivery = suggestScore(m.delivery.value);
  const sugOnTime = suggestScore(m.onTime.value);
  // Tasks this person owns in Zoho but someone else is assigned to live in their own tab and never count here
  const tabRows = tab === "plan" ? d.rows : tab === "unplanned" ? [...d.unplannedOpen, ...d.unplannedDone] : tab === "assigned" ? d.delegated : [];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{person.name} · {label}</h1>
          <div className="text-xs text-ink-3 mt-1">
            {d.virtual ? "No stored plan for this month — planned = due in the month" : d.plan?.status === "DRAFT" ? `Planning window — plan locks ${fmtDate(d.plan.locksAt)}` : `Plan locked ${fmtDate(d.plan?.lockedAt)}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {admin && people.length > 0 && <PersonPicker people={people} value={person.id} month={month} />}
          <MonthPicker months={options.filter((o) => o.value !== ALL)} value={month} />
        </div>
      </div>

      {proofAsked.length > 0 && (
        <div className="mt-4 rounded-xl border border-warn bg-warn/10 p-4" role="status">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="mail" size={16} />
            {own ? "Proof requested from you" : `Proof requested from ${person.name.split(" ")[0]}`} ({proofAsked.length})
          </div>
          <ul className="mt-2 space-y-3">
            {proofAsked.map((r) => (
              <li key={r.id} className="text-sm">
                <Link href={qs({ task: r.taskId })} scroll={false} className="font-medium hover:text-brand">{r.task.key} {r.task.name}</Link>
                <p className="text-ink-2"><b className="font-medium text-ink">{r.decidedBy?.name}</b> asks: {r.managerNote}</p>
                {(own || admin) && (
                  <form action={markProofSentAction} className="mt-1.5 flex flex-wrap gap-2">
                    <input type="hidden" name="reasonId" value={r.id} />
                    <input name="proofNote" placeholder="Optional: what you sent" aria-label="What you sent" className="min-w-[14rem] flex-1" maxLength={500} />
                    <button className="btn btn-primary">I&apos;ve emailed the proof</button>
                  </form>
                )}
                <p className="mt-1 text-xs text-ink-3">Email {r.decidedBy?.email} with the CC list copied, then confirm here.</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {needReason.length > 0 && (
        <div className="mt-4 rounded-xl border border-crit bg-crit/5 p-4">
          <div className="font-semibold text-sm">{needReason.length} planned deliverable{needReason.length === 1 ? " needs" : "s need"} a reason</div>
          <p className="text-xs text-ink-2 mt-0.5">They went overdue, moved out of the month, or are blocked. Pick a reason so the team knows what&apos;s holding them up.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {needReason.slice(0, 6).map((r) => (
              <div key={r.task.id} className="card p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <Link href={hrefFor(r.task.id)} className="text-sm font-medium hover:text-brand">{r.task.name}</Link>
                  <StatePill state={r.state} />
                </div>
                <SlipReasonForm r={r} />
              </div>
            ))}
          </div>
        </div>
      )}

      {(() => {
        const frac = d.live ? elapsed.done / elapsed.total : 1;
        const mine = d.rows.filter((r) => r.slip && !r.waitingClient);
        const parts = [
          { label: "open", value: mine.filter((r) => r.slip === "OPEN").length },
          { label: "late", value: mine.filter((r) => r.slip === "LATE").length },
          { label: "moved", value: mine.filter((r) => r.slip === "MOVED").length },
        ];
        return (
          <>
            <PaceBand completed={m.completed} planned={m.planned} inReview={d.rows.filter((r) => !r.done && r.task.bucket === "REVIEW").length} elapsed={elapsed} live={d.live} who={own ? "you" : person.name.split(" ")[0]} />
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi vs={vs} label="Delivery" icon="target" tone="brand" value={pctBig(m.delivery)} sub={`${m.completed} of ${m.planned} planned`} small={m.delivery.small} delta={dl(m.delivery.value, prev?.delivery.value)}
                viz={<Meter value={m.delivery.value} tone={m.delivery.small ? "none" : paceTone(m.completed, m.planned, frac).tone} delay={100} label={`Delivery ${pctBig(m.delivery)}`} />} />
              <Kpi vs={vs} label="Client / Internal" icon="briefcase" tone="teal" value={`${pctBig(m.client.delivery)} / ${pctBig(m.internal.delivery)}`} sub={`${m.client.completed}/${m.client.planned} client · ${m.internal.completed}/${m.internal.planned} internal`}
                viz={<SplitBar delay={160} label={`${m.client.planned} client and ${m.internal.planned} internal deliverables planned`} parts={[{ label: "client", value: m.client.planned }, { label: "internal", value: m.internal.planned, color: "var(--c-series-3)" }]} />} />
              <Kpi vs={vs} label="On time" icon="clock" tone="teal" value={pctBig(m.onTime)} sub={`${m.onTime.n} of ${m.onTime.d} finished`} small={m.onTime.small} delta={dl(m.onTime.value, prev?.onTime.value)}
                viz={<Meter value={m.onTime.value} tone={m.onTime.small ? "none" : onTimeTone(m.onTime.value)} delay={220} label={`On time ${pctBig(m.onTime)}`} />} />
              <Kpi vs={vs} label="Slipped" icon="trendDown" tone="crit" value={String(mine.length)} goodWhenUp={false} unit="tasks" delta={dl(m.slipped, prev?.slipped)}
                viz={<><SplitBar delay={280} label={parts.map((p) => `${p.value} ${p.label}`).join(", ")} parts={parts} /><PartsLegend parts={parts} /></>} />
              <Kpi vs={vs} label="Waiting on client" icon="hourglass" tone="warn" value={String(m.waitingClient)} sub="not counted as your miss" />
              <Kpi vs={vs} label="Unplanned done" icon="zap" tone="brand" value={String(m.unplannedDone)} sub={d.live ? `${m.atRisk} at risk now` : "not penalised"} />
            </div>
          </>
        );
      })()}

      <div className="mt-4 card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5"><span className="chip chip-teal" aria-hidden><Icon name="target" size={15} /></span><h2 className="text-sm font-semibold">Monthly review · {monthLabel(month)}</h2></div>
          {review && <span className="text-xs text-ink-3">by {review.reviewer.name}, {fmtDateTime(review.updatedAt)}</span>}
        </div>
        {admin ? (
          <form action={saveReview} className="mt-3 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <input type="hidden" name="userId" value={person.id} />
            <input type="hidden" name="month" value={month} />
            <div className="grid content-start gap-x-3 gap-y-4 sm:grid-cols-2">
              {([
                ["delivery", "Delivery", sugDelivery, review?.delivery],
                ["onTime", "On-time", sugOnTime, review?.onTime],
                ["quality", "Quality / rework", null, review?.quality],
                ["ownership", "Ownership / communication", null, review?.ownership],
              ] as const).map(([name, labelText, sug, cur]) => (
                <label key={name} className="flex flex-col text-sm">
                  <span className="text-ink-2">{labelText}</span>
                  <select name={name} defaultValue={cur ?? sug ?? ""} className="mt-1 w-full font-semibold">
                    <option value="">—</option>
                    {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}
                  </select>
                  <span className="mt-1 text-[11px] text-ink-3">{sug !== null ? `Suggested from data: ${sug}` : "Your judgement"}</span>
                </label>
              ))}
            </div>
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-ink-2">Manager remarks</span>
                <textarea name="managerRemarks" rows={3} defaultValue={review?.managerRemarks ?? ""} placeholder="What went well, what to change" className="mt-1 w-full" />
              </label>
              <label className="block text-sm">
                <span className="text-ink-2">COO remarks</span>
                <textarea name="cooRemarks" rows={3} defaultValue={review?.cooRemarks ?? ""} placeholder="Optional" className="mt-1 w-full" />
              </label>
              <button className="btn btn-primary">{review ? "Update review" : "Save review"}</button>
            </div>
          </form>
        ) : review ? (
          <div className="mt-2 grid gap-3 md:grid-cols-2 text-sm">
            <div>Delivery {review.delivery ?? "—"} · On-time {review.onTime ?? "—"} · Quality {review.quality ?? "—"} · Ownership {review.ownership ?? "—"} (out of 5)</div>
            <div className="space-y-1">
              {review.managerRemarks && <p><b>Manager:</b> {review.managerRemarks}</p>}
              {review.cooRemarks && <p><b>COO:</b> {review.cooRemarks}</p>}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-sm text-ink-3">No review yet for this month.</div>
        )}
      </div>

      {myReasons.length > 0 && (
        <section className="mt-6 card p-4" aria-label="Delay reasons">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2.5 text-sm font-semibold"><span className="chip chip-warn" aria-hidden><Icon name="message" size={15} /></span>{own ? "Your delay reasons" : "Delay reasons"}</h2>
            <span className="text-xs text-ink-3">Last 30 days · every reason is reviewed by a manager</span>
          </div>
          <ul className="mt-2 divide-y divide-line">
            {myReasons.map((r) => (
              <li key={r.id} className="grid gap-x-3 gap-y-0.5 py-2 text-sm sm:grid-cols-[9.5rem_minmax(0,1fr)]">
                <span className={`h-fit w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${({ PENDING: "bg-plane text-ink-2", PROOF_SENT: "bg-brand-soft text-brand-dark", PROOF_REQUESTED: "bg-warn/20 text-warnText", AGREED: "bg-good/10 text-goodText", DISAGREED: "bg-crit/10 text-crit" } as const)[r.status]}`}>
                  {VERDICT_LABEL[r.status]}
                </span>
                <span className="min-w-0">
                  <Link href={qs({ task: r.taskId })} scroll={false} className="hover:text-brand">{r.task.key} {r.task.name}</Link>
                  <span className="text-ink-2"> · {slipLabel(r.reason)}</span>
                  {r.managerNote && <span className="block text-xs text-ink-2">{r.decidedBy?.name}: {r.managerNote}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-full rounded-lg border border-line bg-field p-0.5"><div className="scroll-x no-scrollbar fade-x-sm flex gap-1 text-sm" role="tablist" aria-label="Task groups">
          {TABS.map((t) => {
            const n = t.key === "plan" ? d.rows.length : t.key === "unplanned" ? d.unplannedOpen.length + d.unplannedDone.length : t.key === "old" ? d.old.length : t.key === "assigned" ? d.delegated.length : d.backlog.length;
            return (
              <Link key={t.key} href={qs({ tab: t.key, task: undefined })} role="tab" aria-selected={tab === t.key} className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1 transition-colors max-sm:py-2 ${tab === t.key ? "bg-brand-soft text-brand-dark font-medium" : "text-ink-2 hover:text-ink hover:bg-plane"}`}>
                {t.label} <span className="text-ink-3 num">{n}</span>
              </Link>
            );
          })}
        </div></div>
        {(tab === "plan" || tab === "unplanned" || tab === "assigned") && (
          <div className="flex rounded-lg border border-line bg-field p-0.5 text-sm">
            <Link href={qs({ view: "kanban" })} className={`rounded-md px-3 py-1 ${view === "kanban" ? "bg-brand-soft text-brand-dark font-medium" : "text-ink-2"}`}>Kanban</Link>
            <Link href={qs({ view: "list" })} className={`rounded-md px-3 py-1 ${view === "list" ? "bg-brand-soft text-brand-dark font-medium" : "text-ink-2"}`}>List</Link>
          </div>
        )}
      </div>

      {tab === "assigned" && (
        <p className="mb-3 text-sm text-ink-2 max-w-3xl">
          Tasks {own ? "you own" : `${person.name} owns`} in Zoho but that are assigned to someone else. They count for the person doing them, not here.
        </p>
      )}
      {(tab === "plan" || tab === "unplanned" || tab === "assigned") &&
        (tabRows.length === 0 ? (
          <Empty>{tab === "plan" ? `Nothing planned for ${label}.` : tab === "assigned" ? "No tasks assigned to others this month." : "No unplanned work this month."}</Empty>
        ) : view === "kanban" ? (
          <Kanban rows={tabRows} hrefFor={hrefFor} />
        ) : (
          <TaskList rows={tabRows} hrefFor={hrefFor} />
        ))}

      {tab === "old" && (
        <div className="card overflow-x-auto">
          <div className="flex items-center justify-between p-3 border-b border-line">
            <span className="text-sm text-ink-2">Open tasks from earlier months. They don&apos;t count this month unless kept in the review.</span>
            {d.live && d.old.length > 0 && <Link href={`/review${admin && !own ? `?user=${person.id}` : ""}`} className="btn btn-primary">Review these</Link>}
          </div>
          <table className="tbl w-full">
            <thead><tr><th>Task</th><th>Client</th><th>Original due</th><th>Days overdue</th><th>Decision</th></tr></thead>
            <tbody>
              {d.old.map((o) => (
                <tr key={o.task.id}>
                  <td><span className="font-mono text-xs text-ink-3">{o.task.key}</span> {o.task.name}</td>
                  <td>{o.client}</td>
                  <td className="num">{fmtDate(o.task.dueDate)}</td>
                  <td className="num">{o.daysOverdue ?? "no due date"}</td>
                  <td className="text-xs">{o.decision ? `${o.decision.decision}${o.decision.newDueDate ? ` → ${fmtDate(o.decision.newDueDate)}` : ""}` : <span className="text-warnText">Pending</span>}</td>
                </tr>
              ))}
              {!d.old.length && <tr><td colSpan={5} className="text-center text-ink-3 py-6">{d.live ? "No old open tasks." : "Old-task review applies to the current month."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "backlog" && (
        <div className="card overflow-x-auto">
          <table className="tbl w-full">
            <thead><tr><th>Task</th><th>Project</th><th>Status</th><th>Last update</th></tr></thead>
            <tbody>
              {d.backlog.map((t) => (
                <tr key={t.id}>
                  <td><span className="font-mono text-xs text-ink-3">{t.key}</span> {t.name}</td>
                  <td>{t.project.name}</td>
                  <td>{bucketLabel(t.bucket)}{t.bucket !== "BACKLOG" && <span className="text-[11px] text-ink-3"> · Backlog in the dashboard, waiting for Zoho approval</span>}</td>
                  <td className="num">{fmtDate(t.updatedAtZoho)}</td>
                </tr>
              ))}
              {!d.backlog.length && <tr><td colSpan={4} className="text-center text-ink-3 py-6">Backlog is empty. Backlog tasks never alert and never count in scores.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {openRow && (
        <>
          <Link href={qs({ task: undefined })} scroll={false} className="fixed inset-0 z-30 bg-black/20" aria-label="Close task" />
          <aside className="fixed right-0 top-0 z-40 h-full w-full max-w-[460px] overflow-y-auto border-l border-line bg-surface p-5 shadow-xl">
            <TaskDetail r={openRow} month={month} canEdit={admin || openRow.task.assignees.some((a) => a.userId === viewer.id)} closeHref={qs({ task: undefined })} dueChanges={dueChanges} />
          </aside>
        </>
      )}
    </div>
  );
}

export { PctText };
