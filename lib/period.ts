import { ALL, availableMonths } from "./metrics";
import { currentMonth, isValidMonth, monthLabel } from "./time";

export async function resolvePeriod(sp: Record<string, string | string[] | undefined>) {
  const raw = typeof sp.month === "string" ? sp.month : undefined;
  const month = raw === ALL ? ALL : isValidMonth(raw) ? raw : currentMonth();
  const months = await availableMonths();
  if (month !== ALL && !months.includes(month)) months.unshift(month);
  const options = [...months.map((m) => ({ value: m, label: monthLabel(m) + (m === currentMonth() ? " (current)" : "") })), { value: ALL, label: "All time" }];
  const label = month === ALL ? "All time" : monthLabel(month);
  return { month, options, label };
}
