import Link from "next/link";

/** Open planned deliverables per person per week, green / amber / red by the Settings thresholds. */
export function WorkloadStrip({ weeks, rows, green, amber, month }: { weeks: { label: string }[]; rows: { userId: string; name: string; counts: number[] }[]; green: number; amber: number; month: string }) {
  const tone = (n: number) => (n === 0 ? "bg-plane text-ink-3" : n <= green ? "bg-good/15 text-goodText" : n <= amber ? "bg-warn/25 text-warnText" : "bg-crit/15 text-crit");
  const shown = rows.filter((r) => r.counts.some((c) => c > 0));
  return (
    <div className="card overflow-x-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            <th>Person</th>
            {weeks.map((w) => <th key={w.label} className="text-center">{w.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.userId}>
              <td><Link href={`/people/${r.userId}?month=${month}`} className="font-medium hover:text-brand">{r.name}</Link></td>
              {r.counts.map((c, i) => (
                <td key={i} className="text-center">
                  <span className={`inline-block min-w-8 rounded px-2 py-0.5 text-xs font-semibold num ${tone(c)}`} title={`${c} open planned deliverable${c === 1 ? "" : "s"} due this week`}>{c}</span>
                </td>
              ))}
            </tr>
          ))}
          {!shown.length && <tr><td colSpan={weeks.length + 1} className="text-center text-ink-3 py-6">No open planned work.</td></tr>}
        </tbody>
      </table>
      <div className="px-3 py-2 text-[11px] text-ink-3">Green ≤ {green} · amber {green + 1}–{amber} · red &gt; {amber} open planned deliverables due that week (thresholds in Settings).</div>
    </div>
  );
}
