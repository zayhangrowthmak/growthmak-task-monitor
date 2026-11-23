// Small, animated data figures shared across the dashboard. All server-rendered:
// the final value is in the HTML, and the motion is CSS that rests under reduced motion.
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** Status colours: fixed, never themed, always shown with a word and an icon. */
export const TONE = {
  good: { fill: "#0ca30c", text: "text-goodText", icon: "check" as IconName },
  warn: { fill: "#fab219", text: "text-warnText", icon: "diamond" as IconName },
  crit: { fill: "#d03b3b", text: "text-crit", icon: "alert" as IconName },
  none: { fill: "rgb(var(--ink-3))", text: "text-ink-3", icon: "minus" as IconName },
};
export type Tone = keyof typeof TONE;

/** Categorical slots 1–3 (blue, orange, aqua) for the parts of a split. */
export const PART = ["var(--c-series-1)", "var(--c-series-2)", "var(--c-series-3)"];

const css = (o: Record<string, string | number>) => o as CSSProperties;

/** A number that counts up from 0 on load. The real value stays in the text for screen readers and copy. */
export function CountUp({ value, suffix = "", className = "" }: { value: number; suffix?: string; className?: string }) {
  const n = Math.max(0, Math.round(value));
  return (
    <span className={`num ${className}`}>
      <span className="sr-only">{n}{suffix}</span>
      <span aria-hidden className="countup" style={css({ "--to": n, "--suffix": `"${suffix}"` })} />
    </span>
  );
}

/** A ratio against its whole: the fill carries the state, the track is a light step of the same colour. */
export function Meter({
  value,
  tone = "good",
  color,
  height = 8,
  delay = 0,
  marker,
  extra,
  label,
}: {
  value: number | null;
  tone?: Tone;
  color?: string;
  height?: number;
  delay?: number;
  marker?: { at: number; label: string };
  extra?: { value: number; label: string }; // a lighter run after the fill (e.g. "in review")
  label: string;
}) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const fill = color ?? TONE[tone].fill;
  const ex = extra ? Math.max(0, Math.min(100 - v, extra.value)) : 0;
  return (
    <div className="relative" role="img" aria-label={label}>
      <div className="relative overflow-hidden rounded-full" style={{ height, background: `color-mix(in srgb, ${fill} 16%, transparent)` }}>
        {ex > 0 && (
          <div className="grow absolute inset-y-0 rounded-full" style={css({ left: 0, width: `${v + ex}%`, background: `color-mix(in srgb, ${fill} 42%, transparent)`, "--d": `${delay + 120}ms` })} />
        )}
        {value !== null && v > 0 && <div className="grow absolute inset-y-0 left-0 rounded-full" style={css({ width: `${v}%`, background: fill, "--d": `${delay}ms` })} />}
      </div>
      {marker && (
        <div className="drop pointer-events-none absolute -top-1.5 -bottom-1.5" style={css({ left: `${Math.max(0, Math.min(100, marker.at))}%`, "--d": `${delay + 500}ms` })} aria-hidden>
          <div className="h-full w-0.5 -translate-x-1/2 rounded-full bg-ink" />
        </div>
      )}
    </div>
  );
}

/** One whole split into a few parts: thin bar, 2px gaps, a swatch list carries the names and figures. */
export function SplitBar({ parts, delay = 0, label }: { parts: { label: string; value: number; color?: string }[]; delay?: number; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div role="img" aria-label={label}>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full" style={{ background: total ? undefined : "rgb(var(--line))" }}>
        {total > 0 &&
          parts.filter((p) => p.value > 0).map((p, i) => (
            <div key={p.label} className="grow h-full first:rounded-l-full last:rounded-r-full" style={css({ flex: p.value, background: p.color ?? PART[i % 3], "--d": `${delay + i * 90}ms` })} />
          ))}
      </div>
    </div>
  );
}

/** Swatch + figure list under a SplitBar. Text stays in ink colours; the swatch carries identity. */
export function PartsLegend({ parts }: { parts: { label: string; value: number; color?: string }[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-2">
      {parts.map((p, i) => (
        <span key={p.label} className="inline-flex items-center gap-1.5 num">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? PART[i % 3] }} aria-hidden />
          {p.value} {p.label}
        </span>
      ))}
    </div>
  );
}

