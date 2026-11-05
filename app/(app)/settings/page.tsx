import { requireAdmin } from "@/lib/auth";
import { prisma, getState } from "@/lib/db";
import { config, zohoConfigured } from "@/lib/config";
import { zohoConnected } from "@/lib/zoho/client";
import { cliqConfigured } from "@/lib/cliq";
import { cleanProjectName } from "@/lib/clients";
import { fmtDateTime } from "@/lib/time";
import { syncNow, testCliq, setProjectClient, setRole } from "@/app/actions";
import { ClientTypeBadge } from "@/components/ui";

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const [connected, logs, projects, users, lastOk, alerts] = await Promise.all([
    zohoConnected(),
    prisma.syncLog.findMany({ orderBy: { startedAt: "desc" }, take: 12 }),
    prisma.project.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { tasks: true } } } }),
    prisma.user.findMany({ orderBy: { name: "asc" } }),
    getState("sync.last_ok"),
    prisma.alertLog.findMany({ orderBy: { sentAt: "desc" }, take: 8, include: { task: true } }),
  ]);
  const webhookUrl = `${config.appUrl}/api/webhooks/zoho?secret=${config.zoho.webhookSecret ? "••••••" : "<set ZOHO_WEBHOOK_SECRET>"}`;
  const Ok = ({ ok }: { ok: boolean }) => <span className={`text-xs font-semibold ${ok ? "text-goodText" : "text-crit"}`}>{ok ? "✓ Ready" : "✕ Not set up"}</span>;

  return (
    <div className="space-y-6">
      <div>
        <div className="label">Settings</div>
        <h1 className="text-2xl font-semibold tracking-tight">Connections & mapping</h1>
      </div>
      {sp.zoho === "connected" && <div className="card p-3 text-sm text-goodText">Zoho Projects connected. The first sync has started.</div>}
      {sp.zoho === "no_refresh_token" && <div className="card p-3 text-sm text-crit">Zoho didn&apos;t return a refresh token. Remove the app's access in Zoho Accounts → Connected Apps, then connect again.</div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4 space-y-2">
          <div className="flex justify-between"><div className="font-semibold">Zoho Projects</div><Ok ok={connected} /></div>
          <p className="text-sm text-ink-2">Portal <b>{config.zoho.portalName}</b> on {config.zoho.apiBase.replace("https://", "")}. Full sync every {config.jobs.syncIntervalMin} min, plus instant updates from the webhook.</p>
          <div className="text-xs text-ink-3">Last successful sync: {lastOk ? fmtDateTime(new Date(lastOk)) : "never"}</div>
          <div className="flex gap-2 pt-1">
            {zohoConfigured() ? <a href="/api/auth/login?purpose=connect" className="btn">{connected ? "Reconnect" : "Connect Zoho Projects"}</a> : <span className="text-xs text-crit">Set ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET first</span>}
            {connected && <form action={syncNow}><button className="btn btn-primary">Sync now</button></form>}
          </div>
        </div>
        <div className="card p-4 space-y-2">
          <div className="flex justify-between"><div className="font-semibold">Zoho webhook</div><Ok ok={Boolean(config.zoho.webhookSecret)} /></div>
          <p className="text-sm text-ink-2">In Zoho Projects → Automation → Webhooks → Tasks, add this URL (POST) and append <code>task_id</code> and <code>project_id</code>, then attach it to a rule for task create/update.</p>
          <code className="block break-all rounded bg-plane p-2 text-xs">{webhookUrl}</code>
        </div>
        <div className="card p-4 space-y-2">
          <div className="flex justify-between"><div className="font-semibold">Zoho Cliq alerts</div><Ok ok={cliqConfigured()} /></div>
          <p className="text-sm text-ink-2">Posts automatically to <b>#{config.cliq.channel || "—"}</b> when a task turns Tight or At Risk.</p>
          {cliqConfigured() && <form action={testCliq}><button className="btn">Send test message</button></form>}
          <ul className="text-xs text-ink-2 space-y-1 pt-1">
            {alerts.map((a) => <li key={a.id} className="truncate">{a.ok ? "✓" : "✕"} {fmtDateTime(a.sentAt)} · {a.task.name}</li>)}
          </ul>
        </div>
      </div>

      <div>
        <h2 className="text-base font-semibold mb-1">Client mapping</h2>
        <p className="text-sm text-ink-2 mb-3">Client name and type come from each Zoho project (a &quot;Client&quot; / &quot;Client Type&quot; custom field, or a <code>client:Name</code> tag). A task tagged <code>client:Name</code> is counted under that client even if it sits in an internal project. Use an override only to fix a mishap.</p>
        <div className="card overflow-x-auto">
          <table className="tbl w-full">
            <thead><tr><th>Zoho project</th><th>Tasks</th><th>From Zoho</th><th>Override name</th><th>Override type</th><th></th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                  <td><div className="font-medium">{p.name}</div><div className="text-xs text-ink-3">{p.active ? p.zohoStatus ?? "Active" : "Not synced (inactive)"}</div></td>
                  <td className="num">{p._count.tasks}</td>
                  <td className="text-sm">{p.zohoClientName ?? cleanProjectName(p.name)} {p.zohoClientType && <ClientTypeBadge type={p.zohoClientType} />}</td>
                  <td colSpan={3}>
                    <form action={setProjectClient} className="flex items-center gap-2">
                      <input type="hidden" name="projectId" value={p.id} />
                      <input name="clientOverride" defaultValue={p.clientOverride ?? ""} placeholder="—" className="w-48" />
                      <select name="clientType" defaultValue={p.clientTypeOverride ?? ""}>
                        <option value="">From Zoho</option><option value="CLIENT">Client</option><option value="INTERNAL">Internal</option>
                      </select>
                      <button className="btn">Save</button>
                    </form>
                  </td>
                </tr>
              ))}
              {!projects.length && <tr><td colSpan={6} className="text-center text-ink-3 py-6">No projects yet. Connect Zoho and sync.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="text-base font-semibold mb-3">People & access</h2>
          <div className="card overflow-x-auto">
            <table className="tbl w-full">
              <thead><tr><th>Name</th><th>Email</th><th>Access</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.name}</td>
                    <td className="text-xs text-ink-2">{u.email}</td>
                    <td>
                      {u.id === me.id ? <span className="text-xs text-ink-3">Admin (you)</span> : (
                        <form action={setRole} className="flex gap-2">
                          <input type="hidden" name="userId" value={u.id} />
                          <select name="role" defaultValue={u.role}><option value="MEMBER">Specialist (own tasks)</option><option value="ADMIN">Manager / admin</option></select>
                          <button className="btn">Save</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="text-base font-semibold mb-3">Recent jobs</h2>
          <div className="card divide-y divide-line">
            {logs.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                <div><span className={l.ok ? "text-goodText" : l.finishedAt ? "text-crit" : "text-ink-3"}>{l.ok ? "✓" : l.finishedAt ? "✕" : "…"}</span> <b>{l.kind}</b> <span className="text-ink-2">{l.detail}</span></div>
                <span className="text-xs text-ink-3 whitespace-nowrap">{fmtDateTime(l.startedAt)}</span>
              </div>
            ))}
            {!logs.length && <div className="p-3 text-sm text-ink-3">No jobs have run yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
