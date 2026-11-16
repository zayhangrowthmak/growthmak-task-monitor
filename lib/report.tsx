// Monthly Deliverables Report (spec v2 §6) and the client one-pager (§5.3).
import React from "react";
import path from "node:path";
import { prisma, getState } from "./db";
import { monthData, groupByClient, groupByPerson, buildInsights, previousFor, trend, type Row, type Metrics, type Pct, type MonthData } from "./metrics";
import { addMonths, fmtDate, fmtDateTime, monthLabel, monthRange, dayDiff } from "./time";
import { slipLabel, removeLabel, STATE_META } from "./status";
import { getSettings } from "./settings";

// @react-pdf/renderer is ESM-only; load it with a native import at runtime so it
// works the same under Next.js and under plain Node scripts/tests.
type ReactPdf = typeof import("@react-pdf/renderer");
let R: ReactPdf;
const nativeImport = new Function("s", "return import(s)") as (s: string) => Promise<ReactPdf>;

const C = { ink: "#0b0b0b", ink2: "#52514e", ink3: "#898781", line: "#e1e0d9", brand: "#2a78d6", good: "#006300", crit: "#d03b3b", plane: "#f6f6f3", soft: "#e8f1fc" };
const s: Record<string, any> = {
  page: { padding: 30, paddingBottom: 42, fontSize: 8.5, color: C.ink, fontFamily: "Helvetica" },
  band: { backgroundColor: C.brand, color: "#fff", padding: 12, borderRadius: 4, marginBottom: 12 },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 8.5, marginTop: 3, color: "#e8f1fc" },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 5 },
  h3: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 3 },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  kpi: { width: "23.6%", borderWidth: 1, borderColor: C.line, borderRadius: 4, padding: 6 },
  kpiLabel: { fontSize: 6.8, color: C.ink2, textTransform: "uppercase" },
  kpiValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 },
  kpiSub: { fontSize: 6.8, color: C.ink3, marginTop: 1 },
  li: { flexDirection: "row", marginBottom: 2.5 },
  table: { borderTopWidth: 1, borderColor: C.line },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderColor: C.line, paddingVertical: 3 },
  th: { fontFamily: "Helvetica-Bold", color: C.ink2, fontSize: 7.2 },
  muted: { color: C.ink3 },
  blockHead: { flexDirection: "row", justifyContent: "space-between", backgroundColor: C.plane, padding: 5, marginTop: 8, borderRadius: 3 },
  card: { borderWidth: 1, borderColor: C.line, borderRadius: 4, padding: 8, marginTop: 8 },
  footer: { position: "absolute", bottom: 18, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", color: C.ink3, fontSize: 7 },
};

const pt = (p: Pct) => (p.value === null ? "—" : `${Math.round(p.value)}% (${p.n}/${p.d})`);
const pv = (p: Pct) => (p.value === null ? "—" : `${Math.round(p.value)}%`);
function delta(cur: number | null, prev: number | null | undefined, goodUp = true, unit = "pts") {
  if (cur === null || prev === null || prev === undefined) return null;
  const d = Math.round((cur - prev) * 10) / 10;
  if (Math.abs(d) < 0.1) return { text: "no change", color: C.ink3 };
  return { text: `${d > 0 ? "+" : "-"}${Math.abs(d)} ${unit} vs last month`, color: (d > 0) === goodUp ? C.good : C.crit };
}

function Kpi({ label, value, sub, d }: { label: string; value: string; sub?: string; d?: ReturnType<typeof delta> }) {
  return (
    <R.View style={s.kpi} wrap={false}>
      <R.Text style={s.kpiLabel}>{label}</R.Text>
      <R.Text style={s.kpiValue}>{value}</R.Text>
      {sub ? <R.Text style={s.kpiSub}>{sub}</R.Text> : null}
      {d ? <R.Text style={{ ...s.kpiSub, color: d.color }}>{d.text}</R.Text> : null}
    </R.View>
  );
}