/** A status word with its icon: the colour never carries the meaning alone. */
export function ToneTag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold ${TONE[tone].text}`}>
      <Icon name={TONE[tone].icon} size={12} />
      {children}
    </span>
  );
}

/** Delivery is judged against how much of the month has passed. */
export function paceTone(completed: number, planned: number, elapsedFrac: number): { tone: Tone; diff: number; expected: number } {
  if (!planned) return { tone: "none", diff: 0, expected: 0 };
  const expected = Math.round(planned * elapsedFrac);
  const diff = completed - expected;
  const slack = Math.max(1, Math.round(planned * 0.1));
  return { tone: diff >= 0 ? "good" : diff >= -slack ? "warn" : "crit", diff, expected };
}
export const onTimeTone = (v: number | null): Tone => (v === null ? "none" : v >= 90 ? "good" : v >= 75 ? "warn" : "crit");
export const ratioTone = (v: number | null): Tone => (v === null ? "none" : v >= 80 ? "good" : v >= 50 ? "warn" : "crit");

/** The month at a glance: how much is delivered against how much of the month has gone. */
export function PaceBand({
  completed,
  planned,
  inReview,
  elapsed,
  live,
  who = "the team",
}: {
  completed: number;
  planned: number;
  inReview: number;
  elapsed: { done: number; total: number };
  live: boolean;
  who?: string;
}) {
  const frac = live ? elapsed.done / elapsed.total : 1;
  const pct = planned ? (completed / planned) * 100 : 0;
  const reviewPct = planned ? (inReview / planned) * 100 : 0;
  const p = paceTone(completed, planned, frac);
  const verdict = !planned
    ? "Nothing planned"
    : !live
      ? `${completed} of ${planned} delivered`
      : p.diff >= 0
        ? p.diff > 0 ? `${p.diff} ahead of pace` : "On pace"
        : `${-p.diff} behind pace`;
  return (
    <section aria-label="Month pace" className="card mt-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex items-center gap-4">
          <span className="chip hidden h-12 w-12 rounded-xl sm:inline-flex" aria-hidden><Icon name="target" size={24} /></span>
          <div className="flex items-baseline gap-3">
          <CountUp value={pct} suffix="%" className="text-5xl font-semibold tracking-tight" />
          <div className="text-sm leading-tight">
            <div className="font-medium">delivered</div>
            <div className="num text-ink-2">{completed} of {planned} planned</div>
          </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {live && <span className="num text-ink-2">Working day <b className="text-ink">{elapsed.done}</b> of {elapsed.total}</span>}
          {live && planned > 0 && <span className="num text-ink-2">By now: <b className="text-ink">{p.expected}</b> expected</span>}
          <ToneTag tone={p.tone}>{verdict}</ToneTag>
        </div>
      </div>
      <div className="mt-4">
        <Meter
          value={pct}
          tone={p.tone}
          height={14}
          extra={inReview ? { value: reviewPct, label: "in review" } : undefined}
          marker={live ? { at: frac * 100, label: "Today" } : undefined}
          label={`${Math.round(pct)}% of planned deliverables delivered${live ? `, ${Math.round(frac * 100)}% of the month's working days gone` : ""}`}
        />
        <div className="relative mt-2 h-4 text-[11px] text-ink-3">
          <span className="absolute left-0">0</span>
          {live && (
            <span className="drop absolute -translate-x-1/2 whitespace-nowrap font-semibold text-ink" style={css({ left: `${Math.min(92, Math.max(8, frac * 100))}%`, "--d": "500ms" })}>
              Today · {Math.round(frac * 100)}% of month
            </span>
          )}
          <span className="absolute right-0 num">{planned}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-full" style={{ background: TONE[p.tone].fill }} aria-hidden />Delivered</span>
          {inReview > 0 && <span className="inline-flex items-center gap-1.5 num"><span className="h-2 w-3 rounded-full" style={{ background: `color-mix(in srgb, ${TONE[p.tone].fill} 42%, transparent)` }} aria-hidden />{inReview} in review</span>}
          {live && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 rounded-full bg-ink" aria-hidden />Where {who} should be by today</span>}
        </div>
      </div>
    </section>
  );
}
