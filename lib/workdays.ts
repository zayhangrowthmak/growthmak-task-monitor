// Working-day arithmetic in IST. Working days come from Settings (default Mon–Fri).
import { DAY, IST_OFFSET_MS, endOfIstDay, monthRange, startOfIstDay } from "./time";

const istDow = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).getUTCDay();

export function isWorkingDay(d: Date, workingDays: number[]): boolean {
  return workingDays.includes(istDow(d));
}

/** End (23:59:59 IST) of the nth working day of the month. */
export function nthWorkingDayEnd(month: string, n: number, workingDays: number[]): Date {
  const { start, end } = monthRange(month);
  let count = 0;
  for (let d = start; d < end; d = new Date(d.getTime() + DAY)) {
    if (isWorkingDay(d, workingDays) && ++count === n) return endOfIstDay(d);
  }
  return new Date(end.getTime() - 1);
}

/** Last working day of the month (IST midnight of that day). */
export function lastWorkingDay(month: string, workingDays: number[]): Date {
  const { start, end } = monthRange(month);
  for (let d = new Date(end.getTime() - DAY); d >= start; d = new Date(d.getTime() - DAY)) {
    if (isWorkingDay(d, workingDays)) return startOfIstDay(d);
  }
  return startOfIstDay(new Date(end.getTime() - DAY));
}

/** Working days from today (IST) until the due day: 0 = due today, 1 = next working day… negative = overdue. */
export function workingDaysUntil(now: Date, due: Date, workingDays: number[]): number {
  const a = startOfIstDay(now).getTime();
  const b = startOfIstDay(due).getTime();
  if (b === a) return 0;
  const sign = b > a ? 1 : -1;
  let n = 0;
  for (let t = a; sign > 0 ? t < b : t > b; t += sign * DAY) {
    const next = new Date(t + sign * DAY);
    if (isWorkingDay(next, workingDays)) n += sign;
  }
  return n;
}

/** IST hour (0–23) of a moment. */
export const istHour = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();

/** Next moment at or after `d` that is outside quiet hours. */
export function outsideQuietHours(d: Date, quietStart: number, quietEnd: number): Date {
  const h = istHour(d);
  const quiet = quietStart > quietEnd ? h >= quietStart || h < quietEnd : h >= quietStart && h < quietEnd;
  if (!quiet) return d;
  const dayStart = startOfIstDay(d).getTime();
  const target = h >= quietStart && quietStart > quietEnd ? dayStart + DAY + quietEnd * 3_600_000 : dayStart + quietEnd * 3_600_000;
  return new Date(target);
}

/** IST calendar weeks (Mon–Sun) that overlap a month, as [start, end) pairs. */
export function weeksOfMonth(month: string): { label: string; start: Date; end: Date }[] {
  const { start, end } = monthRange(month);
  const out: { label: string; start: Date; end: Date }[] = [];
  let s = start;
  while (s < end) {
    const dow = istDow(s); // 0 Sun
    const daysToNextMon = ((8 - dow) % 7) || 7;
    const e = new Date(Math.min(end.getTime(), startOfIstDay(s).getTime() + daysToNextMon * DAY));
    const a = new Date(s.getTime() + IST_OFFSET_MS).getUTCDate();
    const b = new Date(e.getTime() - 1 + IST_OFFSET_MS).getUTCDate();
    out.push({ label: a === b ? `${a}` : `${a}–${b}`, start: s, end: e });
    s = e;
  }
  return out;
}

/** End (23:59:59 IST) of the nth working day after today, capped at the month's end. */
export function workingDaysFromNowEnd(now: Date, n: number, month: string, workingDays: number[]): Date {
  const { end } = monthRange(month);
  let d = startOfIstDay(now);
  let count = isWorkingDay(d, workingDays) ? 1 : 0;
  while (count < n) {
    d = new Date(d.getTime() + DAY);
    if (d >= end) return new Date(end.getTime() - 1);
    if (isWorkingDay(d, workingDays)) count++;
  }
  return endOfIstDay(d);
}