function Row_({ cells, widths, header, color }: { cells: (string | number)[]; widths: number[]; header?: boolean; color?: string }) {
  return (
    <R.View style={s.tr} wrap={false}>
      {cells.map((c, i) => (
        <R.Text key={i} style={[{ width: `${widths[i]}%`, paddingRight: 3 }, header ? s.th : {}, color && i === 2 ? { color } : {}]}>
          {String(c)}
        </R.Text>
      ))}
    </R.View>
  );
}

/** Status words used in the deliverables table (spec §6 Section 2). */
export function statusWord(r: Row): string {
  if (r.removed) return "Removed from plan";
  if (r.done) return r.onTime === false ? "Done late" : "Done";
  if (r.slip === "MOVED") return "Moved to next month";
  if (r.waitingClient) return "Waiting on client";
  if (r.blockedInternal) return "Blocked internally";
  if (r.slip === "OPEN") return "Slipped (open)";
  return "In progress";
}
const statusColor = (r: Row) => (r.done ? (r.onTime === false ? C.ink2 : C.good) : r.slip || r.waitingClient || r.blockedInternal ? C.crit : C.ink);
const owners = (r: Row) => r.task.assignees.map((a) => a.user.name).join(", ") || "—";
const remark = (r: Row) => {
  if (r.removed) return `${r.removed.reason ? removeLabel(r.removed.reason) : "Removed"}${r.removed.note ? `: ${r.removed.note}` : ""}`;
  const parts = [r.task.slipReason ? `${slipLabel(r.task.slipReason)}${r.task.slipNote ? `: ${r.task.slipNote}` : ""}` : "", r.task.comments[0]?.text ?? ""].filter(Boolean);
  return parts.join(" · ") || "-";
};
const sortNotDoneFirst = (a: Row, b: Row) => Number(a.done) - Number(b.done) || (a.plannedDue?.getTime() ?? 0) - (b.plannedDue?.getTime() ?? 0);

const W_DELIV = [27, 12, 12, 6, 9, 9, 8, 17];
const W_DETAIL = [22, 12, 10, 8, 6, 14, 16, 12];

async function gather(month: string) {
  const d = await monthData(month);
  const prev = await previousFor(d);
  const people = await groupByPerson(d);
  const clients = await groupByClient(d);
  const insights = await buildInsights(d, prev, people, clients);
  const reviews = await prisma.monthlyReview.findMany({ where: { month }, include: { user: true } });
  const decisions = await prisma.oldTaskReview.findMany({ where: { month } });
  const summary = await getState(`report.summary.${month}`);
  const trends = new Map<string, string>();
  for (const p of people) {
    const t = await trend(3, month, d.tasks, p.userId);
    trends.set(p.userId, t.map((x) => `${x.label.split(" ")[0]} ${x.client === null && x.internal === null ? "—" : pv({ value: deliveryOf(x), n: 0, d: 1, small: false })}`).join(" · "));
  }
  const next = await monthData(addMonths(month, 1), { tasks: d.tasks });
  return { d, prev, people, clients, insights, reviews, decisions, summary, trends, next };
}
const deliveryOf = (x: { client: number | null; internal: number | null }) => x.client ?? x.internal;

/** Old tasks that were open going into the month, with no decision for it. */
function undecidedFor(d: MonthData, decided: Set<string>) {
  const { start } = monthRange(d.month);
  return d.tasks.filter((t) => {
    if (decided.has(t.id) || t.bucket === "BACKLOG" || t.bucket === "CLOSED") return false;
    if (!t.dueDate || t.dueDate >= start) return false;
    const doneAt = t.completedAt ?? t.observedDoneAt;
    if (t.bucket === "COMPLETED" && (!doneAt || doneAt < start)) return false;
    return !d.rows.some((r) => r.task.id === t.id);
  });
}

