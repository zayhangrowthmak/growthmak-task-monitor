"use client";
import { useState } from "react";
import { BUCKETS, BUCKET_COLOR } from "@/lib/status";
import type { StatusBucket } from "@prisma/client";

type TrendPoint = { label: string; completedPct: number; onTimePct: number | null; total: number };

/** Completion % and On-time % over recent months (one 0–100% axis, two series, legend + end labels). */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 520, H = 200, L = 34, R = 56, T = 12, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const x = (i: number) => L + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => T + ih - (v / 100) * ih;
  const series = [
    { key: "completedPct" as const, name: "Completed", color: "var(--c-series-1)" },
    { key: "onTimePct" as const, name: "On time", color: "var(--c-series-2)" },
  ];
  const path = (k: "completedPct" | "onTimePct") =>
    data
      .map((d, i) => (d[k] === null ? null : `${x(i)},${y(d[k] as number)}`))
      .filter(Boolean)
      .map((p, i) => `${i ? "L" : "M"}${p}`)
      .join(" ");
  const last = data.length - 1;
  return (
    <div className="relative">
      <div className="flex gap-4 text-xs text-ink-2 mb-1">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Completion and on-time percentage by month">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--c-axis)" : "var(--c-grid)"} strokeWidth={1} />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--c-muted)">{v}%</text>
          </g>
        ))}
        {data.map((d, i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--c-muted)">{d.label}</text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ih} stroke="var(--c-axis)" strokeDasharray="3 3" />}
        {series.map((s) => (
          <g key={s.key}>
            <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {data.map((d, i) =>
              d[s.key] === null ? null : (
                <circle key={i} cx={x(i)} cy={y(d[s.key] as number)} r={hover === i ? 5 : 4} fill={s.color} stroke="var(--c-surface)" strokeWidth={2} />
              )
            )}
            {data[last]?.[s.key] !== null && data[last] && (
              <text x={x(last) + 9} y={y(data[last][s.key] as number) + 4} fontSize={11} fill="var(--c-label)" fontWeight={600}>
                {data[last][s.key]}%
              </text>
            )}
          </g>
        ))}
        {data.map((_, i) => (
          <rect
            key={i}
            x={x(i) - iw / Math.max(1, data.length - 1) / 2}
            y={T}
            width={iw / Math.max(1, data.length - 1)}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute top-6 rounded-lg border border-line bg-field px-3 py-2 text-xs shadow-sm"
          style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}
        >
          <div className="font-semibold mb-1">{data[hover].label}</div>
          <div>Completed: <b>{data[hover].completedPct}%</b></div>
          <div>On time: <b>{data[hover].onTimePct ?? "—"}{data[hover].onTimePct !== null ? "%" : ""}</b></div>
          <div className="text-ink-3">{data[hover].total} tasks</div>
        </div>
      )}
    </div>
  );
}

/** Status mix per client as 100% stacked horizontal bars. */
export function StatusMix({ rows }: { rows: { name: string; buckets: Record<StatusBucket, number>; total: number }[] }) {
  const [tip, setTip] = useState<{ row: string; b: StatusBucket; n: number; total: number } | null>(null);
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2 mb-3">
        {BUCKETS.map((b) => (
          <span key={b.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: BUCKET_COLOR[b.key] }} />
            {b.label}
          </span>
        ))}
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.name} className="grid grid-cols-[120px_1fr_36px] items-center gap-2 text-xs">
            <div className="truncate text-ink-2" title={r.name}>{r.name}</div>
            <div className="flex h-3.5 gap-[2px]">
              {BUCKETS.filter((b) => r.buckets[b.key] > 0).map((b, i, arr) => (
                <div
                  key={b.key}
                  className={`h-full ${i === 0 ? "rounded-l" : ""} ${i === arr.length - 1 ? "rounded-r" : ""}`}
                  style={{ width: `${(r.buckets[b.key] / r.total) * 100}%`, background: BUCKET_COLOR[b.key] }}
                  onMouseEnter={() => setTip({ row: r.name, b: b.key, n: r.buckets[b.key], total: r.total })}
                  onMouseLeave={() => setTip(null)}
                />
              ))}
            </div>
            <div className="text-right text-ink-3 num">{r.total}</div>
          </div>
        ))}
      </div>
      <div className="h-5 mt-2 text-xs text-ink-2">
        {tip && (
          <span>
            <b>{tip.row}</b> · {BUCKETS.find((b) => b.key === tip.b)?.label}: {tip.n} of {tip.total} ({Math.round((tip.n / tip.total) * 100)}%)
          </span>
        )}
      </div>
    </div>
  );
}

/** Pending reasons, one hue, sorted. */
export function ReasonBars({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((a, r) => a + r.count, 0);
  if (!rows.length) return <div className="text-sm text-ink-3 py-6 text-center">No reasons recorded for this period yet.</div>;
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="text-xs" title={`${r.label}: ${r.count} tasks (${Math.round((r.count / total) * 100)}%)`}>
          <div className="flex justify-between mb-1">
            <span className="text-ink-2">{r.label}</span>
            <span className="num text-ink-2">{r.count} · {Math.round((r.count / total) * 100)}%</span>
          </div>
          <div className="h-2.5 rounded bg-line/60">
            <div className="h-full rounded" style={{ width: `${(r.count / max) * 100}%`, background: "var(--c-series-1)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
