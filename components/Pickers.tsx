"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Timeline dropdown: pick a month (or All time). Keeps the rest of the query string. */
export function MonthPicker({ months, value }: { months: { value: string; label: string }[]; value: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-ink-2">Timeline</span>
      <select
        value={value}
        onChange={(e) => {
          const q = new URLSearchParams(sp.toString());
          q.set("month", e.target.value);
          q.delete("task");
          router.push(`${path}?${q.toString()}`);
        }}
        className="font-medium"
      >
        {months.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Admin-only person switcher on the individual dashboard. */
export function PersonPicker({ people, value, month }: { people: { id: string; name: string }[]; value: string; month: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-ink-2">Person</span>
      <select value={value} onChange={(e) => router.push(`/people/${e.target.value}?month=${month}`)} className="font-medium">
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
