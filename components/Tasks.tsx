import Link from "next/link";
import type { MonthTask } from "@/lib/metrics";
import { BUCKETS, BUCKET_COLOR, REASONS, reasonLabel } from "@/lib/status";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { ConfidencePill, StatusTag } from "./ui";
import { addComment, clearFlag } from "@/app/actions";

function DueLine({ m }: { m: MonthTask }) {
  const t = m.task;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-2">
      <span className="num">Due {fmtDate(t.dueDate)}</span>
      {m.overdueOpen && <span className="font-semibold text-crit">▲ {m.daysLate}d overdue</span>}
      {m.finishedLate && <span className="font-semibold text-crit">finished {m.daysLate}d late</span>}
      {m.carried && <span className="rounded bg-plane border border-line px-1">carried over</span>}
    </div>
  );
}

export function TaskCard({ m, href }: { m: MonthTask; href: string }) {
  const t = m.task;
  return (
    <Link href={href} scroll={false} className="block card p-3 hover:border-brand transition">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-mono text-ink-3">{t.key ?? "—"}</span>
        <ConfidencePill level={m.done ? "DONE" : t.confidence} title={t.confidenceReason} />
      </div>
      <div className="mt-1 text-sm font-medium leading-snug">{t.name}</div>
      <div className="mt-1 text-xs text-ink-2">{m.client}</div>
      <div className="mt-2">
        <DueLine m={m} />
      </div>
      {!m.done && t.completionPct > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 rounded-full bg-line">
            <div className="h-full rounded-full bg-brand" style={{ width: `${t.completionPct}%` }} />
          </div>
          <span className="text-[10px] text-ink-3 num">{t.completionPct}%</span>
        </div>
      )}
      {t.comments[0] && (
        <div className="mt-2 border-t border-line pt-2 text-[11px] text-ink-2 line-clamp-2">
          💬 <b>{reasonLabel(t.comments[0].reason)}</b>: {t.comments[0].text}
        </div>
      )}
    </Link>
  );
}

