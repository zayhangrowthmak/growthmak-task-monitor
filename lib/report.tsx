import React from "react";
// @react-pdf/renderer is ESM-only; load it with a native import at runtime so it
// works the same under Next.js and under plain Node scripts/tests.
type ReactPdf = typeof import("@react-pdf/renderer");
let R: ReactPdf;
const nativeImport = new Function("s", "return import(s)") as (s: string) => Promise<ReactPdf>;
import type { MonthlyReview, User } from "@prisma/client";
import type { periodData, Metrics } from "./metrics";
import { monthLabel, fmtDate, fmtDateTime } from "./time";
import { bucketLabel, reasonLabel } from "./status";

type Data = Awaited<ReturnType<typeof periodData>>;
type Review = MonthlyReview & { user: User };

const C = { ink: "#0b0b0b", ink2: "#52514e", ink3: "#898781", line: "#e1e0d9", brand: "#2a78d6", good: "#006300", crit: "#d03b3b", plane: "#f6f6f3" };

const s: Record<string, any> = {
  page: { padding: 32, paddingBottom: 44, fontSize: 9, color: C.ink, fontFamily: "Helvetica" },
  band: { backgroundColor: C.brand, color: "#fff", padding: 14, borderRadius: 4, marginBottom: 14 },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 9, marginTop: 3, color: "#e8f1fc" },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6 },
  kpis: { flexDirection: "row", gap: 6 },
  kpi: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 4, padding: 8 },
  kpiLabel: { fontSize: 7.5, color: C.ink2, textTransform: "uppercase" },
  kpiValue: { fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 3 },
  kpiSub: { fontSize: 7.5, color: C.ink3, marginTop: 2 },
  li: { flexDirection: "row", marginBottom: 3 },
  table: { borderTopWidth: 1, borderColor: C.line },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderColor: C.line, paddingVertical: 4 },
  th: { fontFamily: "Helvetica-Bold", color: C.ink2, fontSize: 8 },
  footer: { position: "absolute", bottom: 20, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", color: C.ink3, fontSize: 7.5 },
};

function delta(cur: number | null, prev: number | null | undefined, goodWhenUp: boolean) {
  if (cur === null || prev === null || prev === undefined) return null;
  const d = Math.round((cur - prev) * 10) / 10;
  if (Math.abs(d) < 0.1) return { text: "no change vs last month", color: C.ink3 };
  const good = d > 0 === goodWhenUp;
  return { text: `${d > 0 ? "+" : "-"}${Math.abs(d)} pts vs last month`, color: good ? C.good : C.crit };
}

function Kpi({ label, value, sub, d }: { label: string; value: string; sub: string; d: ReturnType<typeof delta> }) {
  return (
    <R.View style={s.kpi}>
      <R.Text style={s.kpiLabel}>{label}</R.Text>
      <R.Text style={s.kpiValue}>{value}</R.Text>
      <R.Text style={s.kpiSub}>{sub}</R.Text>
      {d && <R.Text style={{ ...s.kpiSub, color: d.color }}>{d.text}</R.Text>}
    </R.View>
  );
}

function Row({ cells, widths, header }: { cells: (string | number)[]; widths: number[]; header?: boolean }) {
  return (
    <R.View style={s.tr} wrap={false}>
      {cells.map((c, i) => (
        <R.Text key={i} style={[{ width: `${widths[i]}%`, paddingRight: 4 }, header ? s.th : {}]}>
          {String(c)}
        </R.Text>
      ))}
    </R.View>
  );
}

const p = (n: number | null) => (n === null ? "—" : `${n}%`);

