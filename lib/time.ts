// Month and day helpers, all in India Standard Time (UTC+05:30, no DST).

export const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY = 86_400_000;

/** "YYYY-MM" for a date as seen in IST */
export function monthKey(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(now = new Date()): string {
  return monthKey(now);
}

/** Start (inclusive) and end (exclusive) of an IST month, as UTC instants */
export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS);
  return { start, end };
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string, short = false): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-IN", {
    month: short ? "short" : "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** End of the IST calendar day containing d (a due date means "by end of that day") */
export function endOfIstDay(d: Date): Date {
  const ist = d.getTime() + IST_OFFSET_MS;
  const dayStart = Math.floor(ist / DAY) * DAY;
  return new Date(dayStart + DAY - 1 - IST_OFFSET_MS);
}

export function startOfIstDay(d: Date): Date {
  const ist = d.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(ist / DAY) * DAY - IST_OFFSET_MS);
}

/** Whole IST calendar days from a to b (b later → positive) */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfIstDay(b).getTime() - startOfIstDay(a).getTime()) / DAY);
}

export function fmtDate(d?: Date | null): string {
  if (!d) return "—";
  return new Date(d.getTime()).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export function fmtDateTime(d?: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}

export function isValidMonth(m?: string | null): m is string {
  return !!m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

export { DAY };
