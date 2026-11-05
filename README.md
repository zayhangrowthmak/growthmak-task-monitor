# Growthmak Task Monitor

A monitoring dashboard built on Zoho Projects. It replaces the manual Deliverables Tracker
sheet: every task in every active Zoho project is pulled in automatically, and you can see, per
month, how much got done, what was on time, what slipped, what is stuck, and who it sits with.

Zoho stays the source of truth. The dashboard **never writes to Zoho**. It only adds:

- a **time-based confidence score** (On Track / Tight / At Risk) calculated from each task's dates
- **per-task comments** with a reason category, added during review calls
- a **monthly review** per person from the super admin: a 1–10 rating and an overall comment
- **Zoho Cliq alerts**, sent automatically when a task turns Tight or At Risk
- a **monthly PDF report**, available from the 1st of the following month

## Screens

| Screen | Who sees it | What's on it |
|---|---|---|
| **Overview** (`/overview`) | Managers / super admin | KPI tiles (completed %, on-time %, missed deadline %, blocked %, in progress %, total) each with the move vs last month; "what stands out" insights; tasks needing attention now; charts for 6-month trend, status mix by client and why work is pending; team table; client cards (click a card to see its tasks) |
| **Individual** (`/people/:id`) | Managers (person dropdown) | The same view a specialist sees, plus the monthly review form |
| **My dashboard** (`/me`) | Each specialist, own tasks only | Their KPIs and status split, the review they received, a read-only Kanban or list copy of their Zoho board. Click a task to read and add comments |
| **Reports** (`/reports`) | Managers | One PDF per finished month |
| **Settings** (`/settings`) | Managers | Connect Zoho, sync now, webhook URL, Cliq test, client mapping fixes, who is a manager, job log |

Every dashboard has a **Timeline** dropdown: any month, or All time.

## How the numbers work

**Which month a task belongs to:** the month of its due date. A task with no due date goes by its
creation date. A task also shows in a month if it was completed that month. Tasks still unfinished
from earlier months appear in later months marked **carried over**, until they're done.

**Status columns** (both Kanban and the metrics): Ready, In Progress, Blocked / Waiting, Review / QA,
Completed. Zoho status names are mapped by keywords: *wait/block/hold* → Blocked, *review/QA/UAT* →
Review, closed statuses → Completed, *cancelled* is excluded. Exact overrides go in `STATUS_MAP`.

**Missed deadline** = tasks overdue and still open + tasks finished after their due date. Both are
shown.
**On time** = finished on or before the due date (end of day, IST), out of finished tasks that have a
due date.
**Compared to last month:** for the month still running, the comparison is with the same day last
month, so a half-finished month isn't judged against a full one. For closed months it's month vs
month.
**Month end:** on the 1st, last month's numbers are frozen (snapshot) and its PDF is built, so later
edits in Zoho don't rewrite history.

### Confidence score (calculated, first rule that matches wins)

| Score | When |
|---|---|
| **At Risk** | past the due date and not done · Blocked/Waiting · flagged by the team · due today/tomorrow with < 50% done |
| **Tight** | due within 2 days and not finished · under 25% of the time window left · progress more than 40 points behind the share of time used |
| **On Track** | everything else |
| **No due date** | flagged separately, because time can't be tracked |

The time window runs from the task's start date (or its creation date) to the due date. Review/QA
counts as at least 90% done. Thresholds live in `lib/confidence.ts` (`RULES`). Scores are recalculated
on every sync and every 30 minutes, so they move as days pass even when nobody touches Zoho.

**Cliq alerts** fire when a task moves into Tight or At Risk from a better state. They aren't repeated
while the task stays there. If more than 5 change at once, one digest message is posted. The very
first sync sets the baseline silently, so the channel isn't flooded.

**Client name:** a task tag `client:Name` wins (use this for client work that sits inside the internal
Growthmak project). Next comes an override set in Settings, then the project's *Client* custom field,
then the project name with its code removed ("EUR - Eurofins" → Eurofins). Client vs Internal comes
from a *Client Type* custom field, an `internal` project tag, or `INTERNAL_CLIENT_NAMES`.

## Setup

### 1. Zoho API app (one time)
1. Go to **api-console.zoho.in** → Add Client → **Server-based Applications**.
2. Homepage URL: your Railway URL. Authorized redirect URI: `https://<your-app>/api/auth/callback`.
3. Copy the Client ID and Secret into `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET`.

This one app handles both team sign-in (scope `AaaServer.profile.Read`) and the read-only sync
connection (`ZohoProjects.portals/projects/tasks/users/timesheets.READ`).

### 2. Deploy on Railway
Follow **DEPLOYMENT.md**. It uses the same process as the Outreach dashboard: GitHub Desktop pushes to
`main`, and Railway deploys automatically into the `growthmak-dashboard` project. The app shares that
project's Postgres, in its own `task_monitor` schema (`DATABASE_URL=${{Postgres.DATABASE_URL}}?schema=task_monitor`),
and goes live once `/healthz` answers ok.

### 3. Connect and check
1. Open the app → **Sign in with Zoho** (with an `ADMIN_EMAILS` account).
2. **Settings → Connect Zoho Projects** and approve. The first full sync starts straight away and
   then repeats every 15 minutes.
3. Optional, to check the field mapping against your portal: run `railway run npm run zoho:discover`.
   It prints a raw project, a raw task and every status name in use.
4. **Settings → Client mapping**: check each project's client and type, and fix any mishaps.

### 4. Zoho webhook (instant updates)
Zoho Projects → Settings → Automation → **Webhooks → Tasks → Add Webhook**:
- URL: `https://<your-app>/api/webhooks/zoho?secret=<ZOHO_WEBHOOK_SECRET>`, method POST
- Append parameters `task_id` = task ID and `project_id` = project ID
- Attach it to a workflow rule on task create / update

The 15-minute full sync still runs as a safety net. Webhooks are limited to 2,000 a day.

### 5. Zoho Cliq channel
1. Create the dedicated channel (e.g. `#delivery-alerts`).
2. Channel → More info → **Connectors**: the API endpoint contains the channel's unique name →
   `CLIQ_CHANNEL`.
3. Your profile → **Bots & Tools → Webhook tokens → Generate** → `CLIQ_WEBHOOK_TOKEN`.
4. Settings → **Send test message**.

### Team sign-in
Everyone signs in with their own Zoho account. They're matched by email to the people the sync found
as task owners, so each specialist automatically sees their own tasks. Anyone in `ADMIN_EMAILS`, or
promoted in Settings, gets the manager view.

## Run locally / demo
```bash
cp .env.example .env        # set DATABASE_URL, SESSION_SECRET, DEMO_MODE=true
npm install
npx prisma migrate dev
npm run db:seed-demo        # demo data modelled on the tracker sheet
npm run dev                 # http://localhost:3000 → pick a person to view as
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/gm_test npm test   # unit + end-to-end suite
npm run check               # test connections, writes nothing
```

## Code map
- `lib/zoho/` — API client (OAuth refresh, rate limit, pagination), defensive field normaliser, sync
- `lib/confidence.ts` — the scoring rules · `lib/metrics.ts` — month views, KPIs, insights
- `lib/jobs/` — in-process scheduler, confidence + Cliq alerts, month-end snapshot + PDF
- `lib/report.tsx` — the PDF · `app/` — pages, API routes, server actions · `prisma/` — schema
