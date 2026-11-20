import Link from "next/link";
import type { Row } from "@/lib/metrics";
import { BUCKETS, BUCKET_COLOR, REASONS, SLIP_REASONS, reasonLabel, slipLabel, bucketLabel } from "@/lib/status";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { StatePill, ConfPill } from "./ui";
import { addComment, setConfidence, setSlipReason } from "@/app/actions";
import { peopleLabel } from "@/lib/people";
import { Icon } from "./Icon";

const sourceLabel: Record<string, string> = { DUE_DATE: "Planned", RECURRING: "Recurring", KEPT: "Kept from earlier", PROMOTED: "Promoted", UNPLANNED: "Unplanned", VIRTUAL: "Due this month" };

function DueLine({ r }: { r: Row }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-2">
      <span className="num">Planned {fmtDate(r.plannedDue)}</span>
      {r.dueChanged && <span className="num text-warnText">now {fmtDate(r.task.dueDate)}</span>}
      {r.slip === "OPEN" && <span className="inline-flex items-center gap-1 font-semibold text-crit"><Icon name="alert" size={12} />{r.daysLate}d overdue</span>}
      {r.slip === "LATE" && <span className="font-semibold text-crit">done {r.daysLate}d late</span>}
    </div>
  );
}

export function TaskCard({ r, href }: { r: Row; href: string }) {
  const t = r.task;
  return (
    <Link href={href} scroll={false} className={`block card p-3 hover:border-brand transition ${r.delegatedTo ? "border-dashed opacity-75" : ""}`}>
      {r.delegatedTo && (
        <div className="mb-2 -mx-3 -mt-3 rounded-t-[inherit] border-b border-dashed border-line bg-plane px-3 py-1 text-[11px] font-medium text-ink-2" title="You own this task in Zoho; it's assigned to someone else and doesn't count in your numbers">
          Assigned to <span className="text-ink">{r.delegatedTo}</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-mono text-ink-3">{t.key ?? "—"}</span>
        <StatePill state={r.state} />
      </div>
      <div className="mt-1 text-sm font-medium leading-snug">{t.name}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span>{r.client}</span>
        {r.source !== "DUE_DATE" && r.source !== "VIRTUAL" && <span className="rounded border border-line px-1 text-[10px]">{sourceLabel[r.source]}</span>}
      </div>
      <div className="mt-2">
        <DueLine r={r} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <ConfPill value={t.userConfidence} />
        {!r.done && t.completionPct > 0 && <span className="text-[10px] text-ink-3 num">{t.completionPct}% done</span>}
      </div>
      {t.slipReason && (
        <div className="mt-2 border-t border-line pt-2 text-[11px] text-ink-2 line-clamp-2">
          ↳ <b>{slipLabel(t.slipReason)}</b>
          {t.slipNote ? `: ${t.slipNote}` : ""}
        </div>
      )}
    </Link>
  );
}

/** Read-only Kanban mirroring the Zoho board (Backlog / Closed live in their own tabs). */
export function Kanban({ rows, hrefFor }: { rows: Row[]; hrefFor: (id: string) => string }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {BUCKETS.map((b) => {
        const col = rows.filter((r) => (r.done ? "COMPLETED" : r.task.bucket === "COMPLETED" ? "IN_PROGRESS" : r.task.bucket) === b.key);
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
              {col.map((r) => (
                <TaskCard key={r.task.id} r={r} href={hrefFor(r.task.id)} />
              ))}
              {!col.length && <div className="px-1 py-4 text-center text-xs text-ink-3">Nothing here</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TaskList({ rows, hrefFor, showAssignee }: { rows: Row[]; hrefFor: (id: string) => string; showAssignee?: boolean }) {
  return (
    <div className="card overflow-x-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            <th>Deliverable</th>
            <th>Client</th>
            {showAssignee && <th>Owner</th>}
            <th>State</th>
            <th>Conf.</th>
            <th>Zoho task</th>
            <th>Planned due</th>
            <th>Done on</th>
            <th>Reason / note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = r.task;
            return (
              <tr key={t.id} className="hover:bg-plane/60">
                <td className="max-w-[280px]">
                  <Link href={hrefFor(t.id)} scroll={false} className="font-medium hover:text-brand">{t.name}</Link>
                  {r.source !== "DUE_DATE" && r.source !== "VIRTUAL" && <div className="text-[11px] text-ink-3">{sourceLabel[r.source]}</div>}
                  {r.delegatedTo && <div className="text-[11px] font-medium text-ink-2">Assigned to {r.delegatedTo}</div>}
                </td>
                <td className="whitespace-nowrap">{r.client}</td>
                {showAssignee && <td className="whitespace-nowrap">{peopleLabel(t)}</td>}
                <td><StatePill state={r.state} /></td>
                <td className="num">{t.userConfidence ?? "—"}</td>
                <td className="whitespace-nowrap">
                  {t.url ? <a href={t.url} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-1 whitespace-nowrap text-xs text-brand hover:underline">{t.key ?? "Open"}<Icon name="external" size={12} /></a> : <span className="font-mono text-xs">{t.key}</span>}
                </td>
                <td className="whitespace-nowrap num">
                  {fmtDate(r.plannedDue)}
                  {r.dueChanged && <div className="text-[11px] text-warnText">now {fmtDate(t.dueDate)}</div>}
                </td>
                <td className="whitespace-nowrap num">{r.doneAt ? fmtDate(r.doneAt) : r.done ? "done" : "—"}</td>
                <td className="max-w-[260px] text-xs text-ink-2">{t.slipReason ? <><b>{slipLabel(t.slipReason)}</b>{t.slipNote ? `: ${t.slipNote}` : ""}</> : t.comments[0] ? t.comments[0].text : <span className="text-ink-3">—</span>}</td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={9} className="text-center text-ink-3 py-8">Nothing here.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Confidence (1–3) for the assignee. */
export function ConfidenceForm({ taskId, value }: { taskId: string; value: number | null }) {
  return (
    <form action={setConfidence} className="flex items-center gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <select name="confidence" defaultValue={value ?? ""} aria-label="Confidence">
        <option value="">Not set</option>
        <option value="3">3 · On Track</option>
        <option value="2">2 · Watch</option>
        <option value="1">1 · At Risk</option>
      </select>
      <button className="btn">Save</button>
    </form>
  );
}

export function SlipReasonForm({ r }: { r: Row }) {
  return (
    <form action={setSlipReason} className="space-y-2">
      <input type="hidden" name="taskId" value={r.task.id} />
      <select name="reason" required defaultValue={r.task.slipReason ?? ""} className="w-full">
        <option value="" disabled>Why did it slip?</option>
        {SLIP_REASONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
      </select>
      <input name="note" defaultValue={r.task.slipNote ?? ""} placeholder="Note (required for Other)" className="w-full" maxLength={1000} />
      <button className="btn btn-primary">Save reason</button>
    </form>
  );
}

/** Task detail: plan info, confidence, slip reason, due-date history, comments. */
export function TaskDetail({ r, month, canEdit, closeHref, dueChanges }: { r: Row; month: string; canEdit: boolean; closeHref?: string; dueChanges?: { oldDate: Date | null; newDate: Date | null; changedAt: Date; changedBy: string | null }[] }) {
  const t = r.task;
  const needsReason = canEdit && (r.slip || r.waitingClient || r.blockedInternal) && !r.done;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-mono text-ink-3">{t.key} · {t.project.name}</div>
          <h3 className="text-lg font-semibold leading-snug mt-0.5">{t.name}</h3>
        </div>
        {closeHref && <Link href={closeHref} scroll={false} className="btn btn-icon" aria-label="Close"><Icon name="x" /></Link>}
      </div>
      <div className="flex flex-wrap gap-2"><StatePill state={r.state} /><ConfPill value={t.userConfidence} /></div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-2">Client</dt><dd>{r.client}</dd>
        <dt className="text-ink-2">Assigned to</dt><dd>{t.assignees.filter((a) => a.role !== "OWNER").map((a) => a.user.name).join(", ") || "—"}</dd>
        <dt className="text-ink-2">Owner (Zoho)</dt><dd>{t.assignees.filter((a) => a.role !== "ASSIGNED").map((a) => a.user.name).join(", ") || "—"}</dd>
        {r.delegatedTo && <><dt className="text-ink-2">Note</dt><dd className="text-warnText">Assigned to someone else — not counted in the owner&apos;s numbers</dd></>}
        <dt className="text-ink-2">Status (Zoho)</dt><dd>{t.zohoStatus} <span className="text-ink-3">· {bucketLabel(t.bucket)}</span></dd>
        <dt className="text-ink-2">In plan as</dt><dd>{sourceLabel[r.source]}</dd>
        <dt className="text-ink-2">Planned due</dt><dd className="num">{fmtDate(r.plannedDue)}</dd>
        <dt className="text-ink-2">Current due</dt><dd className="num">{fmtDate(t.dueDate)}{r.dueChanged && <span className="text-warnText"> (changed)</span>}</dd>
        <dt className="text-ink-2">Done on</dt><dd className="num">{r.doneAt ? fmtDate(r.doneAt) : r.done ? "done (time unknown)" : `${t.completionPct}% done`}</dd>
      </dl>
      {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="btn">Open in Zoho Projects<Icon name="external" size={14} /></a>}

      {canEdit && !r.done && (
        <div className="rounded-lg border border-line bg-plane/60 p-3 space-y-2">
          <div className="label">Your confidence</div>
          <ConfidenceForm taskId={t.id} value={t.userConfidence} />
        </div>
      )}
      {(needsReason || t.slipReason) && (
        <div id="reason" className={`rounded-lg border p-3 space-y-2 ${needsReason && !t.slipReason ? "border-crit bg-crit/5" : "border-line bg-plane/60"}`}>
          <div className="label">{needsReason && !t.slipReason ? "Reason needed" : "Slip reason"}</div>
          {canEdit ? <SlipReasonForm r={r} /> : <p className="text-sm">{t.slipReason ? slipLabel(t.slipReason) : "—"}{t.slipNote ? `: ${t.slipNote}` : ""}</p>}
        </div>
      )}

      {t.description && (
        <div>
          <div className="label mb-1">Description</div>
          <p className="text-sm text-ink-2 whitespace-pre-wrap">{t.description}</p>
        </div>
      )}
      {dueChanges && dueChanges.length > 0 && (
        <div>
          <div className="label mb-1">Due-date changes</div>
          <ul className="text-xs text-ink-2 space-y-1">
            {dueChanges.map((c, i) => <li key={i} className="num">{fmtDateTime(c.changedAt)}: {fmtDate(c.oldDate)} → {fmtDate(c.newDate)}{c.changedBy ? ` by ${c.changedBy}` : ""}</li>)}
          </ul>
        </div>
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
      {canEdit && (
        <form action={addComment} className="space-y-2 rounded-lg border border-line bg-plane/60 p-3">
          <input type="hidden" name="taskId" value={t.id} />
          <input type="hidden" name="month" value={month} />
          <div className="label">Add a comment</div>
          <select name="reason" required defaultValue="" className="w-full">
            <option value="" disabled>Topic…</option>
            {REASONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          <textarea name="text" required minLength={2} rows={3} placeholder="Update, blocker or plan" className="w-full" />
          <button className="btn btn-primary">Save comment</button>
        </form>
      )}
    </div>
  );
}
