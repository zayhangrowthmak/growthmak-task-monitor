# Growthmak Task Monitor: deployment and operations handover

This file is for anyone (person or agent) who needs to understand, change or redeploy the Growthmak Task Monitor. It covers where the code lives, how GitHub and Railway are wired together, how a change reaches production, how data gets in, and what to watch out for. It follows the same process as the Growthmak Outreach dashboard (`growthmak-outreach-dashboard/DEPLOYMENT.md`), so anyone who knows that one can run this one.

The README in the repo is the long-form manual: how the metrics and the confidence score work, the full list of environment variables, and the Zoho / Cliq setup. This file is the operational summary on top of it.

> Values shown as `‹…›` get filled in once the first deploy exists.

---

## 1. The pieces at a glance

```
 Developer's laptop (Windows)                  GitHub                         Railway (project "growthmak-dashboard")
 ───────────────────────────                   ──────                         ────────────────────────────────────────
 C:\Users\ahmed\OneDrive\Documents\GitHub\     zayhangrowthmak/               service "task-monitor" (Next.js, 1 replica)
   Growthmak-Task-Monitor        ── push ──►  Growthmak-Task-Monitor ──────► auto-build + deploy on every push to main
 (edited, committed; pushed with               branch: main (private)           │  build: npm run build   start: npm start
  GitHub Desktop)                                                               │  health: GET /healthz
                                                                                ├─ reads ► Zoho Projects API (projectsapi.zoho.in)
                                                                                ├─ ◄ webhook ─ Zoho Projects (task create/update)
                                                                                ├─ posts ► Zoho Cliq channel (Tight / At Risk alerts)
                                                                                ├─ login ► Zoho Accounts (accounts.zoho.in, OAuth)
                                                                                └─ r/w ──► service "Postgres" (same project, schema task_monitor)
```

| Thing | Value |
| --- | --- |
| GitHub repo | `https://github.com/zayhangrowthmak/Growthmak-Task-Monitor` (private), branch `main` |
| Local working copy | `C:\Users\ahmed\OneDrive\Documents\GitHub\Growthmak-Task-Monitor` (inside OneDrive) |
| How code is pushed | GitHub Desktop, using the **Push origin** button |
| Railway project | `growthmak-dashboard` (the same project as the Outreach dashboard) |
| Railway web service | `task-monitor` |
| Railway environment | `production` |
| Database | the existing Railway `Postgres` service; this app's tables live in their own schema, `task_monitor`, so they never touch the Outreach dashboard's `dashboard` schema |
| Public URL | `‹https://task-monitor-production-xxxx.up.railway.app›` |
| Runtime | Node ≥ 20, Next.js 15 (App Router), Prisma 6 + Postgres, Tailwind; has a build step |
| Replicas | **1** (keep it at 1; the scheduler lives in the web process) |

**There is a login.** Unlike the Outreach dashboard, sign-in is required: everyone signs in with their own Zoho account. Specialists see only their own tasks. People in `ADMIN_EMAILS`, or promoted in Settings, get the manager view, reports and settings.

---

## 2. How a change reaches production

Railway's GitHub integration deploys **every push to `main`** automatically. There is no CI, no staging environment and no manual deploy step.

1. **Edit** the code in the working copy.
2. **Test** against a disposable Postgres:
   ```bash
   npm install
   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/gm_test npm test
   ```
   - This runs the confidence-rule unit tests, then the end-to-end suite (`test/run-e2e.mts`). The suite runs the real sync, scoring, webhook, Cliq, month-end and PDF code against mock Zoho and Cliq servers (`test/mocks.mts`).
   - All 20 checks must pass.
   - Each run makes its own `e2e_<timestamp>` schema and drops only that schema, so it never wipes existing data.
   - It refuses to run without `TEST_DATABASE_URL`, or if the database name doesn't contain "test".
3. **Commit** in the local repo folder, as author `Zayhan <mohammed@growthmaksolutions.com>`.
4. **Push** with GitHub Desktop's **Push origin** button. This is the step people forget (§7.1).
5. Railway builds and deploys in about 3 minutes. Next.js has a build step, so it takes a little longer than the Outreach dashboard. Watch it in **Railway, then service, then Deployments**. It goes live once `/healthz` answers `{"ok":true}`.
6. **Verify** (§6). Saving or changing a **variable** in Railway also creates a pending change: click **Deploy** ("Apply N change") to roll it out.

`railway.json` in the repo:

```json
{ "build":  { "buildCommand": "npm run build" },
  "deploy": { "startCommand": "npm start", "healthcheckPath": "/healthz", "healthcheckTimeout": 100,
              "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 10 } }
```

- `npm run build` runs `prisma generate && next build`.
- `npm start` runs `prisma migrate deploy && next start -p $PORT`.

---

## 3. Database and migrations (no manual SQL, ever)

- Set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}?schema=task_monitor`. This uses the Railway private network, and `?schema=task_monitor` keeps every table of this app in its own schema, inside the same Postgres as the Outreach dashboard.
- On every boot, `npm start` runs **`prisma migrate deploy`**. It applies any new migration in `prisma/migrations/` once, records it in `task_monitor._prisma_migrations`, and never drops data.
- **Changing the schema:**
  1. Edit `prisma/schema.prisma`.
  2. Run `npx prisma migrate dev --name <what-changed>` against a **local** database. This creates a new folder in `prisma/migrations/`.
  3. Commit that folder with the code.
  4. Never edit or delete a migration that has already been deployed.
- **Never run `prisma migrate reset` or `prisma db push` against Railway.** Both can wipe data.
- **Starting over:**
  1. Run `DROP SCHEMA task_monitor CASCADE;` on the Railway Postgres. This drops only this app's schema; the Outreach dashboard is untouched.
  2. Redeploy.
  - All tasks and projects are re-pulled from Zoho on the first sync.
  - What only lives here is lost: per-task comments, monthly reviews and ratings, Settings overrides (client mapping, promoted managers), month-end snapshots and stored PDFs, and the saved Zoho connection. After a reset, an admin must click **Settings → Connect Zoho Projects** again.

---

## 4. How data gets in (syncs)

Zoho is the source of truth. **The dashboard never writes to Zoho Projects.** The only things it sends out are Cliq messages.

| What | When | Notes |
| --- | --- | --- |
| Full sync (all active projects and their tasks) | on boot (`SYNC_ON_BOOT=true`, about 15 s after start), then every `SYNC_INTERVAL_MIN` (15) | built-in scheduler in the web process; a lease lock in Postgres (`AppState` key `lock.sync`) prevents two syncs at once, even while an old and a new deploy overlap; history is under **Settings → Recent jobs** (`SyncLog` table) |
| Instant update (one task) | whenever Zoho fires the task webhook | `POST /api/webhooks/zoho?secret=<ZOHO_WEBHOOK_SECRET>` with `task_id` and `project_id`; re-reads that task and re-scores it |
| Confidence re-score | every `CONFIDENCE_INTERVAL_MIN` (30), and after every sync | time moves even when Zoho doesn't, so tasks become Tight or At Risk on their own |
| Month end | first scheduler tick on or after the 1st | freezes last month's numbers (`MonthlySnapshot`), builds and stores its PDF (`MonthlyReport`); runs once per month (lock `lock.month-end`) |
| Manual | **Settings → Sync now** | |
| External trigger | `GET /api/cron/sync`, `/api/cron/confidence` or `/api/cron/month-end` with header `Authorization: Bearer <CRON_SECRET>` | only works if `CRON_SECRET` is set; not needed while the built-in scheduler runs |

Cliq alerts:
- An alert fires when a task moves into **Tight** or **At Risk** from a better state. It isn't repeated while the task stays there.
- More than 5 alerts at once (e.g. a batch going overdue at midnight) are sent as one digest message.
- The very first sync sets a silent baseline (`AppState` key `alerts.baseline`), so connecting doesn't flood the channel.

### External APIs and their credentials

| Source | Address | Auth | Needs |
| --- | --- | --- | --- |
| Zoho Accounts (team sign-in + sync token) | `ZOHO_ACCOUNTS_URL` = `https://accounts.zoho.in` | **Server-based** OAuth client from `api-console.zoho.in`: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`; redirect URI `<APP_URL>/api/auth/callback` | sign-in scope `AaaServer.profile.Read` |
| Zoho Projects | `ZOHO_PROJECTS_API` = `https://projectsapi.zoho.in`, API **v3**, portal `growthmak` | refresh token from **Settings → Connect Zoho Projects** (stored in the database), or `ZOHO_REFRESH_TOKEN` | `ZohoProjects.portals.READ, projects.READ, tasks.READ, users.READ, timesheets.READ`; Zoho allows about 100–200 calls per 2 minutes, and the client limits itself to 90 |
| Zoho Projects webhook | Zoho → `<APP_URL>/api/webhooks/zoho?secret=…` | shared secret `ZOHO_WEBHOOK_SECRET` | Enterprise plan; capped at 2,000 calls a day |
| Zoho Cliq | `CLIQ_API_BASE` = `https://cliq.zoho.in`, `POST /api/v2/channelsbyname/<CLIQ_CHANNEL>/message` | webhook token (zapikey) in `CLIQ_WEBHOOK_TOKEN` | the dedicated alerts channel |