/** Read-only Kanban mirroring the Zoho board, grouped into the five status columns. */
export function Kanban({ items, hrefFor }: { items: MonthTask[]; hrefFor: (id: string) => string }) {
  return (
    <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${BUCKETS.length}, minmax(230px, 1fr))` }}>
      {BUCKETS.map((b) => {
        const col = items.filter((i) => i.state === b.key);
        return (
          <div key={b.key} className="rounded-xl bg-plane/80 border border-line p-2">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: BUCKET_COLOR[b.key] }} />
                {b.label}
              </span>
              <span className="text-xs text-ink-3 num">{col.length}</span>
            </div>
            <div className="space-y-2">
              {col.map((m) => (
                <TaskCard key={m.task.id} m={m} href={hrefFor(m.task.id)} />
              ))}
              {!col.length && <div className="px-1 py-4 text-center text-xs text-ink-3">Nothing here</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TaskList({ items, hrefFor, showAssignee }: { items: MonthTask[]; hrefFor: (id: string) => string; showAssignee?: boolean }) {
  return (
    <div className="card overflow-x-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            <th>Deliverable</th>
            <th>Client</th>
            {showAssignee && <th>Assignee</th>}
            <th>Status</th>
            <th>Confidence</th>
            <th>Zoho task</th>
            <th>Due date</th>
            <th>Reason / note</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => {
            const t = m.task;
            const c = t.comments[0];
            return (
              <tr key={t.id} className="hover:bg-plane/60">
                <td className="max-w-[280px]">
                  <Link href={hrefFor(t.id)} scroll={false} className="font-medium hover:text-brand">{t.name}</Link>
                  {m.carried && <div className="text-[11px] text-ink-3">carried over</div>}
                </td>
                <td className="whitespace-nowrap">{m.client}</td>
                {showAssignee && <td className="whitespace-nowrap">{t.assignees.map((a) => a.user.name).join(", ") || "—"}</td>}
                <td><StatusTag bucket={m.state} /></td>
                <td><ConfidencePill level={m.done ? "DONE" : t.confidence} title={t.confidenceReason} /></td>
                <td className="whitespace-nowrap">
                  {t.url ? (
                    <a href={t.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-brand hover:underline">{t.key ?? "Open"} ↗</a>
                  ) : (
                    <span className="font-mono text-xs">{t.key}</span>
                  )}
                </td>
                <td className="whitespace-nowrap num">
                  {fmtDate(t.dueDate)}
                  {m.overdueOpen && <div className="text-[11px] font-semibold text-crit">{m.daysLate}d overdue</div>}
                  {m.finishedLate && <div className="text-[11px] font-semibold text-crit">{m.daysLate}d late</div>}
                </td>
                <td className="max-w-[280px] text-xs text-ink-2">
                  {c ? <><b>{reasonLabel(c.reason)}</b>: {c.text}</> : <span className="text-ink-3">—</span>}
                </td>
              </tr>
            );
          })}
          {!items.length && (
            <tr>
              <td colSpan={8} className="text-center text-ink-3 py-8">No tasks in this period.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Task detail with the comment thread and the comment form. */
export function TaskDetail({ m, month, canComment, closeHref }: { m: MonthTask; month: string; canComment: boolean; closeHref?: string }) {
  const t = m.task;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-mono text-ink-3">{t.key} · {t.project.name}</div>
          <h3 className="text-lg font-semibold leading-snug mt-0.5">{t.name}</h3>
        </div>
        {closeHref && <Link href={closeHref} scroll={false} className="btn" aria-label="Close">✕</Link>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-2">Client</dt><dd>{m.client}</dd>
        <dt className="text-ink-2">Assignee</dt><dd>{t.assignees.map((a) => a.user.name).join(", ") || "—"}</dd>
        <dt className="text-ink-2">Status (Zoho)</dt><dd>{t.zohoStatus}</dd>
        <dt className="text-ink-2">Confidence</dt>
        <dd className="space-y-1"><ConfidencePill level={m.done ? "DONE" : t.confidence} /><div className="text-xs text-ink-2">{t.confidenceReason}</div></dd>
        <dt className="text-ink-2">Start → Due</dt><dd className="num">{fmtDate(t.startDate)} → {fmtDate(t.dueDate)}</dd>
        <dt className="text-ink-2">Completed</dt><dd className="num">{t.completedAt ? fmtDate(t.completedAt) : `${t.completionPct}% done`}</dd>
        <dt className="text-ink-2">Logged hours</dt><dd className="num">{t.loggedHours || "—"}</dd>
        <dt className="text-ink-2">Owner</dt><dd>{t.project.ownerName ?? t.createdByName ?? "—"}</dd>
      </dl>
      {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="btn">Open in Zoho Projects ↗</a>}
      {t.description && (
        <div>
          <div className="label mb-1">Description</div>
          <p className="text-sm text-ink-2 whitespace-pre-wrap">{t.description}</p>
        </div>
      )}
      {t.flaggedAtRisk && !t.isClosed && (
        <form action={clearFlag} className="flex items-center justify-between rounded-lg bg-crit/10 px-3 py-2 text-sm">
          <input type="hidden" name="taskId" value={t.id} />
          <span>Flagged At Risk by the team.</span>
          {canComment && <button className="btn">Remove flag</button>}
        </form>
      )}

      <div>
        <div className="label mb-2">Comments ({t.comments.length})</div>
        <div className="space-y-2">
          {t.comments.map((c) => (
            <div key={c.id} className="rounded-lg border border-line bg-field p-2.5 text-sm">
              <div className="flex justify-between text-[11px] text-ink-3">
                <span><b className="text-ink-2">{c.author.name}</b> · {reasonLabel(c.reason)}</span>
                <span>{fmtDateTime(c.createdAt)}</span>
              </div>
              <div className="mt-1 whitespace-pre-wrap">{c.text}</div>
            </div>
          ))}
          {!t.comments.length && <div className="text-sm text-ink-3">No comments yet.</div>}
        </div>
      </div>

      {canComment && (
        <form action={addComment} className="space-y-2 rounded-lg border border-line bg-plane/60 p-3">
          <input type="hidden" name="taskId" value={t.id} />
          <input type="hidden" name="month" value={month} />
          <div className="label">Add a comment</div>
          <select name="reason" required defaultValue="" className="w-full">
            <option value="" disabled>Reason category…</option>
            {REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <textarea name="text" required minLength={2} rows={3} placeholder="Why is this pending / what's the plan?" className="w-full" />
          {!t.isClosed && (
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <input type="checkbox" name="flag" className="h-3.5 w-3.5" /> Flag this task At Risk now (posts to Cliq)
            </label>
          )}
          <button className="btn btn-primary">Save comment</button>
        </form>
      )}
    </div>
  );
}
