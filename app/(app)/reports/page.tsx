import { requireAdmin } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { prisma, getState } from "@/lib/db";
import { availableMonths } from "@/lib/metrics";
import { addMonths, currentMonth, monthLabel, fmtDateTime } from "@/lib/time";
import { regenerateReport, saveReportSummary, postReportNow } from "@/app/actions";
import { getSettings } from "@/lib/settings";

export default async function Reports() {
  await requireAdmin();
  const cur = currentMonth();
  const s = await getSettings();
  const months = (await availableMonths()).filter((m) => m < cur);
  const saved = new Map((await prisma.monthlyReport.findMany({ select: { month: true, generatedAt: true } })).map((r) => [r.month, r.generatedAt]));
  const summaries = new Map<string, string>();
  for (const m of [cur, ...months.slice(0, 3)]) summaries.set(m, (await getState(`report.summary.${m}`)) ?? "");
  const posts = await prisma.cliqOutbox.findMany({ where: { kind: "report" }, orderBy: { createdAt: "desc" }, take: 12 });
  const postedBy = new Map<string, (typeof posts)[number]>();
  for (const p of posts) if (p.month && !postedBy.has(p.month)) postedBy.set(p.month, p);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Monthly Deliverables Reports</h1>
      <p className="mt-1 text-sm text-ink-2 max-w-3xl">
        Built at 00:30 IST on the 1st for the month that just ended, and posted to Cliq at {s.reportPostHour}:00 IST with the PDF attached.
        The report follows the old Google Sheet: every planned deliverable is listed under its client with a status, owner and reason, followed by team scorecards, the slipped and blocked detail, unplanned work, old-task hygiene and a preview of next month.
      </p>

      <div className="mt-5 card p-4">
        <div className="font-medium">{monthLabel(cur)} <span className="text-xs text-ink-3">· in progress · report on 1 {monthLabel(addMonths(cur, 1))}</span></div>
        <form action={saveReportSummary} className="mt-2 space-y-2">
          <input type="hidden" name="month" value={cur} />
          <textarea name="summary" rows={3} defaultValue={summaries.get(cur)} placeholder="Manager summary for this month's report (optional, shown on page 1). Write it before the 1st." className="w-full" />
          <button className="btn">Save summary</button>
        </form>
      </div>

      <div className="mt-4 card divide-y divide-line">
        {months.map((m) => {
          const post = postedBy.get(m);
          return (
            <div key={m} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{monthLabel(m)}</div>
                  <div className="text-xs text-ink-3">
                    {saved.has(m) ? `Generated ${fmtDateTime(saved.get(m)!)}` : "Generated on first download"}
                    {post ? ` · Cliq: ${post.sentAt ? `posted ${fmtDateTime(post.sentAt)}` : `queued${post.error ? ` (${post.error})` : ""}`}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={regenerateReport}><input type="hidden" name="month" value={m} /><button className="btn" title="Rebuild with the latest reasons, reviews and summary">Rebuild</button></form>
                  <form action={postReportNow}><input type="hidden" name="month" value={m} /><button className="btn">Post to Cliq</button></form>
                  <a className="btn btn-primary" href={`/api/reports/${m}?view=1`} target="_blank" rel="noopener">View report<Icon name="external" size={14} /></a>
                  <a className="btn" href={`/api/reports/${m}`}>Download PDF</a>
                </div>
              </div>
              {summaries.has(m) && (
                <form action={saveReportSummary} className="mt-2 flex gap-2">
                  <input type="hidden" name="month" value={m} />
                  <input name="summary" defaultValue={summaries.get(m)} placeholder="Manager summary (page 1)" className="flex-1" />
                  <button className="btn">Save</button>
                </form>
              )}
            </div>
          );
        })}
        {!months.length && <div className="p-4 text-sm text-ink-3">No finished months yet.</div>}
      </div>
    </div>
  );
}