function ReportDoc({ g }: { g: Awaited<ReturnType<typeof gather>> }) {
  const { d, prev, people, clients, insights, reviews, decisions, summary, trends, next } = g;
  const m: Metrics = d.metrics;
  const month = d.month;
  const reviewBy = new Map(reviews.map((r) => [r.userId, r]));
  const decided = new Set(decisions.map((x) => x.taskId));
  const undecided = undecidedFor(d, decided);
  const problem = [...d.rows.filter((r) => r.slip || r.waitingClient || r.blockedInternal)].sort((a, b) => b.daysLate - a.daysLate);
  const slipCarry = d.rows.filter((r) => !r.done);
  const nextByClient = new Map<string, Row[]>();
  for (const r of next.rows) nextByClient.set(r.client, [...(nextByClient.get(r.client) ?? []), r]);
  const logo = path.join(process.cwd(), "public", "logo.png");

  return (
    <R.Document title={`Growthmak Monthly Deliverables Report — ${monthLabel(month)}`} author="Growthmak Task Monitor">
      {/* Page 1 — Executive summary */}
      <R.Page size="A4" style={s.page}>
        <R.Image src={logo} style={{ height: 24, width: 94, marginBottom: 10 }} />
        <R.View style={s.band}>
          <R.Text style={s.h1}>Growthmak Monthly Deliverables Report - {monthLabel(month)}</R.Text>
          <R.Text style={s.sub}>
            Generated {fmtDateTime(new Date())} · {d.plan?.lockedAt ? `Plan locked ${fmtDate(d.plan.lockedAt)}` : d.virtual ? "No locked plan (planned = due in month)" : "Plan not locked"}
          </R.Text>
        </R.View>
        <R.View style={s.kpis}>
          <Kpi label="Planned" value={String(m.planned)} d={delta(m.planned, prev?.planned, true, "")} />
          <Kpi label="Completed" value={String(m.completed)} sub={pt(m.delivery)} d={delta(m.completed, prev?.completed, true, "")} />
          <Kpi label="Client delivery" value={pv(m.client.delivery)} sub={`${m.client.completed}/${m.client.planned}`} d={delta(m.client.delivery.value, prev?.client.delivery.value)} />
          <Kpi label="Internal delivery" value={pv(m.internal.delivery)} sub={`${m.internal.completed}/${m.internal.planned}`} d={delta(m.internal.delivery.value, prev?.internal.delivery.value)} />
          <Kpi label="On time" value={pv(m.onTime)} sub={`${m.onTime.n}/${m.onTime.d} with known finish date`} d={delta(m.onTime.value, prev?.onTime.value)} />
          <Kpi label="Slipped" value={String(m.slipped)} sub={`${m.slipOpen} open · ${m.slipLate} late · ${m.slipMoved} moved`} d={delta(m.slipped, prev?.slipped, false, "")} />
          <Kpi label="Waiting on client" value={String(m.waitingClient)} d={delta(m.waitingClient, prev?.waitingClient, false, "")} />
          <Kpi label="Unplanned done" value={String(m.unplannedDone)} d={delta(m.unplannedDone, prev?.unplannedDone, true, "")} />
        </R.View>

        <R.Text style={s.h2}>Highlights</R.Text>
        {insights.slice(0, 5).map((i, k) => (
          <R.View key={k} style={s.li}>
            <R.Text style={{ width: 9, color: i.tone === "crit" ? C.crit : i.tone === "good" ? C.good : C.ink2 }}>•</R.Text>
            <R.Text style={{ flex: 1 }}>{i.text}</R.Text>
          </R.View>
        ))}
        <R.Text style={s.h2}>Top issues</R.Text>
        {m.reasons.length ? m.reasons.slice(0, 3).map((r) => <R.Text key={r.reason} style={{ marginBottom: 2 }}>• {r.label}: {r.count}</R.Text>) : <R.Text style={s.muted}>No slip reasons recorded.</R.Text>}
        {summary ? (
          <>
            <R.Text style={s.h2}>Manager summary</R.Text>
            <R.Text>{summary}</R.Text>
          </>
        ) : null}

        {/* Section 2 — Client-wise deliverables */}
        <R.Text style={s.h2} break>2. Client-wise deliverables</R.Text>
        {clients.map((c) => {
          const rows = [...c.rows, ...d.removed.filter((r) => r.client === c.name)].sort(sortNotDoneFirst);
          return (
            <R.View key={c.name}>
              <R.View style={s.blockHead} wrap={false}>
                <R.Text style={{ fontFamily: "Helvetica-Bold" }}>{c.name}{c.type === "INTERNAL" ? " (Internal)" : ""}</R.Text>
                <R.Text>Planned {c.metrics.planned} · Completed {c.metrics.completed} · Delivery {pv(c.metrics.delivery)} · On time {pv(c.metrics.onTime)}</R.Text>
              </R.View>
              <R.View style={s.table}>
                <Row_ header cells={["Deliverable", "Owner", "Status", "Conf.", "Zoho ID", "Planned due", "Done on", "Reason / Remarks"]} widths={W_DELIV} />
                {rows.map((r) => (
                  <Row_ key={r.task.id + (r.removed ? "-x" : "")} color={statusColor(r)} widths={W_DELIV}
                    cells={[r.task.name, owners(r), statusWord(r), r.task.userConfidence ?? "-", r.task.key ?? "-", fmtDate(r.plannedDue), r.doneAt ? fmtDate(r.doneAt) : r.done ? "done" : "-", remark(r)]} />
                ))}
              </R.View>
            </R.View>
          );
        })}

        {/* Section 3 — Team scorecards */}
        <R.Text style={s.h2} break>3. Team member scorecards</R.Text>
        {people.filter((p) => p.metrics.planned || p.metrics.unplannedDone).map((p) => {
          const rv = reviewBy.get(p.userId);
          const crit = rv ? [rv.delivery, rv.onTime, rv.quality, rv.ownership].filter((x): x is number => typeof x === "number") : [];
          const overall = crit.length ? Math.round((crit.reduce((a, b) => a + b, 0) / crit.length) * 10) / 10 : null;
          const mine = p.rows.filter((r) => r.slip || r.waitingClient);
          const dec = decisions.filter((x) => x.userId === p.userId);
          const und = undecided.filter((t) => t.assignees.some((a) => a.userId === p.userId)).length;
          return (
            <R.View key={p.userId} style={s.card} wrap={false}>
              <R.View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <R.Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10 }}>{p.name}</R.Text>
                <R.Text style={s.muted}>Delivery trend: {trends.get(p.userId)}</R.Text>
              </R.View>
              <R.Text style={{ marginTop: 3 }}>
                Planned {p.metrics.planned} · Completed {p.metrics.completed} · Delivery {pt(p.metrics.delivery)} · On time {pv(p.metrics.onTime)} · Slipped {p.personSlipped} · Waiting on client {p.metrics.waitingClient} · Unplanned done {p.metrics.unplannedDone}
              </R.Text>
              <R.Text style={{ marginTop: 2, color: C.ink2 }}>Clients: {p.clients.map((c) => `${c.name} ${c.completed}/${c.planned}`).join(", ") || "—"}</R.Text>
              <R.Text style={{ marginTop: 2 }}>
                Rating: Delivery {rv?.delivery ?? "-"} · On-time {rv?.onTime ?? "-"} · Quality/rework {rv?.quality ?? "-"} · Ownership {rv?.ownership ?? "-"} · Overall {overall ?? "-"}/5
              </R.Text>
              {rv?.managerRemarks ? <R.Text style={{ marginTop: 2 }}>Manager: {rv.managerRemarks}</R.Text> : null}
              {rv?.cooRemarks ? <R.Text style={{ marginTop: 2 }}>COO: {rv.cooRemarks}</R.Text> : null}
              {mine.length ? (
                <R.View style={{ marginTop: 3 }}>
                  {mine.slice(0, 6).map((r) => <R.Text key={r.task.id} style={{ color: C.ink2 }}>• {r.client} - {r.task.name}: {statusWord(r)}{r.task.slipReason ? ` (${slipLabel(r.task.slipReason)})` : ""}</R.Text>)}
                  {mine.length > 6 ? <R.Text style={s.muted}>…and {mine.length - 6} more</R.Text> : null}
                </R.View>
              ) : null}
              <R.Text style={{ marginTop: 3, color: C.ink2 }}>
                Old-task review: Kept {dec.filter((x) => x.decision === "KEEP").length} · Backlog {dec.filter((x) => x.decision === "BACKLOG").length} · Closed {dec.filter((x) => x.decision === "CLOSE").length} · No answer {und}
              </R.Text>
            </R.View>
          );
        })}

        {/* Section 4 — Missed, slipped, blocked */}
        <R.Text style={s.h2} break>4. Missed, slipped and blocked ({problem.length})</R.Text>
        {problem.length ? (
          <R.View style={s.table}>
            <Row_ header cells={["Deliverable", "Client", "Owner", "Planned due", "Days late", "Reason", "Latest comment", "Next step / new date"]} widths={W_DETAIL} />
            {problem.map((r) => (
              <Row_ key={r.task.id} widths={W_DETAIL}
                cells={[r.task.name, r.client, owners(r), fmtDate(r.plannedDue), r.daysLate || "-", r.task.slipReason ? slipLabel(r.task.slipReason) : statusWord(r), r.task.comments[0]?.text ?? "-", r.dueChanged ? `New due ${fmtDate(r.task.dueDate)}` : r.task.slipNote ?? "-"]} />
            ))}
          </R.View>
        ) : <R.Text style={s.muted}>Nothing slipped or blocked.</R.Text>}

        {/* Section 5 — Unplanned work */}
        <R.Text style={s.h2}>5. Unplanned work ({d.unplannedDone.length})</R.Text>
        {d.unplannedDone.length ? (
          <R.View style={s.table}>
            <Row_ header cells={["Task", "Client", "Owner", "Done on"]} widths={[46, 20, 20, 14]} />
            {[...d.unplannedDone].sort((a, b) => owners(a).localeCompare(owners(b)) || a.client.localeCompare(b.client)).map((r) => <Row_ key={r.task.id} widths={[46, 20, 20, 14]} cells={[r.task.name, r.client, owners(r), fmtDate(r.doneAt)]} />)}
          </R.View>
        ) : <R.Text style={s.muted}>No unplanned work was completed.</R.Text>}

        {/* Section 6 — Old tasks & backlog hygiene */}
        <R.Text style={s.h2}>6. Old tasks & backlog hygiene</R.Text>
        {people.map((p) => {
          const dec = decisions.filter((x) => x.userId === p.userId);
          const und = undecided.filter((t) => t.assignees.some((a) => a.userId === p.userId));
          if (!dec.length && !und.length) return null;
          return (
            <R.View key={p.userId} style={{ marginBottom: 4 }} wrap={false}>
              <R.Text style={{ fontFamily: "Helvetica-Bold" }}>{p.name}: kept {dec.filter((x) => x.decision === "KEEP").length}, backlog {dec.filter((x) => x.decision === "BACKLOG").length}, closed {dec.filter((x) => x.decision === "CLOSE").length}, undecided {und.length}</R.Text>
              {und.slice(0, 8).map((t) => <R.Text key={t.id} style={{ color: C.ink2 }}>  • {t.key ?? ""} {t.name} ({dayDiff(t.dueDate!, monthRange(month).start)} days old at month start)</R.Text>)}
              {und.length > 8 ? <R.Text style={s.muted}>  …and {und.length - 8} more</R.Text> : null}
            </R.View>
          );
        })}

        {/* Section 7 — Next month preview */}
        <R.Text style={s.h2}>7. Next month preview — {monthLabel(addMonths(month, 1))}</R.Text>
        <R.Text style={{ marginBottom: 3, color: C.ink2 }}>
          Draft plan: {next.rows.length} deliverables due (incl. recurring). Carried in from this month&apos;s slips: {slipCarry.length} still open.
        </R.Text>
        {[...nextByClient.entries()].map(([client, rows]) => (
          <R.Text key={client} style={{ marginBottom: 1.5 }}>• {client}: {rows.length} — {[...new Set(rows.flatMap((r) => r.task.assignees.map((a) => a.user.name)))].join(", ") || "unassigned"}</R.Text>
        ))}

        {/* Appendix */}
        <R.Text style={s.h2}>Appendix - Definitions</R.Text>
        {[
          "Planned: deliverables in the month's locked Plan (due in the month at lock, recurring, kept from the old-task review, or promoted by a manager).",
          "Delivery rate: planned deliverables completed in the month ÷ planned. Shown for Client and Internal separately.",
          "On-time rate: completed on or before the planned due date ÷ completed (only where the finish date is known).",
          "Slipped: planned but not completed by the planned due date — still open, finished late, or moved out of the month.",
          "Waiting on client: planned and in status Blocked - Client. Not counted as the person's miss.",
          "Unplanned work: completed this month but not in the plan. Shows real workload; not penalised.",
          "Old tasks: open tasks due before the month. They only count if the assignee keeps them in the monthly review.",
        ].map((t, i) => <R.Text key={i} style={{ marginBottom: 2, color: C.ink2 }}>• {t}</R.Text>)}

        <R.View style={s.footer} fixed>
          <R.Text>Growthmak Task Monitor · {monthLabel(month)}</R.Text>
          <R.Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </R.View>
      </R.Page>
    </R.Document>
  );
}

