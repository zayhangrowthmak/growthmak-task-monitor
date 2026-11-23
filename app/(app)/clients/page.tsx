import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Meter, ratioTone, onTimeTone } from "@/components/Viz";
import { peopleLabel } from "@/lib/people";
import { requireAdmin } from "@/lib/auth";
import { ALL, monthData, groupByClient, type FullTask } from "@/lib/metrics";
import { resolvePeriod } from "@/lib/period";
import { addMonths, currentMonth, fmtDate, monthLabel } from "@/lib/time";
import { MonthPicker } from "@/components/Pickers";
import { ClientTypeBadge, PctText, StatePill, Empty } from "@/components/ui";
import { statusWord } from "@/lib/report";
import { slipLabel } from "@/lib/status";

async function clientTrend(name: string, month: string, tasks: FullTask[]) {
  const out: { label: string; value: number | null; d: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const mo = addMonths(month, -i);
    const c = (await groupByClient(await monthData(mo, { tasks }))).find((x) => x.name === name);
    out.push({ label: monthLabel(mo, true).split(" ")[0], value: c?.metrics.delivery.value ?? null, d: c?.metrics.planned ?? 0 });
  }
  return out;
}

export default async function Clients({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const { month: picked, options, label } = await resolvePeriod(sp);
  const month = picked === ALL ? currentMonth() : picked;
  const d = await monthData(month);
  const clients = await groupByClient(d);
  const trends = new Map<string, Awaited<ReturnType<typeof clientTrend>>>();
  for (const c of clients) trends.set(c.name, await clientTrend(c.name, month, d.tasks));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">By client · {label}</h1>
          <p className="text-sm text-ink-2 mt-1">Planned vs completed for the month, what&apos;s waiting on each client, and the deliverable list. Export a client-friendly PDF (no internal ratings) for client calls.</p>
        </div>
        <MonthPicker months={options.filter((o) => o.value !== ALL)} value={month} />
      </div>
      {!clients.length && <div className="mt-6"><Empty>No planned deliverables in {label}.</Empty></div>}
      {clients.map((c) => (
        <section key={c.name} id={encodeURIComponent(c.name)} className="mt-6 card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{c.name}</h2><ClientTypeBadge type={c.type} /></div>
            <div className="flex flex-wrap gap-2">
              <a href={`/api/reports/${month}/client?name=${encodeURIComponent(c.name)}&view=1`} target="_blank" rel="noopener" className="btn">View client PDF<Icon name="external" size={14} /></a>
              <a href={`/api/reports/${month}/client?name=${encodeURIComponent(c.name)}`} className="btn">Download</a>
            </div>
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-4 text-sm">
            <div><div className="label">Delivered</div><div className="mt-1 text-xl font-semibold"><PctText p={c.metrics.delivery} /></div><div className="mt-2"><Meter value={c.metrics.delivery.value} tone={c.metrics.delivery.small ? "none" : ratioTone(c.metrics.delivery.value)} label={`Delivered ${c.metrics.delivery.value ?? 0}%`} /></div></div>
            <div><div className="label">On time</div><div className="mt-1 text-xl font-semibold"><PctText p={c.metrics.onTime} /></div><div className="mt-2"><Meter value={c.metrics.onTime.value} tone={c.metrics.onTime.small ? "none" : onTimeTone(c.metrics.onTime.value)} delay={120} label={`On time ${c.metrics.onTime.value ?? 0}%`} /></div></div>
            <div><div className="label">Slipped</div><div className="mt-1 text-xl font-semibold num">{c.metrics.slipped}</div></div>
            <div>
              <div className="label">Last 6 months</div>
              <div className="mt-2" role="img" aria-label={`Delivery rate by month: ${trends.get(c.name)!.map((t) => `${t.label} ${t.value === null ? "no plan" : `${t.value}%`}`).join(", ")}`}>
                <div className="flex h-9 items-end gap-1.5 border-b border-line">
                  {trends.get(c.name)!.map((t, i) => (
                    <div key={i} className="flex h-full w-6 items-end" title={`${t.label}: ${t.value === null ? "no plan" : `${t.value}% of ${t.d}`}`}>
                      <div
                        className="rise w-full rounded-t-[3px] bg-brand"
                        style={{ height: !t.value ? "2px" : `${Math.max(6, t.value)}%`, opacity: t.value === null ? 0.25 : 1, ["--d" as string]: `${i * 70}ms` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-1.5" aria-hidden>
                  {trends.get(c.name)!.map((t, i) => <span key={i} className="w-6 text-center text-[10px] text-ink-3">{t.label}</span>)}
                </div>
              </div>
            </div>
          </div>
          {c.waiting.length > 0 && (
            <div className="mt-3 rounded-lg bg-warn/10 p-3 text-sm">
              <div className="font-semibold">Waiting on client ({c.waiting.length})</div>
              <ul className="mt-1 space-y-0.5">{c.waiting.sort((a, b) => b.days - a.days).map((w) => <li key={w.row.task.id}>• {w.row.task.name} — <b>{w.days} days</b>{w.row.task.slipNote ? `: ${w.row.task.slipNote}` : ""}</li>)}</ul>
            </div>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="tbl w-full">
              <thead><tr><th>Deliverable</th><th>Owner</th><th>Status</th><th>Conf.</th><th>Zoho ID</th><th>Planned due</th><th>Done on</th><th>Reason / remarks</th></tr></thead>
              <tbody>
                {[...c.rows].sort((a, b) => Number(a.done) - Number(b.done)).map((r) => (
                  <tr key={r.task.id}>
                    <td className="max-w-[260px]"><Link href={`/tasks/${r.task.id}`} className="hover:text-brand">{r.task.name}</Link></td>
                    <td className="whitespace-nowrap">{peopleLabel(r.task)}</td>
                    <td className="whitespace-nowrap"><StatePill state={r.state} title={statusWord(r)} /></td>
                    <td className="num">{r.task.userConfidence ?? "—"}</td>
                    <td className="font-mono text-xs">{r.task.key}</td>
                    <td className="num whitespace-nowrap">{fmtDate(r.plannedDue)}</td>
                    <td className="num whitespace-nowrap">{r.doneAt ? fmtDate(r.doneAt) : r.done ? "done" : "—"}</td>
                    <td className="text-xs text-ink-2 max-w-[240px]">{r.task.slipReason ? `${slipLabel(r.task.slipReason)}${r.task.slipNote ? `: ${r.task.slipNote}` : ""}` : r.task.comments[0]?.text ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