function ReportDoc({ month, d, reviews }: { month: string; d: Data; reviews: Review[] }) {
  const m: Metrics = d.metrics;
  const pr = d.prev;
  const reviewBy = new Map(reviews.map((r) => [r.userId, r]));
  const problem = d.items
    .filter((i) => i.overdueOpen || i.finishedLate || i.state === "BLOCKED")
    .sort((a, b) => b.daysLate - a.daysLate);
  const blockedPct = m.bucketPct.BLOCKED;
  return (
    <R.Document title={`Growthmak delivery report — ${monthLabel(month)}`} author="Growthmak Task Monitor">
      <R.Page size="A4" style={s.page}>
        <R.View style={s.band}>
          <R.Text style={s.h1}>Monthly Delivery Report — {monthLabel(month)}</R.Text>
          <R.Text style={s.sub}>Growthmak team performance · generated {fmtDateTime(new Date())}</R.Text>
        </R.View>

        <R.View style={s.kpis}>
          <Kpi label="Completed" value={p(m.completedPct)} sub={`${m.completed} of ${m.total} tasks`} d={delta(m.completedPct, pr?.completedPct, true)} />
          <Kpi label="On time" value={p(m.onTimePct)} sub="of finished tasks with a due date" d={delta(m.onTimePct, pr?.onTimePct, true)} />
          <Kpi label="Missed deadline" value={p(m.missedPct)} sub={`${m.overdueOpen} open · ${m.finishedLate} late`} d={delta(m.missedPct, pr?.missedPct, false)} />
          <Kpi label="Blocked / waiting" value={p(blockedPct)} sub={`${m.buckets.BLOCKED} tasks at month end`} d={delta(blockedPct, pr?.bucketPct?.BLOCKED, false)} />
          <Kpi label="Carried over" value={String(m.carried)} sub={`avg ${m.avgDaysLate ?? 0} days late`} d={null} />
        </R.View>

        <R.Text style={s.h2}>Key findings</R.Text>
        {d.insights.map((i, k) => (
          <R.View key={k} style={s.li}>
            <R.Text style={{ width: 10, color: i.tone === "crit" ? C.crit : i.tone === "good" ? C.good : C.ink2 }}>•</R.Text>
            <R.Text style={{ flex: 1 }}>{i.text}</R.Text>
          </R.View>
        ))}

        <R.Text style={s.h2}>Why work was pending (reasons given in reviews)</R.Text>
        {d.reasons.length === 0 ? (
          <R.Text style={{ color: C.ink3 }}>No reasons were recorded this month.</R.Text>
        ) : (
          <R.View style={s.table}>
            <Row header cells={["Reason", "Tasks", "Share"]} widths={[60, 20, 20]} />
            {(() => {
              const tot = d.reasons.reduce((a, r) => a + r.count, 0);
              return d.reasons.map((r) => <Row key={r.reason} cells={[r.label, r.count, `${Math.round((r.count / tot) * 100)}%`]} widths={[60, 20, 20]} />);
            })()}
          </R.View>
        )}

        <R.Text style={s.h2}>By client</R.Text>
        <R.View style={s.table}>
          <Row header cells={["Client", "Type", "Tasks", "Done", "On time", "Missed", "Blocked"]} widths={[34, 12, 10, 11, 11, 11, 11]} />
          {d.clients.map((c) => (
            <Row
              key={c.name}
              cells={[c.name, c.type === "INTERNAL" ? "Internal" : "Client", c.metrics.total, p(c.metrics.completedPct), p(c.metrics.onTimePct), c.metrics.missed, c.metrics.buckets.BLOCKED]}
              widths={[34, 12, 10, 11, 11, 11, 11]}
            />
          ))}
        </R.View>

        <R.Text style={s.h2}>Team performance</R.Text>
        <R.View style={s.table}>
          <Row header cells={["Person", "Tasks", "Done", "On time", "Missed", "Blocked", "Rating", "Manager review"]} widths={[16, 7, 8, 9, 8, 8, 8, 36]} />
          {d.people.map((pp) => {
            const r = reviewBy.get(pp.userId);
            return (
              <Row
                key={pp.userId}
                cells={[pp.name, pp.metrics.total, p(pp.metrics.completedPct), p(pp.metrics.onTimePct), pp.metrics.missed, pp.metrics.buckets.BLOCKED, r ? `${r.rating}/10` : "—", r?.comment ?? "—"]}
                widths={[16, 7, 8, 9, 8, 8, 8, 36]}
              />
            );
          })}
        </R.View>

        <R.Text style={s.h2} break={problem.length > 8}>
          Tasks that missed the deadline or are blocked ({problem.length})
        </R.Text>
        {problem.length === 0 ? (
          <R.Text style={{ color: C.ink3 }}>Nothing missed or blocked this month.</R.Text>
        ) : (
          <R.View style={s.table}>
            <Row header cells={["Task", "Client", "Assignee", "Due", "Status", "Latest comment"]} widths={[27, 13, 13, 10, 11, 26]} />
            {problem.map((i) => {
              const c = i.task.comments.find((x) => x.month === month) ?? i.task.comments[0];
              return (
                <Row
                  key={i.task.id}
                  cells={[
                    `${i.task.key ? `${i.task.key} · ` : ""}${i.task.name}`,
                    i.client,
                    i.task.assignees.map((a) => a.user.name).join(", ") || "—",
                    fmtDate(i.task.dueDate),
                    i.overdueOpen ? `Overdue ${i.daysLate}d` : i.finishedLate ? `Late ${i.daysLate}d` : bucketLabel(i.state),
                    c ? `${reasonLabel(c.reason)}: ${c.text}` : "No comment yet",
                  ]}
                  widths={[27, 13, 13, 10, 11, 26]}
                />
              );
            })}
          </R.View>
        )}

        <R.View style={s.footer} fixed>
          <R.Text>Growthmak Task Monitor · {monthLabel(month)}</R.Text>
          <R.Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </R.View>
      </R.Page>
    </R.Document>
  );
}

export async function renderReportPdf(month: string, d: Data, reviews: Review[]): Promise<Buffer> {
  R ??= await nativeImport("@react-pdf/renderer");
  return R.renderToBuffer(<ReportDoc month={month} d={d} reviews={reviews} />);
}
