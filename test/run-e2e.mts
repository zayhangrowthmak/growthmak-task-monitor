// End-to-end suite: real Postgres + the real sync/scoring/report code, against
// mock Zoho Projects and Cliq (test/mocks.ts). Each run creates its own fresh
// schema (e2e_<timestamp>) in the test database, migrates it, and drops only
// that schema at the end — existing data is never touched.
//
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/gm_test npm run test:e2e
//
// Refuses to run without TEST_DATABASE_URL, or if it doesn't look like a test database.
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import { startMock } from "./mocks.mjs";

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  console.error("Refusing to run: set TEST_DATABASE_URL to a disposable Postgres database (its name must contain 'test').");
  process.exit(2);
}
const dbName = new URL(TEST_DB).pathname.slice(1);
if (!/test/i.test(dbName) || /railway|rlwy/i.test(TEST_DB)) {
  console.error(`Refusing to run: '${dbName}' doesn't look like a disposable test database.`);
  process.exit(2);
}

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failures.push(name);
    console.log(`  ✕ ${name}\n      ${String(e?.message ?? e).split("\n").join("\n      ")}`);
  }
}

async function main() {
  const mock = await startMock();
  const schema = `e2e_${Date.now()}`;
  const u = new URL(TEST_DB!);
  u.searchParams.set("schema", schema);
  Object.assign(process.env, {
    DATABASE_URL: u.toString(),
    DEMO_MODE: "false",
    RUN_JOBS: "false",
    APP_URL: "https://task-monitor.test",
    SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
    ADMIN_EMAILS: "mohammed@growthmaksolutions.com",
    ZOHO_CLIENT_ID: "mock-id",
    ZOHO_CLIENT_SECRET: "mock-secret",
    ZOHO_REFRESH_TOKEN: "mock-refresh",
    ZOHO_ACCOUNTS_URL: mock.url,
    ZOHO_PROJECTS_API: mock.url,
    ZOHO_WEBHOOK_SECRET: "hook-secret",
    CLIQ_API_BASE: mock.url,
    CLIQ_CHANNEL: "delivery-alerts",
    CLIQ_WEBHOOK_TOKEN: "mock-cliq-token",
    ZOHO_MAIL_API: mock.url,
    ZOHO_MAIL_REFRESH_TOKEN: "mock-mail-refresh",
    FEEDBACK_EMAIL: "zayhan@growthmak.com",
  });

  console.log(`Migrating fresh schema ${schema}…`);
  execSync("npx prisma migrate deploy", { env: process.env, stdio: "pipe" });

  // Import only after env is set: config and Prisma read it at load time
  const { prisma } = await import("../lib/db");
  const { fullSync, syncOneTask } = await import("../lib/zoho/sync");
  const { refreshConfidence } = await import("../lib/jobs/confidence");
  const { loadTasks, monthData, groupByClient, groupByPerson } = await import("../lib/metrics");
  const { refreshPlan, lockPlan } = await import("../lib/plan");
  const { decide, applyChange, rejectChange } = await import("../lib/review");
  const { runAlerts, postMonthlyReport } = await import("../lib/jobs/alerts");
  const { flushOutbox, enqueue } = await import("../lib/cliq");
  const { saveSettings } = await import("../lib/settings");
  const { closePreviousMonthIfNeeded, generateReport } = await import("../lib/jobs/monthEnd");
  const { currentMonth, addMonths, monthRange, IST_OFFSET_MS } = await import("../lib/time");
  const DAY = 86_400_000;
  const isoIst = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const webhook = await import("../app/api/webhooks/zoho/route");
  const health = await import("../app/healthz/route");
  const { NextRequest } = await import("next/server");

  console.log("\nSync");
  let detail = "";
  await check("full sync runs and reports counts", async () => {
    detail = await fullSync();
    assert.match(detail, /2 active projects \(of 3 in Zoho\), 9 tasks, 0 alerts/);
  });
  await check("archived projects are stored but not synced", async () => {
    const p = await prisma.project.findUnique({ where: { id: "13" } });
    assert.equal(p?.active, false);
    assert.equal(await prisma.task.count({ where: { projectId: "13" } }), 0);
  });
  await check("pagination: tasks from both pages are stored", async () => {
    assert.equal(await prisma.task.count({ where: { projectId: "11" } }), 9);
  });
  await check("cancelled tasks are Closed and drop out of the numbers", async () => {
    assert.equal((await prisma.task.findUnique({ where: { id: "106" } }))?.bucket, "CLOSED");
    const d = await monthData(currentMonth());
    assert.ok(!d.rows.find((r) => r.task.id === "106"));
    assert.ok(d.closed.find((x) => x.id === "106"));
  });

  await check("list parsing accepts bare arrays and keyed objects", async () => {
    const { listFrom } = await import("../lib/zoho/client");
    assert.equal(listFrom([{ id: 1 }], "projects").length, 1);
    assert.equal(listFrom({ projects: [{ id: 1 }, { id: 2 }] }, "projects").length, 2);
    assert.equal(listFrom({ data: [{ id: 1 }] }, "projects").length, 1);
    assert.equal(listFrom({ page_info: {}, items: [{ id: 1 }] }, "projects").length, 1);
  });

  console.log("\nField mapping");
  const t = async (id: string) => (await prisma.task.findUnique({ where: { id }, include: { assignees: { include: { user: true } } } }))!;
  await check("key, description (HTML stripped), logged hours", async () => {
    const x = await t("101");
    assert.equal(x.key, "EUR-T101");
    assert.equal(x.description, "Write the blog post");
    assert.equal(x.loggedHours, 3.5);
  });
  await check("assignee matched by lower-cased email", async () => {
    assert.deepEqual((await t("101")).assignees.map((a) => a.user.email), ["sandeep@growthmaksolutions.com"]);
  });
  await check("status names map to the five columns", async () => {
    assert.equal((await t("101")).bucket, "IN_PROGRESS");
    assert.equal((await t("102")).bucket, "BLOCKED");
    assert.equal((await t("104")).bucket, "REVIEW");
    assert.equal((await t("105")).bucket, "COMPLETED");
    assert.equal((await t("109")).bucket, "BACKLOG");
    assert.equal((await t("102")).blockedType, "CLIENT");
  });
  await check("HTML entities in names are decoded", async () => {
    assert.equal((await t("104")).name, "Google & Meta Ads");
  });
  await check("'Unassigned User' is not treated as a person", async () => {
    assert.equal((await t("107")).assignees.length, 0);
    assert.equal(await prisma.user.count({ where: { name: { startsWith: "Unassigned" } } }), 0);
  });
  await check("project group name is not used as the client", async () => {
    const p = await prisma.project.findUnique({ where: { id: "11" } });
    assert.equal(p?.zohoClientName, null);
  });
  await check("client tag wins over project; project custom field sets the type", async () => {
    const { clientOf } = await import("../lib/clients");
    const [a] = await loadTasks({ id: "101" });
    const [b] = await loadTasks({ id: "103" });
    assert.equal(clientOf(a, a.project).name, "AdinNYC");
    assert.equal(clientOf(b, b.project).name, "Eurofins");
    assert.equal(clientOf(b, b.project).type, "CLIENT");
    const gm = await prisma.project.findUnique({ where: { id: "12" } });
    assert.equal(gm?.zohoClientType, "INTERNAL");
  });

  console.log("\nConfidence");
  await check("on track / blocked / overdue / review-due-tomorrow / done", async () => {
    assert.equal((await t("101")).confidence, "ON_TRACK");
    assert.equal((await t("102")).confidence, "AT_RISK");
    assert.match((await t("103")).confidenceReason ?? "", /Overdue by 3 days/);
    assert.equal((await t("104")).confidence, "TIGHT");
    assert.equal((await t("105")).confidence, "DONE");
  });
  await check("first sync is a silent baseline (no Cliq posts)", () => {
    assert.equal(mock.cliqPosts.length, 0);
  });
  await check("second sync is idempotent", async () => {
    await fullSync();
    assert.equal(await prisma.task.count(), 9);
    assert.equal(await prisma.taskAssignee.count(), 8);
    assert.equal(mock.cliqPosts.length, 0);
  });
  await check("two syncs at once: only one runs", async () => {
    const [a, b] = await Promise.all([fullSync(), fullSync()]);
    assert.ok([a, b].some((r) => /already running/.test(r)), `got: ${a} | ${b}`);
  });

  console.log("\nWebhook");
  await check("webhook refuses a wrong secret", async () => {
    const res = await webhook.POST(new NextRequest("https://x/api/webhooks/zoho?secret=nope", { method: "POST", body: "{}" }));
    assert.equal(res.status, 401);
  });

  // Fix the dates the v2 checks depend on to the last day of the current month
  const cur = currentMonth();
  const lastDay = isoIst(new Date(monthRange(cur).end.getTime() - DAY));
  const lastDayDate = new Date(`${lastDay}T00:00:00+05:30`);
  mock.setTaskFields("101", { end_date: lastDay });
  mock.setTaskFields("104", { end_date: lastDay });
  await fullSync();
  await saveSettings({ quietStart: 0, quietEnd: 0 }); // no quiet hours while testing
  const admin = await prisma.user.create({ data: { email: "mohammed@growthmaksolutions.com", name: "Mohammed", role: "ADMIN" } });
  const sandeep = (await prisma.user.findFirst({ where: { email: "sandeep@growthmaksolutions.com" } }))!;

  console.log("\nv2 · Plan, old tasks, backlog");
  await check("plan is created as a draft with time left to plan", async () => {
    const plan = await refreshPlan(cur, await loadTasks());
    assert.equal(plan.status, "DRAFT");
    assert.ok(plan.locksAt > new Date(), "a mid-month plan gets a planning window");
    assert.ok(plan.items.find((i) => i.taskId === "101" && i.source === "DUE_DATE"));
  });
  await check("an old open task is excluded from this month and listed for review", async () => {
    const d = await monthData(cur);
    assert.ok(!d.rows.find((r) => r.task.id === "108"));
    assert.ok(d.old.find((o) => o.task.id === "108" && !o.decision));
    assert.equal(d.metrics.oldPending, 1);
  });
  await check("backlog tasks are never planned", async () => {
    const d = await monthData(cur);
    assert.ok(d.backlog.find((x) => x.id === "109"));
    assert.ok(!d.rows.find((r) => r.task.id === "109"));
  });
  await check("Keep: counts in the plan at once, Zoho untouched until approved", async () => {
    await decide(sandeep, { taskId: "108", month: cur, decision: "KEEP", newDueDate: lastDayDate, note: "client sent copy" });
    assert.equal(mock.writes.length, 0, "no Zoho write yet");
    const ch = await prisma.zohoChange.findMany({ where: { taskId: "108" } });
    assert.equal(ch.length, 1);
    assert.equal(ch[0].status, "PENDING");
    await refreshPlan(cur, await loadTasks());
    const d = await monthData(cur);
    const row = d.rows.find((r) => r.task.id === "108");
    assert.ok(row, "kept task joins the plan");
    assert.equal(row!.source, "KEPT");
    assert.equal(isoIst(row!.plannedDue!), lastDay);
  });
  await check("approving the change updates Zoho and re-reads the task", async () => {
    const ch = (await prisma.zohoChange.findFirst({ where: { taskId: "108", status: "PENDING" } }))!;
    const r = await applyChange(admin, ch.id);
    assert.ok(r.ok, r.error);
    const w = mock.writes.find((x) => x.path.endsWith("/tasks/108"));
    assert.ok(w, "PATCH sent");
    assert.match(String(w!.body.end_date), new RegExp(`^${lastDay}`));
    assert.equal((await prisma.zohoChange.findUnique({ where: { id: ch.id } }))?.status, "APPLIED");
    assert.equal(isoIst((await t("108")).dueDate!), lastDay);
  });
  await check("rejecting a change leaves Zoho alone and undoes the decision", async () => {
    const before = mock.writes.length;
    await decide(sandeep, { taskId: "108", month: cur, decision: "CLOSE", note: "not needed" });
    const ch = (await prisma.zohoChange.findFirst({ where: { taskId: "108", status: "PENDING" } }))!;
    await rejectChange(admin, ch.id);
    assert.equal(mock.writes.length, before);
    assert.equal((await prisma.zohoChange.findUnique({ where: { id: ch.id } }))?.status, "REJECTED");
    assert.equal(await prisma.oldTaskReview.count({ where: { taskId: "108", month: cur } }), 0);
  });
  await check("audit log records decisions and approvals", async () => {
    const actions = (await prisma.auditLog.findMany()).map((a) => a.action);
    for (const a of ["review.keep", "zoho.apply", "review.close", "zoho.reject"]) assert.ok(actions.includes(a), `missing ${a}`);
  });

  console.log("\nv2 · Cliq");
  await check("first run of the month is a silent baseline", async () => {
    await runAlerts(new Date(), { silentBaseline: true });
    await flushOutbox();
    assert.equal(mock.cliqMessages.length, 0);
  });
  await check("blocked on client: one alert that tags the assignee and CCs Sandeep + Mohammed", async () => {
    mock.setTaskStatus("101", { name: "Blocked - waiting on client", is_closed_type: false });
    const res = await webhook.POST(
      new NextRequest("https://x/api/webhooks/zoho?secret=hook-secret", { method: "POST", body: JSON.stringify({ task_id: "101", project_id: "11" }) })
    );
    assert.equal(res.status, 200);
    await flushOutbox();
    assert.equal(mock.cliqMessages.length, 1, mock.cliqPosts.join("\n---\n"));
    const m = mock.cliqMessages[0].text;
    assert.match(m, /\[BLOCKED - CLIENT\]/);
    assert.match(m, /AdinNYC/);
    assert.match(m, /\{@sandeep@growthmaksolutions\.com\}/);
    assert.match(m, /CC: \{@sandeep@growthmak\.com\} \{@mohammed@growthmak\.com\}/);
  });
  await check("no repeat while the state stays the same", async () => {
    await syncOneTask("11", "101");
    await syncOneTask("11", "101");
    await flushOutbox();
    assert.equal(mock.cliqMessages.length, 1);
  });
  await check("completion is posted as a [DONE] reply in the alert's thread", async () => {
    mock.setTaskStatus("101", { name: "Completed", is_closed_type: true });
    mock.setTaskFields("101", { completed_time: new Date().toISOString() });
    await syncOneTask("11", "101");
    await flushOutbox();
    assert.equal(mock.cliqMessages.length, 2);
    const reply = mock.cliqMessages[1];
    assert.match(reply.text, /^\[DONE\]/);
    assert.match(reply.text, /on time/);
    assert.equal(reply.thread, mock.cliqMessages[0].id);
  });
  await check("backlog tasks never alert", () => {
    assert.ok(!mock.cliqMessages.some((m) => /Podcast idea/.test(m.text)));
  });
  await check("quiet hours hold posts until 09:00 IST", async () => {
    await saveSettings({ quietStart: 20, quietEnd: 9 });
    const night = new Date("2026-11-10T22:15:00+05:30");
    const row = await enqueue({ kind: "test", text: "hold me", at: night });
    assert.equal(row.notBefore.toISOString(), new Date("2026-11-11T09:00:00+05:30").toISOString());
    await prisma.cliqOutbox.delete({ where: { id: row.id } });
    await saveSettings({ quietStart: 0, quietEnd: 0 });
  });

  console.log("\nv2 · Metrics");
  await check("a planned task moved out of the month counts as slipped (moved)", async () => {
    await lockPlan(cur, await loadTasks(), admin);
    mock.setTaskFields("104", { end_date: isoIst(new Date(monthRange(cur).end.getTime() + 10 * DAY)) });
    await syncOneTask("11", "104");
    const d = await monthData(cur);
    const r = d.rows.find((x) => x.task.id === "104")!;
    assert.ok(r, "still in the locked plan");
    assert.equal(r.slip, "MOVED");
    assert.equal(r.state, "MOVED");
    assert.ok(d.metrics.slipMoved >= 1);
    assert.ok(await prisma.dueDateChange.count({ where: { taskId: "104" } }) >= 1, "due change logged");
  });
  await check("percentages carry their counts and flag small samples", async () => {
    const d = await monthData(cur);
    const p = d.metrics.delivery;
    assert.equal(p.d, d.metrics.planned);
    assert.equal(p.n, d.metrics.completed);
    assert.equal(p.small, p.d > 0 && p.d < 5);
  });
  await check("waiting on client is not counted against the person", async () => {
    const d = await monthData(cur);
    const vahidRow = d.rows.find((r) => r.task.id === "102");
    if (vahidRow) assert.equal(vahidRow.waitingClient, vahidRow.task.bucket === "BLOCKED" && !vahidRow.done);
    const people = await groupByPerson(d);
    const v = people.find((p) => p.name === "Vahid");
    if (v && vahidRow?.waitingClient) assert.ok(v.personSlipped <= v.metrics.slipped - 1 || v.metrics.slipped === 0);
  });
  await check("people removed in Settings disappear with their tasks", async () => {
    const vahid = await prisma.user.findUnique({ where: { email: "vahid@growthmaksolutions.com" } });
    await prisma.user.update({ where: { id: vahid!.id }, data: { active: false } });
    const d = await monthData(cur);
    const people = await groupByPerson(d);
    assert.ok(!people.find((p) => p.name === "Vahid"));
    assert.ok(!d.tasks.find((x) => x.id === "102"), "a task only Vahid had is gone");
    assert.ok(!d.tasks.some((x) => x.assignees.some((a) => a.user.name === "Vahid")));
    await prisma.user.update({ where: { id: vahid!.id }, data: { active: true } });
  });
  await check("by-client view groups the plan", async () => {
    const clients = await groupByClient(await monthData(cur));
    assert.ok(clients.find((c) => c.name === "AdinNYC"));
  });

  console.log("\nMonth end, report");
  await check("month end: report once, then no-op", async () => {
    const last = addMonths(cur, -1);
    await prisma.task.create({
      data: { id: "prev1", projectId: "11", name: "Last month task", zohoStatus: "Completed", bucket: "COMPLETED", isClosed: true, dueDate: new Date(monthRange(last).start.getTime() + 5 * DAY), completedAt: new Date(monthRange(last).start.getTime() + 4 * DAY), createdAtZoho: monthRange(last).start },
    });
    assert.equal(await closePreviousMonthIfNeeded(), last);
    assert.ok(await prisma.monthlyReport.findUnique({ where: { month: last } }));
    assert.equal(await closePreviousMonthIfNeeded(), null);
  });
  await check("report PDF renders for last month and the current month", async () => {
    const pdf = await generateReport(addMonths(cur, -1));
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    const { renderReportPdf, renderClientPdf } = await import("../lib/report");
    assert.equal(Buffer.from(await renderReportPdf(cur)).subarray(0, 4).toString(), "%PDF");
    assert.equal(Buffer.from(await renderClientPdf(cur, "AdinNYC")).subarray(0, 4).toString(), "%PDF");
  });
  await check("monthly report post tags recipients and attaches the PDF", async () => {
    const before = mock.cliqMessages.length;
    await postMonthlyReport(addMonths(cur, -1));
    await flushOutbox(generateReport);
    const post = mock.cliqMessages[before];
    assert.ok(post, "posted");
    assert.match(post.text, /^\[MONTHLY REPORT\]/);
    assert.match(post.text, /\{@mohammed@growthmak\.com\}/);
    assert.deepEqual(mock.cliqFiles, ["pdf"]);
  });

  console.log("\nFeedback");
  const { submitFeedbackFor } = await import("../lib/feedback");
  await check("feedback is saved and emailed to the admin via Zoho Mail", async () => {
    const user = (await prisma.user.findFirst({ where: { email: "sandeep@growthmaksolutions.com" } }))!;
    const r = await submitFeedbackFor(user, { type: "FEATURE", subject: "Show <hours> per client", message: "Would help planning", page: "/overview" });
    assert.equal(r.emailed, true);
    assert.equal(mock.mails.length, 1);
    assert.equal(mock.mails[0].toAddress, "zayhan@growthmak.com");
    assert.equal(mock.mails[0].fromAddress, "zayhan@growthmak.com");
    assert.match(mock.mails[0].subject, /\[Task Monitor · Feature request\] Show <hours> per client/);
    assert.match(mock.mails[0].content, /Show &lt;hours&gt; per client/, "HTML in user text is escaped");
    assert.match(mock.mails[0].content, /sandeep@growthmaksolutions.com/);
    assert.equal((await prisma.feedback.findUnique({ where: { id: r.id } }))?.emailed, true);
  });
  await check("if the email fails, feedback is still saved with the error", async () => {
    const user = (await prisma.user.findFirst({ where: { email: "sandeep@growthmaksolutions.com" } }))!;
    const r = await submitFeedbackFor(user, { type: "PROBLEM", subject: "FAIL please", message: "Broken thing" });
    assert.equal(r.emailed, false);
    const fb = await prisma.feedback.findUnique({ where: { id: r.id } });
    assert.ok(fb && !fb.emailed && /500/.test(fb.emailError ?? ""));
  });

  await check("/healthz answers ok with the database up", async () => {
    const res = await health.GET();
    assert.deepEqual(await res.json(), { ok: true });
  });

  await mock.close();
  if (process.env.KEEP_E2E_SCHEMA !== "true") await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
