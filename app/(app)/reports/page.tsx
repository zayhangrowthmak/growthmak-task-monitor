import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { availableMonths } from "@/lib/metrics";
import { addMonths, currentMonth, monthLabel, fmtDateTime } from "@/lib/time";
import { regenerateReport } from "@/app/actions";

export default async function Reports() {
  await requireAdmin();
  const cur = currentMonth();
  const months = (await availableMonths()).filter((m) => m < cur);
  const saved = new Map((await prisma.monthlyReport.findMany({ select: { month: true, generatedAt: true } })).map((r) => [r.month, r.generatedAt]));
  return (
    <div>
      <div className="label">Reports</div>
      <h1 className="text-2xl font-semibold tracking-tight">Monthly delivery reports</h1>
      <p className="mt-1 text-sm text-ink-2 max-w-2xl">
        One PDF per month for the team review: overall %, client and team performance, ratings and review comments, delay patterns,
        and every task that missed its deadline or is blocked, with its latest comment. A month&apos;s report becomes available on the 1st of the next month.
      </p>
      <div className="mt-5 card divide-y divide-line">
        <div className="flex items-center justify-between p-4">
          <div>
            <div className="font-medium">{monthLabel(cur)}</div>
            <div className="text-xs text-ink-3">In progress · available on 1 {monthLabel(addMonths(cur, 1))}</div>
          </div>
          <span className="btn opacity-50 cursor-not-allowed">PDF not ready</span>
        </div>
        {months.map((m) => (
          <div key={m} className="flex items-center justify-between gap-3 p-4">
            <div>
              <div className="font-medium">{monthLabel(m)}</div>
              <div className="text-xs text-ink-3">{saved.has(m) ? `Generated ${fmtDateTime(saved.get(m)!)}` : "Will be generated on first download"}</div>
            </div>
            <div className="flex gap-2">
              {saved.has(m) && (
                <form action={regenerateReport}>
                  <input type="hidden" name="month" value={m} />
                  <button className="btn" title="Rebuild with the latest comments and reviews">Rebuild</button>
                </form>
              )}
              <a className="btn btn-primary" href={`/api/reports/${m}`}>Download PDF</a>
            </div>
          </div>
        ))}
        {!months.length && <div className="p-4 text-sm text-ink-3">No finished months yet.</div>}
      </div>
    </div>
  );
}
