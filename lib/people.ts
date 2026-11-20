// Who a task is for. A task shows for everyone on it (Owner and "Assigned To"), but when
// someone else is in "Assigned To", the Owner has delegated it: it is the assignee's work,
// and it doesn't count in the Owner's own numbers.
type A = { userId: string; role: "OWNER" | "ASSIGNED" | "BOTH"; user: { name: string } };
type T = { assignees: A[] };

/** The people doing the task: the "Assigned To" people, or the Owner(s) when nobody is assigned. */
export function doers<X extends { role: A["role"] }>(t: { assignees: X[] }): X[] {
  const assigned = t.assignees.filter((a) => a.role !== "OWNER");
  return assigned.length ? assigned : t.assignees;
}
export const isDoer = (t: T, userId: string) => doers(t).some((a) => a.userId === userId);
export const isOn = (t: T, userId: string) => t.assignees.some((a) => a.userId === userId);

/** If this person only owns the task and someone else is doing it, the doers' names. */
export function delegatedTo(t: T, userId: string): string | null {
  if (!isOn(t, userId) || isDoer(t, userId)) return null;
  return doers(t).map((a) => a.user.name).join(", ");
}

/** "Zayhan Ahmed (owner: Shahul)" — doers first, owners named when they differ. */
export function peopleLabel(t: T): string {
  const d = doers(t);
  if (!d.length) return "—";
  const owners = t.assignees.filter((a) => a.role === "OWNER" && !d.includes(a));
  const names = d.map((a) => a.user.name).join(", ");
  return owners.length ? `${names} (owner: ${owners.map((a) => a.user.name).join(", ")})` : names;
}
