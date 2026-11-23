import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { prisma, getState } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { approveChanges, rejectChanges, decideReasonAction } from "@/app/actions";
import { Empty } from "@/components/ui";
import { slipLabel } from "@/lib/status";
import { clientOf } from "@/lib/clients";
import { peopleLabel } from "@/lib/people";
import { VERDICT_LABEL } from "@/lib/reasons";

const KIND: Record<string, string> = { UPDATE_DUE: "New due date", SET_STATUS: "Status change", CLEAR_DUE: "Clear due date", CREATE_TASK: "Create task" };
const DAY = 86_400_000;
const days = (from: Date, to = new Date()) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY));

export default async function Approvals() {
  await requireAdmin();
  const reasonInclude = { task: { include: { project: true, assignees: { include: { user: true } } } }, submittedBy: true, decidedBy: true } as const;
  const [pending, history, users, scopes, toReview, awaitingProof, reasonHistory, commentsFailing] = await Promise.all([
    prisma.zohoChange.findMany({ where: { auto: false, status: { in: ["PENDING", "FAILED"] } }, orderBy: { requestedAt: "asc" } }),
    prisma.zohoChange.findMany({ where: { auto: false, status: { in: ["APPLIED", "REJECTED"] } }, orderBy: { decidedAt: "desc" }, take: 30 }),
    prisma.user.findMany({ select: { id: true, name: true } }),
    getState("zoho.scopes"),
    prisma.reasonReview.findMany({ where: { status: { in: ["PENDING", "PROOF_SENT"] } }, include: reasonInclude, orderBy: { submittedAt: "asc" } }),
    prisma.reasonReview.findMany({ where: { status: "PROOF_REQUESTED" }, include: reasonInclude, orderBy: { proofAskedAt: "asc" } }),
    prisma.reasonReview.findMany({ where: { status: { in: ["AGREED", "DISAGREED"] } }, include: reasonInclude, orderBy: { decidedAt: "desc" }, take: 15 }),
    prisma.zohoChange.findMany({ where: { auto: true, status: "FAILED" }, orderBy: { decidedAt: "desc" }, take: 1 }),
  ]);
  const failingCount = commentsFailing.length ? await prisma.zohoChange.count({ where: { auto: true, status: { in: ["FAILED", "PENDING"] } } }) : 0;
  const name = new Map(users.map((u) => [u.id, u.name]));
  const writeOk = !scopes || /tasks\.UPDATE/i.test(scopes);

  const ReasonCard = ({ r }: { r: (typeof toReview)[number] }) => {
    const t = r.task;
    const overdue = t.dueDate && !t.isClosed && t.dueDate < new Date() ? days(t.dueDate) : null;
    const waiting = days(r.submittedAt);
    return (
      <li className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <div className="num text-[11px] text-ink-3">{t.key} · {clientOf(t, t.project).name}</div>
            <Link href={`/tasks/${t.id}`} className="font-medium hover:text-brand">{t.name}</Link>
            <div className="mt-0.5 text-xs text-ink-2">{peopleLabel(t)}{overdue !== null && <span className="text-crit"> · {overdue} days overdue</span>}{t.dueDate && overdue === null && <> · due {fmtDate(t.dueDate)}</>}</div>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.status === "PROOF_SENT" ? "bg-brand-soft text-brand-dark" : waiting >= 3 ? "bg-crit/10 text-crit" : "bg-plane text-ink-2"}`}>
            <Icon name={r.status === "PROOF_SENT" ? "mail" : "clock"} size={12} />
            {r.status === "PROOF_SENT" ? `Proof sent ${fmtDate(r.proofSentAt)}` : waiting ? `Waiting ${waiting} day${waiting > 1 ? "s" : ""}` : "New today"}
          </span>
        </div>
        <div className="mt-3 rounded-lg border border-line bg-plane p-3 text-sm">
          <div><span className="text-ink-2">{r.submittedBy?.name ?? "Team"} says:</span> <b className="font-semibold">{slipLabel(r.reason)}</b></div>
          {r.note && <p className="mt-1 whitespace-pre-line text-ink-2">{r.note}</p>}
          {r.status === "PROOF_SENT" && (
            <p className="mt-2 border-t border-line pt-2 text-ink-2">
              You asked: <span className="text-ink">{r.managerNote}</span>
              {r.proofNote && <> · They replied: <span className="text-ink">{r.proofNote}</span></>}
              <span className="block text-xs text-ink-3">Check your inbox for their email before deciding.</span>
            </p>
          )}
        </div>
        <form action={decideReasonAction} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <input type="hidden" name="reasonId" value={r.id} />
          <label className="block text-xs text-ink-2">
            Your note <span className="text-ink-3">(needed when asking for proof)</span>
            <textarea name="managerNote" rows={2} placeholder="e.g. Show the client email where they asked for the delay" className="mt-1 w-full" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button name="verdict" value="AGREED" className="btn btn-primary"><Icon name="check" size={14} />Agree</button>
            <button name="verdict" value="DISAGREED" className="btn"><Icon name="x" size={14} />Disagree</button>
            {r.status !== "PROOF_SENT" && <button name="verdict" value="PROOF_REQUESTED" className="btn"><Icon name="mail" size={14} />Ask for proof</button>}
          </div>
        </form>
      </li>
    );
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        Delay reasons from the team, and changes waiting to go to Zoho. Every decision here is also posted as a comment on the Zoho task.
      </p>
      {!writeOk && <div className="mt-3 card p-3 text-sm text-crit">The Zoho connection can&apos;t edit tasks yet. Go to Settings → Reconnect so approved changes and comments reach Zoho.</div>}
      {failingCount > 0 && (
        <div className="mt-3 card p-3 text-sm text-warnText">
          {failingCount} comment{failingCount > 1 ? "s" : ""} from the dashboard {failingCount > 1 ? "haven't" : "hasn't"} reached Zoho yet. They&apos;re retried automatically. Last error: <span className="text-ink-2">{commentsFailing[0].error}</span>
        </div>
      )}

      <h2 className="mt-6 text-base font-semibold flex items-center gap-2.5"><span className="chip chip-warn" aria-hidden><Icon name="message" size={15} /></span>Delay reasons to review <span className="num font-normal text-ink-3">· {toReview.length}</span></h2>
      <p className="mt-0.5 text-sm text-ink-2">Agree if it holds up. Ask for proof when it doesn&apos;t: they&apos;ll be tagged in Cliq and asked to email you, with the CC list from Settings copied.</p>
      {toReview.length ? (
        <ul className="mt-3 grid gap-3 xl:grid-cols-2 min-[1860px]:grid-cols-3">{toReview.map((r) => <ReasonCard key={r.id} r={r} />)}</ul>
      ) : (
        <div className="mt-3"><Empty>No delay reasons waiting.</Empty></div>
      )}

      {awaitingProof.length > 0 && (
        <>
          <h2 className="mt-8 text-base font-semibold flex items-center gap-2.5"><span className="chip" aria-hidden><Icon name="mail" size={15} /></span>Waiting for proof <span className="num font-normal text-ink-3">· {awaitingProof.length}</span></h2>
          <div className="mt-3 card divide-y divide-line">
            {awaitingProof.map((r) => (
              <div key={r.id} className="grid gap-1 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <Link href={`/tasks/${r.task.id}`} className="font-medium hover:text-brand">{r.task.key} {r.task.name}</Link>
                  <div className="text-xs text-ink-2">{r.submittedBy?.name ?? peopleLabel(r.task)} · {slipLabel(r.reason)} · asked by {r.decidedBy?.name} {(() => { const n = days(r.proofAskedAt ?? new Date()); return n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; })()}: <span className="text-ink">{r.managerNote}</span></div>
                </div>
                <form action={decideReasonAction} className="flex gap-2">
                  <input type="hidden" name="reasonId" value={r.id} />
                  <input type="hidden" name="managerNote" value={r.managerNote ?? ""} />
                  <button name="verdict" value="AGREED" className="btn">Agree</button>
                  <button name="verdict" value="DISAGREED" className="btn">Disagree</button>
                </form>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="mt-8 text-base font-semibold flex items-center gap-2.5"><span className="chip chip-teal" aria-hidden><Icon name="refresh" size={15} /></span>Zoho updates waiting <span className="num font-normal text-ink-3">· {pending.length}</span></h2>
      <p className="mt-0.5 text-sm text-ink-2">Old-task Keep / Backlog / Close decisions and recurring deliverables. They already count in the dashboard; Zoho changes only when you approve. Rejecting a review change undoes that decision.</p>
      {!pending.length ? (
        <div className="mt-3"><Empty>No Zoho updates waiting.</Empty></div>
      ) : (
        <>
          <form id="bulk-approve" className="mt-3 flex flex-wrap gap-2">
            <button formAction={approveChanges} className="btn btn-primary"><Icon name="check" size={15} />Approve selected and update Zoho</button>
            <button formAction={rejectChanges} className="btn">Reject selected</button>
          </form>
          <div className="mt-3 card overflow-x-auto">
            <table className="tbl w-full">
              <thead><tr><th className="w-8"><span className="sr-only">Select</span></th><th>Change</th><th>Type</th><th>From</th><th>Requested by</th><th>When</th><th></th></tr></thead>
              <tbody>
                {pending.map((c) => (
                  <tr key={c.id} className="align-top">
                    <td><input type="checkbox" name="changeId" value={c.id} form="bulk-approve" aria-label={`Select ${c.summary}`} /></td>
                    <td className="max-w-[420px]">{c.summary}{c.status === "FAILED" && <div className="mt-1 text-xs text-crit">Failed: {c.error}</div>}</td>
                    <td className="whitespace-nowrap">{KIND[c.kind]}</td>
                    <td>{c.source}</td>
                    <td className="whitespace-nowrap">{c.requestedById ? name.get(c.requestedById) : "system"}</td>
                    <td className="whitespace-nowrap text-xs">{fmtDateTime(c.requestedAt)}</td>
                    <td className="whitespace-nowrap">
                      <form className="flex gap-1">
                        <input type="hidden" name="changeId" value={c.id} />
                        <button formAction={approveChanges} className="btn btn-primary"><Icon name={c.status === "FAILED" ? "refresh" : "check"} size={14} />{c.status === "FAILED" ? "Retry" : "Approve"}</button>
                        <button formAction={rejectChanges} className="btn">Reject</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="mt-8 mb-3 text-base font-semibold flex items-center gap-2.5"><span className="chip" aria-hidden><Icon name="history" size={15} /></span>Recent decisions</h2>
      <div className="card divide-y divide-line">
        {[
          ...reasonHistory.map((r) => ({
            id: r.id,
            at: r.decidedAt,
            ok: r.status === "AGREED",
            label: VERDICT_LABEL[r.status],
            text: `${r.task.key} ${r.task.name} — ${r.submittedBy?.name ?? "Team"}: ${slipLabel(r.reason)}${r.managerNote ? ` · Note: ${r.managerNote}` : ""}`,
            by: r.decidedBy?.name ?? "",
          })),
          ...history.map((c) => ({ id: c.id, at: c.decidedAt, ok: c.status === "APPLIED", label: c.status === "APPLIED" ? "Applied" : "Rejected", text: c.summary, by: c.decidedById ? name.get(c.decidedById) ?? "" : "" })),
        ]
          .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
          .slice(0, 40)
          .map((c) => (
            <div key={c.id} className="grid gap-x-3 gap-y-0.5 p-3 text-sm sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:items-center">
              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${c.ok ? "text-goodText" : "text-ink-2"}`}>
                <Icon name={c.ok ? "check" : "x"} size={13} />{c.label}
              </span>
              <span className="min-w-0">{c.text}</span>
              <span className="text-xs text-ink-3">{c.by} · {fmtDateTime(c.at)}</span>
            </div>
          ))}
        {!history.length && !reasonHistory.length && <div className="p-3 text-sm text-ink-3">No decisions yet.</div>}
      </div>
    </div>
  );
}