Notes:
- Unlike the Outreach dashboard's CRM setup, this one can't use a Self Client. Team sign-in needs a browser redirect, so it must be a **Server-based Application**.
- This app talks to the **India** data centre (`.in`), because the Projects portal is `projects.zoho.in`. The Outreach dashboard's CRM uses `accounts.zoho.com`. Don't copy that value across.

`npm run check` (`scripts/check-connections.ts`) tests the database, the Zoho Projects connection and the settings, and writes nothing. From the laptop, run `railway run npm run check`.

---

## 5. Environment variables on the Railway service

**Secrets are only ever typed into Railway's Variables page by the owner. They are never committed, pasted into chat or shown on the page.** `.env*` is git-ignored except `.env.example`. The full table is in README and `.env.example`; the ones that matter:

| Variable | Status / value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}?schema=task_monitor` |
| `APP_URL` | the public Railway URL, no trailing `/` |
| `SESSION_SECRET` | 40+ random characters; changing it signs everyone out |
| `ADMIN_EMAILS` | `mohammed@growthmaksolutions.com` (comma-separated for more) |
| `ALLOWED_EMAIL_DOMAIN` | `growthmaksolutions.com` |
| `DEMO_MODE` | `false` (never `true` in production) |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` | from api-console.zoho.in |
| `ZOHO_PORTAL_NAME` | `growthmak` |
| `ZOHO_WEBHOOK_SECRET` | random string, also used in the Zoho webhook URL |
| `CLIQ_CHANNEL`, `CLIQ_WEBHOOK_TOKEN` | the alerts channel's unique name and a Cliq webhook token |
| `INTERNAL_CLIENT_NAMES` | `Growthmak,GrowthOS` |
| `SYNC_INTERVAL_MIN`, `SYNC_ON_BOOT` | 15, true |
| `ZOHO_ACCOUNTS_URL`, `ZOHO_PROJECTS_API`, `CLIQ_API_BASE` | defaults are the `.in` addresses; leave unset |

Changing a variable redeploys the service, but only after **Deploy** is clicked on Railway's pending-changes bar.

---

## 6. Verifying a deploy

```bash
B=‹https://task-monitor-production-xxxx.up.railway.app›
curl -s $B/healthz                         # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" $B/login        # 200
railway run npm run check                  # ✓ Database, ✓ Zoho Projects, ✓ Cliq …
```

Then in the browser, signed in as an admin:
- **Settings** should show "Last successful sync" within the last 15 minutes and a green ✓ on the latest `full` job.
- **Overview** should show this month's numbers.
- **Settings → Send test message** should arrive in the Cliq channel.

The deploy logs should show:
- `prisma migrate deploy`: either "No pending migrations" or the migration it applied
- `✓ Ready`
- `[boot] scheduler started (sync every 15 min, on boot: true)`
- `[sync] run -> N active projects, N tasks, N alerts`

**To confirm which code is live,** compare the behaviour with the latest commit. On the laptop, `git status -sb` showing `[ahead N]` means GitHub, and therefore Railway, doesn't have those commits yet.

---

## 7. Things to watch (read before changing anything)

1. **Committed but not pushed.** Same trap as the Outreach dashboard. Symptom: a fix "doesn't work" after deploy. Check: `git status -sb` / `git log origin/main..HEAD`. Fix: GitHub Desktop, then **Push origin**.
2. **Git lock files in the OneDrive folder.** If GitHub Desktop says "File exists … .lock", delete that `.git/*.lock` file, but only when no git command is running. Any `.git/stale-*` or `tmp_obj_*` file is safe to delete.
3. **Zoho status names.** Task statuses are mapped to the five columns by keyword (`lib/status.ts`):
   - *wait/block/hold* → Blocked / Waiting
   - *review/QA/UAT* → Review / QA
   - closed statuses → Completed
   - *cancel* → excluded

   If a status is renamed or added in Zoho, check where it lands. Add an exact mapping with `STATUS_MAP` (JSON), e.g. `{"Waiting on client":"BLOCKED"}`. `npm run zoho:discover` lists every status name in use.
