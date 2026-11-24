import { requireAdmin } from "@/lib/auth";
import { Icon } from "@/components/Icon";
import { auditText } from "@/lib/auditText";
import { prisma, getState } from "@/lib/db";
import { config, zohoConfigured } from "@/lib/config";
import { zohoConnected } from "@/lib/zoho/client";
import { cliqConfigured } from "@/lib/cliq";
import { cleanProjectName } from "@/lib/clients";
import { fmtDateTime } from "@/lib/time";
import { syncNow, testCliq, setProjectClient, setUserActive, saveSettingsAction, setCliqEmail, addRecurring, toggleRecurring } from "@/app/actions";
import { getSettings } from "@/lib/settings";
import { ClientTypeBadge } from "@/components/ui";
import { mailConnected } from "@/lib/mail";
import { feedbackLabel } from "@/lib/feedback";

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
  const [mailOk, feedback, mailAcct] = await Promise.all([
    mailConnected(),
    prisma.feedback.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    getState("zohomail.account"),
  ]);
  const mailFrom = mailAcct ? (JSON.parse(mailAcct).fromAddress as string) : null;
  const st = await getSettings();
  const [templates, auditRows, zohoScopes] = await Promise.all([
    prisma.recurringTemplate.findMany({ orderBy: [{ active: "desc" }, { title: "asc" }] }),
    prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: 40 }),
    getState("zoho.scopes"),
  ]);
  const canWrite = !!zohoScopes && /tasks\.UPDATE/i.test(zohoScopes);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const webhookUrl = `${config.appUrl}/api/webhooks/zoho?secret=${config.zoho.webhookSecret ? "••••••" : "<set ZOHO_WEBHOOK_SECRET>"}`;
  const Ok = ({ ok }: { ok: boolean }) => (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? "bg-good/10 text-goodText" : "bg-crit/10 text-crit"}`}>
      <Icon name={ok ? "check" : "x"} size={12} />
      {ok ? "Ready" : "Not set up"}
    </span>
  );
  const Head = ({ title, ok }: { title: string; ok: boolean }) => (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><h2 className="font-semibold">{title}</h2><Ok ok={ok} /></div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {sp.zoho === "connected" && <div className="card p-3 text-sm text-goodText">Zoho Projects connected. The first sync has started.</div>}
      {sp.mail === "connected" && <div className="card p-3 text-sm text-goodText">Zoho Mail connected. Feedback will now be emailed to {config.mail.feedbackTo}.</div>}
      {sp.mail === "no_refresh_token" && <div className="card p-3 text-sm text-crit">Zoho didn&apos;t return a refresh token for Mail. Remove the app's access in Zoho Accounts → Connected Apps, then connect again.</div>}
      {sp.zoho === "no_refresh_token" && <div className="card p-3 text-sm text-crit">Zoho didn&apos;t return a refresh token. Remove the app's access in Zoho Accounts → Connected Apps, then connect again.</div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-4 space-y-2">
          <Head title="Zoho Projects" ok={connected} />
          <p className="text-sm text-ink-2">Portal <b>{config.zoho.portalName}</b> on {config.zoho.apiBase.replace("https://", "")}. Full sync every {config.jobs.syncIntervalMin} min, plus instant updates from the webhook.</p>
          <div className="text-xs text-ink-3">Last successful sync: {lastOk ? fmtDateTime(new Date(lastOk)) : "never"}</div>
          <div className={`text-xs ${canWrite ? "text-goodText" : "text-warnText"}`}>{canWrite ? "Can apply approved changes (edit access)" : "Read-only connection — reconnect to allow approved changes to update Zoho"}</div>
          <div className="flex flex-wrap gap-2 pt-1">
            {zohoConfigured() ? <a href="/api/auth/login?purpose=connect" className="btn"><Icon name="refresh" size={15} />{connected ? "Reconnect" : "Connect Zoho Projects"}</a> : <span className="text-xs text-crit">Set ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET first</span>}
            {connected && <form action={syncNow}><button className="btn btn-primary"><Icon name="refresh" size={15} />Sync now</button></form>}
          </div>
        </div>
        <div className="card p-4 space-y-2">
          <Head title="Zoho webhook" ok={Boolean(config.zoho.webhookSecret)} />
          <p className="text-sm text-ink-2">In Zoho Projects → Automation → Webhooks → Tasks, add this URL (POST) and append <code>task_id</code> and <code>project_id</code>, then attach it to a rule for task create/update.</p>
          <code className="block break-all rounded bg-plane p-2 text-xs">{webhookUrl}</code>
        </div>
        <div className="card p-4 space-y-2">
          <Head title="Zoho Cliq alerts" ok={cliqConfigured()} />
          <p className="text-sm text-ink-2">Posts automatically to <b>#{config.cliq.channel || "—"}</b> when a task turns Tight or At Risk.</p>
          {cliqConfigured() && <form action={testCliq}><button className="btn"><Icon name="send" size={15} />Send test message</button></form>}
          <ul className="text-xs text-ink-2 space-y-1 pt-1">
            {alerts.map((a) => <li key={a.id} className="flex items-center gap-1.5" title={a.error ?? undefined}><Icon name={a.ok ? "check" : "x"} size={12} className={a.ok ? "text-goodText" : "text-crit"} label={a.ok ? "Sent" : "Failed"} /><span className="truncate">{fmtDateTime(a.sentAt)} · {a.task.name}{!a.ok && a.error ? ` — ${a.error}` : ""}</span></li>)}
          </ul>
        </div>
        <div className="card p-4 space-y-2">
          <Head title="Feedback email" ok={mailOk} />
          <p className="text-sm text-ink-2">Feedback is emailed to <b>{config.mail.feedbackTo}</b> through Zoho Mail{mailFrom ? <> (sent from {mailFrom})</> : null}. Connect while signed in to that mailbox.</p>
          {zohoConfigured() && <a href="/api/auth/login?purpose=mail" className="btn">{mailOk ? "Reconnect Zoho Mail" : "Connect Zoho Mail"}</a>}
        </div>
      </div>

      <div>
        <div className="flex items-end justify-between mb-1">
          <h2 className="text-base font-semibold flex items-center gap-2.5"><span className="chip" aria-hidden><Icon name="mail" size={15} /></span>Feedback</h2>
          <span className="text-xs text-ink-3">{feedback.length ? `Latest ${feedback.length}` : ""}</span>
        </div>
        <p className="text-sm text-ink-2 mb-3">Everything sent from the Feedback button. Each one is also emailed to {config.mail.feedbackTo}.</p>
        <div className="card divide-y divide-line">
          {feedback.map((f) => (
            <details key={f.id} className="p-3 text-sm">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                <span className="rounded bg-plane border border-line px-1.5 py-0.5 text-[11px] font-semibold">{feedbackLabel(f.type)}</span>
                <span className="font-medium">{f.subject}</span>
                <span className="text-xs text-ink-2">{f.userName}</span>
                <span className="ml-auto text-xs text-ink-3">{fmtDateTime(f.createdAt)} · {f.emailed ? <span className="text-goodText">emailed</span> : <span className="text-crit" title={f.emailError ?? ""}>not emailed</span>}</span>
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-ink-2">{f.message}</p>
              <p className="mt-1 text-xs text-ink-3">{f.userEmail}{f.page ? ` · page ${f.page}` : ""}{f.emailError ? ` · email error: ${f.emailError}` : ""}</p>
            </details>
          ))}
          {!feedback.length && <div className="p-3 text-sm text-ink-3">No feedback yet.</div>}
        </div>
      </div>

      <div>
        <h2 className="text-base font-semibold mb-1 flex items-center gap-2.5"><span className="chip" aria-hidden><Icon name="briefcase" size={15} /></span>Client mapping</h2>
        <p className="text-sm text-ink-2 mb-3">Client name and type come from each Zoho project (a &quot;Client&quot; / &quot;Client Type&quot; custom field, or a <code>client:Name</code> tag). A task tagged <code>client:Name</code> is counted under that client even if it sits in an internal project. Use an override only to fix a mishap.</p>
        <div className="card overflow-x-auto">
          <table className="tbl w-full">
            <thead><tr><th>Zoho project</th><th>Tasks</th><th>From Zoho</th><th>Override name</th><th>Override type</th><th></th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                  <td><div className="font-medium">{p.name}</div><div className="text-xs text-ink-3">{p.active ? p.zohoStatus ?? "Active" : "Not synced (inactive)"}</div></td>
                  <td className="num">{p._count.tasks}</td>
                  <td className="text-sm">{p.zohoClientName ?? cleanProjectName(p.name)} <ClientTypeBadge type={p.clientTypeOverride ?? p.zohoClientType ?? (config.internalNames.includes((p.clientOverride ?? p.zohoClientName ?? cleanProjectName(p.name)).toLowerCase()) ? "INTERNAL" : "CLIENT")} /></td>
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

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2.5"><span className="chip chip-teal" aria-hidden><Icon name="users" size={15} /></span>People & access</h2>
          <div className="card overflow-x-auto">
            <table className="tbl w-full">
              <thead><tr><th>Name</th><th>Email</th><th>Access</th><th></th></tr></thead>
              <caption className="caption-bottom px-3 py-2 text-left text-[11px] text-ink-3">Only the people in ADMIN_EMAILS (set on Railway) can open the dashboard. Everyone else works in Zoho Projects; Remove only hides a person from the numbers.</caption>
              <tbody>
                {users.filter((u) => u.active).map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.name}</td>
                    <td className="max-w-[16rem] truncate text-xs text-ink-2" title={u.email}>{u.email}</td>
                    <td>
                      {config.adminEmails.includes(u.email.toLowerCase()) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-dark"><Icon name="eye" size={12} />Dashboard{u.id === me.id ? " (you)" : ""}</span>
                      ) : (
                        <span className="text-xs text-ink-3">Zoho only</span>
                      )}
                    </td>
                    <td>
                      {u.id !== me.id && (
                        <form action={setUserActive}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="active" value="false" />
                          <button className="btn text-crit" aria-label={`Remove ${u.name} from the dashboard`}>Remove</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {users.some((u) => !u.active) && (
            <div className="mt-4">
              <div className="label mb-2">Removed from the dashboard</div>
              <p className="text-xs text-ink-2 mb-2">Hidden everywhere. Tasks assigned only to them are taken off the dashboard (numbers, Kanban, alerts and reports); on shared tasks their name is hidden. Restore brings it all back.</p>
              <div className="card divide-y divide-line">
                {users.filter((u) => !u.active).map((u) => (
                  <div key={u.id} className="flex items-center justify-between p-3 text-sm">
                    <span>{u.name} <span className="text-xs text-ink-3">{u.email}</span></span>
                    <form action={setUserActive}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="active" value="true" />
                      <button className="btn">Restore</button>
                    </form>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2.5"><span className="chip" aria-hidden><Icon name="refresh" size={15} /></span>Recent jobs</h2>
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

      <div>
        <h2 className="text-base font-semibold mb-1 flex items-center gap-2.5"><span className="chip chip-teal" aria-hidden><Icon name="calendar" size={15} /></span>Planning & alerts</h2>
        <form action={saveSettingsAction} className="card p-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3 text-sm">
          <label className="block">CC on every Cliq alert
            <input name="ccEmails" defaultValue={st.ccEmails.join(", ")} className="mt-1 w-full" />
            <span className="text-[11px] text-ink-3">Emails, comma separated</span>
          </label>
          <label className="block">Tagged on the monthly report
            <input name="reportRecipients" defaultValue={st.reportRecipients.join(", ")} className="mt-1 w-full" />
          </label>
          <div className="flex gap-3">
            <label className="block">Quiet from
              <input type="number" min={0} max={23} name="quietStart" defaultValue={st.quietStart} className="mt-1 w-20" />
            </label>
            <label className="block">until
              <input type="number" min={0} max={23} name="quietEnd" defaultValue={st.quietEnd} className="mt-1 w-20" />
            </label>
            <label className="block">Report post hour (1st)
              <input type="number" min={0} max={23} name="reportPostHour" defaultValue={st.reportPostHour} className="mt-1 w-20" />
            </label>
          </div>
          <fieldset className="space-y-1">
            <legend className="mb-1">Cliq posts</legend>
            <label className="flex items-center gap-2"><input type="checkbox" name="alertsEnabled" defaultChecked={st.alertsEnabled} /> Task alerts (planned deliverables, one per state change)</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="checkinEnabled" defaultChecked={st.checkinEnabled} /> Monday confidence check-in</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="digestEnabled" defaultChecked={st.digestEnabled} /> Weekday 09:00 morning digest</label>
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <label className="block">Plan locks at end of working day
              <input type="number" min={1} max={10} name="lockWorkingDay" defaultValue={st.lockWorkingDay} className="mt-1 w-20" />
            </label>
            <label className="block">Max Keep months in a row
              <input type="number" min={1} max={12} name="maxKeepMonths" defaultValue={st.maxKeepMonths} className="mt-1 w-20" />
            </label>
          </div>
          <fieldset>
            <legend className="mb-1">Working days</legend>
            <div className="flex flex-wrap gap-2">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" name="workingDays" value={i} defaultChecked={st.workingDays.includes(i)} />{d}</label>)}</div>
          </fieldset>
          <div className="flex gap-3">
            <label className="block">Workload green ≤
              <input type="number" min={1} name="workloadGreen" defaultValue={st.workloadGreen} className="mt-1 w-20" />
            </label>
            <label className="block">amber ≤
              <input type="number" min={1} name="workloadAmber" defaultValue={st.workloadAmber} className="mt-1 w-20" />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="block">Zoho status for Backlog
              <input name="backlogStatusName" defaultValue={st.backlogStatusName} className="mt-1 w-44" />
            </label>
            <label className="block">Zoho status for Close
              <input name="closedStatusName" defaultValue={st.closedStatusName} className="mt-1 w-44" />
            </label>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" name="includeRatingsInClientPdf" defaultChecked={st.includeRatingsInClientPdf} /> Include ratings in client PDF</label>
          <div className="md:col-span-2 xl:col-span-3"><button className="btn btn-primary">Save settings</button></div>
        </form>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="text-base font-semibold mb-1 flex items-center gap-2.5"><span className="chip" aria-hidden><Icon name="message" size={15} /></span>Cliq mapping</h2>
          <p className="text-sm text-ink-2 mb-3">Alerts @mention people by their Zoho email. If someone&apos;s Cliq address is different, set it here.</p>
          <div className="card divide-y divide-line">
            {users.filter((u) => u.active).map((u) => (
              <form key={u.id} action={setCliqEmail} className="flex flex-wrap items-center gap-2 p-2.5 text-sm">
                <input type="hidden" name="userId" value={u.id} />
                <span className="w-40 truncate font-medium">{u.name}</span>
                <span className="text-xs text-ink-3 w-48 truncate">{u.email}</span>
                <input name="cliqEmail" defaultValue={u.cliqEmail ?? ""} placeholder="same as Zoho" className="flex-1 min-w-40" />
                <button className="btn">Save</button>
              </form>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-base font-semibold mb-1 flex items-center gap-2.5"><span className="chip chip-teal" aria-hidden><Icon name="history" size={15} /></span>Recurring deliverables</h2>
          <p className="text-sm text-ink-2 mb-3">Monthly retainer work (e.g. &quot;Google Ads Maintenance&quot;, &quot;4 Blogs&quot;). Any task in the project whose name contains the title is always planned.</p>
          <form action={addRecurring} className="card p-3 flex flex-wrap gap-2 text-sm">
            <select name="projectId" required defaultValue="" className="min-w-44">
              <option value="" disabled>Project…</option>
              {projects.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input name="title" required minLength={3} placeholder="Title, e.g. Google Ads Maintenance" className="flex-1 min-w-48" />
            <select name="ownerUserId" defaultValue="">
              <option value="">Owner (optional)</option>
              {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <input type="number" name="dayOfMonth" min={1} max={31} defaultValue={28} className="w-20" aria-label="Due day of month" />
            <button className="btn btn-primary">Add</button>
          </form>
          <div className="mt-2 card divide-y divide-line">
            {templates.map((t) => (
              <form key={t.id} action={toggleRecurring} className={`flex items-center gap-2 p-2.5 text-sm ${t.active ? "" : "opacity-50"}`}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="active" value={t.active ? "false" : "true"} />
                <span className="flex-1">{t.title} <span className="text-ink-3">· {projectName.get(t.projectId)} · due day {t.dayOfMonth}</span></span>
                <button className="btn">{t.active ? "Turn off" : "Turn on"}</button>
              </form>
            ))}
            {!templates.length && <div className="p-3 text-sm text-ink-3">No recurring deliverables yet.</div>}
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2.5"><span className="chip" aria-hidden><Icon name="file" size={15} /></span>Audit log</h2>
        <div className="card divide-y divide-line">
          {auditRows.map((a) => (
            <div key={a.id} className="grid gap-x-4 gap-y-0.5 p-3 text-sm sm:grid-cols-[9.5rem_minmax(0,1fr)]">
              <span className="num text-xs text-ink-3 sm:pt-0.5">{fmtDateTime(a.at)}</span>
              <span className="min-w-0"><b className="font-medium">{a.actor}</b> <span className="text-ink-2">{auditText(a.action, a.detail as Record<string, unknown> | null)}</span></span>
            </div>
          ))}
          {!auditRows.length && <div className="p-3 text-sm text-ink-3">Nothing logged yet.</div>}
        </div>
      </div>
    </div>
  );
}
