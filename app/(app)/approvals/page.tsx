import { requireAdmin } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { prisma, getState } from "@/lib/db";
import { fmtDateTime } from "@/lib/time";
import { approveChanges, rejectChanges } from "@/app/actions";
import { Empty } from "@/components/ui";

const KIND: Record<string, string> = { UPDATE_DUE: "New due date", SET_STATUS: "Status change", CLEAR_DUE: "Clear due date", CREATE_TASK: "Create task" };

export default async function Approvals() {
  await requireAdmin();
  const [pending, history, users, scopes] = await Promise.all([
    prisma.zohoChange.findMany({ where: { status: { in: ["PENDING", "FAILED"] } }, orderBy: { requestedAt: "asc" } }),
    prisma.zohoChange.findMany({ where: { status: { in: ["APPLIED", "REJECTED"] } }, orderBy: { decidedAt: "desc" }, take: 40 }),
    prisma.user.findMany({ select: { id: true, name: true } }),
    getState("zoho.scopes"),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const writeOk = !scopes || /tasks\.UPDATE/i.test(scopes);
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Zoho updates waiting for approval</h1>
      <p className="mt-1 text-sm text-ink-2 max-w-3xl">
        Review decisions and recurring deliverables don&apos;t touch Zoho until you approve them here. They already count in the dashboard.
        Rejecting a review change undoes that decision, and the task goes back to &quot;pending decision&quot;.
      </p>
      {!writeOk && <div className="mt-3 card p-3 text-sm text-crit">The Zoho connection was made before v2 and can&apos;t edit tasks. Go to Settings → Reconnect Zoho Projects (edit access) before approving.</div>}

      {!pending.length ? (
        <div className="mt-6"><Empty>Nothing waiting for approval.</Empty></div>
      ) : (
        <>
          <form id="bulk-approve" className="mt-5 flex flex-wrap gap-2">
            <button formAction={approveChanges} className="btn btn-primary">Approve selected and update Zoho</button>
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
                        <button formAction={approveChanges} className="btn btn-primary">{c.status === "FAILED" ? "Retry" : "Approve"}</button>
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

      <h2 className="mt-8 mb-3 text-base font-semibold">Recent decisions</h2>
      <div className="card divide-y divide-line">
        {history.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <span className={`text-xs font-semibold ${c.status === "APPLIED" ? "text-goodText" : "text-ink-3"}`}>{c.status === "APPLIED" ? <span className="inline-flex items-center gap-1"><Icon name="check" size={13} />Applied</span> : <span className="inline-flex items-center gap-1"><Icon name="x" size={13} />Rejected</span>}</span>
            <span className="flex-1">{c.summary}</span>
            <span className="text-xs text-ink-3">{c.decidedById ? name.get(c.decidedById) : ""} · {fmtDateTime(c.decidedAt)}</span>
          </div>
        ))}
        {!history.length && <div className="p-3 text-sm text-ink-3">No decisions yet.</div>}
      </div>
    </div>
  );
}
