// Plain-language line for an audit-log entry ("kept GM-T418 for this month, due 30 Nov").
type D = Record<string, unknown> | null;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const date = (v: unknown) => {
  if (!v) return "";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? s(v) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};
const month = (v: unknown) => {
  const m = /^(\d{4})-(\d{2})$/.exec(s(v));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : s(v);
};

export function auditText(action: string, d: D): string {
  const x = d ?? {};
  const name = s(x.name) || s(x.summary) || s(x.title);
  switch (action) {
    case "plan.lock": return `locked the ${month(x.month)} plan (${s(x.planned)} planned)`;
    case "plan.promote": return `added "${name}" to the ${month(x.month)} plan`;
    case "plan.remove": return `removed "${name}" from the ${month(x.month)} plan${x.reason ? ` (${s(x.reason).toLowerCase().replace(/_/g, " ")})` : ""}${x.note ? `: ${s(x.note)}` : ""}`;
    case "plan.restore": return `restored a task to the ${month(x.month)} plan`;
    case "review.keep": return `kept an old task for ${month(x.month)}${x.newDueDate ? `, due ${date(x.newDueDate)}` : ""}${x.note ? ` — ${s(x.note)}` : ""}`;
    case "review.backlog": return `moved an old task to Backlog${x.note ? ` — ${s(x.note)}` : ""}`;
    case "review.close": return `closed an old task as not needed${x.note ? ` — ${s(x.note)}` : ""}`;
    case "review.undo": return `undid an old-task decision`;
    case "review.approve_keep": return `approved keeping a task another month`;
    case "review.remarks": return `saved a monthly review for ${month(x.month)}`;
    case "zoho.apply": return `approved and updated Zoho: ${name}`;
    case "zoho.apply_failed": return `tried to update Zoho but it failed: ${name}${x.error ? ` (${s(x.error)})` : ""}`;
    case "zoho.reject": return `rejected a Zoho change: ${name}`;
    case "task.confidence": return `set confidence to ${s(x.value)}/3`;
    case "task.slip_reason": return `gave a slip reason: ${s(x.reason).toLowerCase().replace(/_/g, " ")}${x.note ? ` — ${s(x.note)}` : ""}`;
    case "recurring.add": return `added recurring deliverable "${name}"`;
    case "recurring.on": return `turned on recurring deliverable "${name}"`;
    case "recurring.off": return `turned off recurring deliverable "${name}"`;
    case "cliq.mapping": return `set a Cliq address${x.cliqEmail ? ` to ${s(x.cliqEmail)}` : " back to the Zoho email"}`;
    case "settings.save": return `saved the planning & alert settings`;
    case "report.summary": return `edited the report summary`;
    default: return action.replace(/[._]/g, " ");
  }
}
