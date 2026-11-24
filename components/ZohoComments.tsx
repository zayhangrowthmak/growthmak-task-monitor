// What lives on the Zoho task (comments, documents, subtasks, activity log), shown read-only inside
// the dashboard. Each panel loads only when a task is opened, is cached for a few minutes, and never
// blocks the rest of the panel. Comments come from the local cache the Task updates feed keeps fresh.
import { prisma } from "@/lib/db";
import { refreshComments } from "@/lib/updates";
import { listAttachments, listSubtasks, listActivities } from "@/lib/zoho/write";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { Icon } from "./Icon";

const TTL = 5 * 60_000;
const cache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v as T | null;
  const v = await load().catch((e) => {
    console.error("[zoho panel]", key, String(e?.message ?? e).slice(0, 200));
    return null;
  });
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return v;
}

const Unavailable = ({ what }: { what: string }) => <p className="text-xs text-ink-3">Couldn&apos;t load {what} from Zoho right now. Open the task in Zoho to see them.</p>;

export function Bubble({ author, at, text, mine }: { author: string; at: Date | null; text: string; mine?: boolean }) {
  return (
    <div className={`rounded-lg border p-2.5 text-sm ${mine ? "border-brand/40 bg-brand-soft/40" : "border-line bg-field"}`}>
      <div className="flex justify-between gap-3 text-[11px] text-ink-3">
        <b className="text-ink-2">{author}</b>
        <span className="num shrink-0">{at ? fmtDateTime(at) : ""}</span>
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words">{text}</div>
    </div>
  );
}

/** Comments on the Zoho task. Re-reads Zoho when the cached copy is older than 5 minutes. */
export async function ZohoComments({ taskId, limit = 20 }: { projectId?: string; taskId: string; limit?: number }) {
  const t = await prisma.task.findUnique({ where: { id: taskId }, select: { commentsCheckedAt: true } });
  let failed = false;
  if (!t?.commentsCheckedAt || Date.now() - t.commentsCheckedAt.getTime() > TTL) {
    await refreshComments(taskId).catch(() => (failed = true));
  }
  const items = await prisma.zohoComment.findMany({ where: { taskId }, orderBy: { at: "desc" }, take: limit });
  if (!items.length) return failed ? <Unavailable what="comments" /> : <p className="text-sm text-ink-3">No comments in Zoho yet.</p>;
  return (
    <div className="space-y-2">
      {items.map((c) => <Bubble key={c.id} author={c.author} at={c.at} text={c.text} mine={c.fromDashboard} />)}
    </div>
  );
}

function size(s: string | null) {
  const n = Number(s);
  if (!s || !isFinite(n) || n <= 0) return s ?? "";
  return n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export async function ZohoDocuments({ projectId, taskId, zohoUrl }: { projectId: string; taskId: string; zohoUrl?: string | null }) {
  const items = await cached(`docs:${taskId}`, () => listAttachments(projectId, taskId));
  if (items === null) return <Unavailable what="documents" />;
  if (!items.length) return <p className="text-sm text-ink-3">No documents attached.</p>;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-field">
      {items.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
          <Icon name="file" size={16} className="shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <a href={d.url ?? zohoUrl ?? "#"} target="_blank" rel="noreferrer" className="block truncate font-medium hover:text-brand" title={d.name}>{d.name}</a>
            <div className="text-[11px] text-ink-3">{[size(d.size), d.by, d.at ? fmtDate(d.at) : null].filter(Boolean).join(" · ")}</div>
          </div>
          <Icon name="external" size={13} className="shrink-0 text-ink-3" />
        </li>
      ))}
    </ul>
  );
}

export async function ZohoSubtasks({ projectId, taskId }: { projectId: string; taskId: string }) {
  const items = await cached(`subs:${taskId}`, () => listSubtasks(projectId, taskId));
  if (items === null) return <Unavailable what="subtasks" />;
  if (!items.length) return <p className="text-sm text-ink-3">No subtasks.</p>;
  const done = items.filter((s) => s.closed).length;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-ink-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-good grow" style={{ width: `${(done / items.length) * 100}%` }} /></div>
        <span className="num">{done}/{items.length} done</span>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-field">
        {items.map((s) => (
          <li key={s.id} className="flex items-start gap-2.5 px-3 py-2 text-sm">
            <Icon name={s.closed ? "check" : "dot"} size={15} className={`mt-0.5 shrink-0 ${s.closed ? "text-goodText" : "text-ink-3"}`} />
            <div className="min-w-0 flex-1">
              <div className={s.closed ? "text-ink-3 line-through" : "font-medium"}>{s.name}</div>
              <div className="text-[11px] text-ink-3">{[s.key, s.status, s.owners || null, s.due ? `due ${fmtDate(s.due)}` : null].filter(Boolean).join(" · ")}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Zoho's activity log merged with the status and due-date changes the dashboard recorded. */
export async function ZohoActivity({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [zoho, statuses, dues] = await Promise.all([
    cached(`act:${taskId}`, () => listActivities(projectId, taskId)),
    prisma.statusChange.findMany({ where: { taskId }, orderBy: { at: "desc" }, take: 30 }),
    prisma.dueDateChange.findMany({ where: { taskId }, orderBy: { changedAt: "desc" }, take: 30 }),
  ]);
  type Ev = { key: string; at: Date | null; text: string; by: string | null; icon: "move" | "calendar" | "history" };
  const evs: Ev[] = [
    ...(zoho ?? []).map((a) => ({ key: `z${a.id}`, at: a.at, text: a.text, by: a.by, icon: "history" as const })),
    ...(zoho?.length ? [] : statuses.map((s) => ({ key: `s${s.id}`, at: s.at, text: `Status: ${s.fromName ?? "—"} → ${s.toName}`, by: null, icon: "move" as const }))),
    ...(zoho?.length ? [] : dues.map((c) => ({ key: `d${c.id}`, at: c.changedAt, text: `Due date: ${fmtDate(c.oldDate)} → ${fmtDate(c.newDate)}`, by: c.changedBy, icon: "calendar" as const }))),
  ].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  if (!evs.length) return zoho === null ? <Unavailable what="the activity log" /> : <p className="text-sm text-ink-3">No activity recorded yet.</p>;
  return (
    <div>
      {zoho === null && <p className="mb-2 text-[11px] text-ink-3">Zoho&apos;s log is unavailable right now; showing the changes the dashboard recorded.</p>}
      <ol className="relative space-y-3 border-l border-line pl-4">
        {evs.slice(0, 40).map((e) => (
          <li key={e.key} className="relative text-sm">
            <span className="absolute -left-[23px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-line bg-surface"><span className="h-1.5 w-1.5 rounded-full bg-brand" /></span>
            <div className="break-words">{e.text}</div>
            <div className="num text-[11px] text-ink-3">{[e.by, e.at ? fmtDateTime(e.at) : null].filter(Boolean).join(" · ")}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
