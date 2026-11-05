import Link from "next/link";
import type { Confidence, StatusBucket } from "@prisma/client";
import { CONFIDENCE_META, BUCKET_COLOR, bucketLabel } from "@/lib/status";

export function ConfidencePill({ level, title }: { level: Confidence; title?: string | null }) {
  const m = CONFIDENCE_META[level];
  return (
    <span
      title={title ?? undefined}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={{ background: m.color, color: m.text }}
    >
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  );
}

export function StatusTag({ bucket }: { bucket: StatusBucket }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2 whitespace-nowrap">
      <span className="h-2 w-2 rounded-full" style={{ background: BUCKET_COLOR[bucket] }} aria-hidden />
      {bucketLabel(bucket)}
    </span>
  );
}

export function ClientTypeBadge({ type }: { type: "CLIENT" | "INTERNAL" }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${type === "INTERNAL" ? "bg-plane text-ink-2 border border-line" : "bg-brand-soft text-brand-dark"}`}>
      {type === "INTERNAL" ? "Internal" : "Client"}
    </span>
  );
}

/** Stock-ticker style KPI tile: big %, a count line, and the move vs last month. */
export function Kpi({
  label,
  value,
  sub,
  delta,
  goodWhenUp = true,
  unit = "pts",
  vs = "vs last month",
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  goodWhenUp?: boolean;
  unit?: string;
  vs?: string;
}) {
  let deltaEl = <span className="text-ink-3">no comparison</span>;
  if (delta !== undefined && delta !== null) {
    const d = Math.round(delta * 10) / 10;
    if (Math.abs(d) < 0.1) deltaEl = <span className="text-ink-3">— flat {vs}</span>;
    else {
      const good = d > 0 === goodWhenUp;
      deltaEl = (
        <span className={good ? "text-goodText" : "text-crit"}>
          {d > 0 ? "▲" : "▼"} {Math.abs(d)} {unit} <span className="text-ink-3">{vs}</span>
        </span>
      );
    }
  }
  return (
    <div className="card p-4 min-w-0">
      <div className="label">{label}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-2 num">{sub}</div>}
      <div className="mt-2 text-xs font-medium num">{deltaEl}</div>
    </div>
  );
}

export function Bar({ value, color = "#2a78d6" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-line overflow-hidden" role="img" aria-label={`${value}%`}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3 mt-8">
      <h2 className="text-base font-semibold">{children}</h2>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card p-8 text-center text-sm text-ink-2">{children}</div>;
}

export const pctText = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}%`);

export function NavLink({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-brand-soft text-brand-dark" : "text-ink-2 hover:bg-plane"}`}>
      {children}
    </Link>
  );
}
