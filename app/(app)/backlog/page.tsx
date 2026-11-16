import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { monthData } from "@/lib/metrics";
import { clientOf } from "@/lib/clients";
import { currentMonth, fmtDate } from "@/lib/time";
import { Empty } from "@/components/ui";

export default async function Backlog({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const viewer = await requireUser();
  const sp = await searchParams;
  const admin = viewer.role === "ADMIN";
  const userId = admin ? sp.user || undefined : viewer.id;
  const d = await monthData(currentMonth(), { userId });
  const people = admin ? await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [];
  const rows = d.backlog.map((t) => ({ t, client: clientOf(t, t.project).name })).filter((x) => !sp.client || x.client === sp.client);
  const clients = [...new Set(d.backlog.map((t) => clientOf(t, t.project).name))].sort();
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Backlog</div>
          <h1 className="text-2xl font-semibold tracking-tight">Parked ideas & future plans ({rows.length})</h1>
          <p className="text-sm text-ink-2 mt-1">Backlog tasks never alert and never count in monthly scores. To bring one back, give it a due date in Zoho.</p>
        </div>
        <form className="flex flex-wrap items-center gap-2 text-sm">
          {admin && (
            <select name="user" defaultValue={sp.user ?? ""}>
              <option value="">Everyone</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select name="client" defaultValue={sp.client ?? ""}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn">Filter</button>
        </form>
      </div>
      {!rows.length ? <div className="mt-6"><Empty>Backlog is empty.</Empty></div> : (
        <div className="mt-5 card overflow-x-auto">
          <table className="tbl w-full">
            <thead><tr><th>Task</th><th>Client</th><th>Owner</th><th>Status in Zoho</th><th>Last update</th></tr></thead>
            <tbody>
              {rows.map(({ t, client }) => (
                <tr key={t.id}>
                  <td className="max-w-[320px]"><span className="font-mono text-xs text-ink-3">{t.key}</span> {t.url ? <a href={t.url} target="_blank" rel="noreferrer" className="hover:text-brand">{t.name}</a> : t.name}</td>
                  <td>{client}</td>
                  <td>{t.assignees.map((a) => a.user.name).join(", ") || "—"}</td>
                  <td>{t.zohoStatus}{t.bucket !== "BACKLOG" && <span className="text-[11px] text-ink-3"> · Zoho update waiting for approval</span>}</td>
                  <td className="num">{fmtDate(t.updatedAtZoho)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