4. **Client mapping.** Client name comes from, in order: a task tag `client:Name`; then a Settings override; then the project's *Client* custom field; then the project name with its code removed. Client or Internal comes from the *Client Type* custom field. New projects in Zoho appear automatically. Check **Settings → Client mapping** after creating one.
5. **Zoho refresh token revoked.** Every sync fails with "Zoho token refresh failed". Fix: an admin clicks **Settings → Reconnect**. If Zoho returns no refresh token, remove the app under accounts.zoho.in → Connected Apps first, then reconnect.
6. **Webhook disabled by Zoho.** Zoho switches a webhook off after 20 failures in a day. Updates then only arrive with the 15-minute sync. Re-enable it in Zoho → Automation → Webhooks.
7. **Keep replicas at 1.** The scheduler runs inside the web process. The Postgres lock stops double syncs, but more replicas add nothing and multiply Zoho API calls.
8. **Railway billing.** This service shares the `growthmak-dashboard` project's plan. If credit runs out, both dashboards stop.

---

## 8. Repo layout

```
railway.json            Railway build/start commands, health check, restart policy
package.json            scripts: build, start, test, test:e2e, check, zoho:discover, zoho:sync, db:seed-demo
prisma/schema.prisma    data model; prisma/migrations/ = applied on every boot
instrumentation.ts      boots the scheduler when the server starts
app/(app)/overview      manager view          app/(app)/people/[id], app/(app)/me   individual dashboards
app/(app)/reports       monthly PDFs           app/(app)/settings                   connections, mapping, access, job log
app/healthz             health check (checks the database)
app/api/auth/*          Zoho sign-in, connect, logout (demo login only when DEMO_MODE=true)
app/api/webhooks/zoho   Zoho task webhook      app/api/reports/[month]  PDF download   app/api/cron/[job]  optional triggers
app/actions.ts          server actions: comments, reviews, overrides, roles, sync now, Cliq test
lib/config.ts           every env variable and its default
lib/zoho/               client.ts (OAuth, rate limit, pagination), normalize.ts (field mapping), sync.ts
lib/confidence.ts       the confidence rules        lib/metrics.ts  month views, KPIs, insights
lib/jobs/               scheduler.ts, confidence.ts (re-score + Cliq), monthEnd.ts (snapshot + PDF)
lib/report.tsx          the PDF                     lib/lock.ts     Postgres lease lock
scripts/                check-connections.ts, zoho-discover.ts, zoho-sync.ts, seed-demo.ts
test/                   run-e2e.mts + mocks.mts (end-to-end), lib/confidence.test.ts (unit)
README.md               full manual
```

---

## 9. Setting it up from scratch (first deploy, or if the service is ever lost)

1. **GitHub:** push this code to `zayhangrowthmak/Growthmak-Task-Monitor` with GitHub Desktop (§2).
2. **Railway:** open the `growthmak-dashboard` project → **+ Create → GitHub Repo** → pick `Growthmak-Task-Monitor`. Railway's GitHub App needs access to the repo. Rename the service to `task-monitor`.
3. **Domain:** service → **Settings → Networking → Generate Domain**. Copy it; this is `APP_URL`. Keep **Replicas = 1**.
4. **Zoho app:** api-console.zoho.in → **Add Client → Server-based Applications**.
   - Homepage URL: `APP_URL`
   - Redirect URI: `APP_URL/api/auth/callback`
   - Copy the Client ID and Secret.
5. **Cliq:**
   - Create the alerts channel.
   - Get its unique name from the channel → More info → Connectors.
   - Generate a token: profile → Bots & Tools → Webhook Tokens.
6. **Variables:** service → Variables → **Raw Editor**. Paste `.env.example`, fill in the values from §5, then click **Deploy**.
7. **Connect:**
   1. Open `APP_URL` → **Sign in with Zoho** (an `ADMIN_EMAILS` account).
   2. **Settings → Connect Zoho Projects** → Accept. The first sync runs right away.
   3. Check **Client mapping**.
   4. **Send test message** to Cliq.
8. **Webhook:** Zoho Projects → Settings → Automation → **Webhooks → Tasks → Add**.
   - URL: `APP_URL/api/webhooks/zoho?secret=<ZOHO_WEBHOOK_SECRET>`, method POST
   - Append `task_id` and `project_id`
   - Attach it to a workflow rule on task create and update.
9. **Verify** (§6), then fill in the `‹…›` values at the top of this file and commit it.