export async function renderReportPdf(month: string): Promise<Buffer> {
  R ??= await nativeImport("@react-pdf/renderer");
  const g = await gather(month);
  return R.renderToBuffer(<ReportDoc g={g} />);
}

/** Client-friendly one-pager for client calls: no internal ratings or owner scorecards. */
export async function renderClientPdf(month: string, client: string): Promise<Buffer> {
  R ??= await nativeImport("@react-pdf/renderer");
  const set = await getSettings();
  const d = await monthData(month);
  const c = (await groupByClient(d)).find((x) => x.name === client);
  const tr = await trend(6, month, d.tasks);
  const rows = c ? [...c.rows].sort(sortNotDoneFirst) : [];
  const logo = path.join(process.cwd(), "public", "logo.png");
  const reviews = set.includeRatingsInClientPdf ? await prisma.monthlyReview.findMany({ where: { month } }) : [];
  void reviews;
  const doc = (
    <R.Document title={`${client} — ${monthLabel(month)} deliverables`} author="Growthmak">
      <R.Page size="A4" style={s.page}>
        <R.Image src={logo} style={{ height: 24, width: 94, marginBottom: 10 }} />
        <R.View style={s.band}>
          <R.Text style={s.h1}>{client} - {monthLabel(month)} deliverables</R.Text>
          <R.Text style={s.sub}>Prepared by Growthmak · {fmtDate(new Date())}</R.Text>
        </R.View>
        {c ? (
          <>
            <R.View style={s.kpis}>
              <Kpi label="Planned" value={String(c.metrics.planned)} />
              <Kpi label="Completed" value={String(c.metrics.completed)} sub={pt(c.metrics.delivery)} />
              <Kpi label="On time" value={pv(c.metrics.onTime)} />
              <Kpi label="Waiting on your input" value={String(c.waiting.length)} />
            </R.View>
            {c.waiting.length ? (
              <>
                <R.Text style={s.h2}>Waiting on your input</R.Text>
                {c.waiting.map((w) => <R.Text key={w.row.task.id} style={{ marginBottom: 2 }}>• {w.row.task.name} — {w.days} days{w.row.task.slipNote ? `: ${w.row.task.slipNote}` : ""}</R.Text>)}
              </>
            ) : null}
            <R.Text style={s.h2}>Deliverables</R.Text>
            <R.View style={s.table}>
              <Row_ header cells={["Deliverable", "Status", "Due", "Done on", "Notes"]} widths={[40, 16, 12, 12, 20]} />
              {rows.map((r) => <Row_ key={r.task.id} widths={[40, 16, 12, 12, 20]} color={statusColor(r)} cells={[r.task.name, statusWord(r), fmtDate(r.plannedDue), r.doneAt ? fmtDate(r.doneAt) : "-", r.waitingClient && r.task.slipNote ? r.task.slipNote : "-"]} />)}
            </R.View>
          </>
        ) : <R.Text>No planned deliverables for {client} in {monthLabel(month)}.</R.Text>}
        <R.Text style={s.h2}>Delivery over the last 6 months</R.Text>
        <R.Text style={{ color: C.ink2 }}>Overall team: {tr.map((t) => `${t.label} ${t.client === null ? "—" : `${Math.round(t.client)}%`}`).join(" · ")}</R.Text>
        <R.View style={s.footer} fixed>
          <R.Text>Growthmak · {client}</R.Text>
          <R.Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </R.View>
      </R.Page>
    </R.Document>
  );
  return R.renderToBuffer(doc);
}

export { STATE_META };
