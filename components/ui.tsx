import type { Pct } from "@/lib/metrics";
import { STATE_META, USER_CONFIDENCE, type TaskState } from "@/lib/status";
import { Icon, STATE_ICON } from "./Icon";
import { CountUp } from "./Viz";
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
      <Icon name={({ AT_RISK: "alert", TIGHT: "diamond", ON_TRACK: "dot", DONE: "check" } as const)[level as "AT_RISK"] ?? "dot"} size={11} />
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
  small = false,
  title,
  viz,
  icon,
  tone = "brand",
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  goodWhenUp?: boolean;
  unit?: string;
  vs?: string;
  small?: boolean; // below 5 tasks: grey the value and say so
  title?: string;
  viz?: React.ReactNode; // a meter or split bar under the figure
  icon?: import("./Icon").IconName;
  tone?: "brand" | "teal" | "warn" | "crit";
}) {
  let deltaEl = <span className="text-ink-3">no comparison</span>;
  if (delta !== undefined && delta !== null) {
    const d = Math.round(delta * 10) / 10;
    if (Math.abs(d) < 0.1) deltaEl = <span className="text-ink-3">— flat {vs}</span>;
    else {
      const good = d > 0 === goodWhenUp;
      deltaEl = (
        <span className={good ? "text-goodText" : "text-crit"}>
          <Icon name={d > 0 ? "up" : "down"} size={13} className="inline -mt-0.5" /> {Math.abs(d)} {unit} <span className="text-ink-3">{vs}</span>
        </span>
      );
    }
  }
  return (
    <div className="card p-4 min-w-0" title={title}>
      <div className="flex items-center justify-between gap-2">
        <div className="label">{label}</div>
        {icon && <span className={`chip ${tone === "brand" ? "" : `chip-${tone}`}`} aria-hidden><Icon name={icon} size={15} /></span>}
      </div>
      <div className={`mt-1 text-3xl font-semibold tracking-tight ${small ? "text-ink-3" : ""}`}>{figure(value)}</div>
      {small && <div className="text-[11px] text-ink-3">small sample</div>}
      {sub && <div className="mt-0.5 text-xs text-ink-2 num">{sub}</div>}
      {viz && <div className="mt-3">{viz}</div>}
      <div className="mt-2 text-xs font-medium num">{deltaEl}</div>
    </div>
  );
}

/** "16%", "11" or "7% / 50%": each whole number counts up; anything else prints as is. */
function figure(value: string) {
  const parts = value.split(/(\d+%?)/);
  if (parts.length === 1) return value;
  return parts.map((p, i) => {
    const m = /^(\d+)(%?)$/.exec(p);
    return m ? <CountUp key={i} value={Number(m[1])} suffix={m[2]} /> : <span key={i}>{p}</span>;
  });
}

export function Bar({ value, color = "rgb(var(--brand))", delay = 0 }: { value: number; color?: string; delay?: number }) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }} role="img" aria-label={`${Math.round(v)}%`}>
      {v > 0 && <div className="grow h-full rounded-full" style={{ width: `${v}%`, background: color, ["--d" as string]: `${delay}ms` }} />}
    </div>
  );
}

export function SectionTitle({ children, right, icon }: { children: React.ReactNode; right?: React.ReactNode; icon?: import("./Icon").IconName }) {
  return (
    <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
      <h2 className="flex items-center gap-2.5 text-base font-semibold">
        {icon && <span className="chip" aria-hidden><Icon name={icon} size={15} /></span>}
        {children}
      </h2>
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



/** "62% (18/29)". Greyed with a hint below 5 tasks. Never a bare percentage. */
export function PctText({ p, className = "" }: { p: Pct; className?: string }) {
  if (p.value === null) return <span className={`text-ink-3 ${className}`}>—</span>;
  return (
    <span className={`num ${p.small ? "text-ink-3" : ""} ${className}`} title={p.small ? "Small sample (fewer than 5 tasks)" : undefined}>
      {p.value}% <span className="text-ink-3">({p.n}/{p.d})</span>
    </span>
  );
}
export const pctBig = (p: Pct) => (p.value === null ? "—" : `${Math.round(p.value)}%`);
export const pctSub = (p: Pct) => `${p.n} of ${p.d}`;

export function StatePill({ state, title }: { state: TaskState; title?: string }) {
  const m = STATE_META[state];
  return (
    <span title={title} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ background: m.color, color: m.text }}>
      <Icon name={STATE_ICON[state]} size={11} />
      {m.label}
    </span>
  );
}

export function ConfPill({ value }: { value: number | null | undefined }) {
  if (!value) return <span className="text-[11px] text-ink-3 whitespace-nowrap">conf. not set</span>;
  const m = USER_CONFIDENCE[value];
  return (
    <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap" style={{ background: m.color, color: m.text }} title="Confidence set by the assignee">
      Conf. {m.label}
    </span>
  );
}


/** Card header: an icon badge, the title, and an optional note on the right. */
export function CardTitle({ icon, children, note, tone = "brand" }: { icon: import("./Icon").IconName; children: React.ReactNode; note?: React.ReactNode; tone?: "brand" | "teal" | "warn" | "crit" }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <div className="flex items-center gap-2.5">
        <span className={`chip ${tone === "brand" ? "" : `chip-${tone}`}`} aria-hidden><Icon name={icon} size={15} /></span>
        <h2 className="text-sm font-semibold">{children}</h2>
      </div>
      {note && <span className="text-xs text-ink-3">{note}</span>}
    </div>
  );
}
