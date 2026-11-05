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
  const { loadTasks, monthView, computeMetrics, groupByClient, periodData } = await import("../lib/metrics");
  const { closePreviousMonthIfNeeded, generateReport } = await import("../lib/jobs/monthEnd");
  const { currentMonth, addMonths, monthRange } = await import("../lib/time");
  const webhook = await import("../app/api/webhooks/zoho/route");
  const health = await import("../app/healthz/route");
  const { NextRequest } = await import("next/server");

  console.log("\nSync");
  let detail = "";
  await check("full sync runs and reports counts", async () => {
    detail = await fullSync();
    assert.match(detail, /2 active projects \(of 3 in Zoho\), 7 tasks, 0 alerts/);
  });
  await check("archived projects are stored but not synced", async () => {
    const p = await prisma.project.findUnique({ where: { id: "13" } });
    assert.equal(p?.active, false);
    assert.equal(await prisma.task.count({ where: { projectId: "13" } }), 0);
  });
  await check("pagination: tasks from both pages are stored", async () => {
    assert.equal(await prisma.task.count({ where: { projectId: "11" } }), 7);
  });
  await check("cancelled tasks drop out of the numbers", async () => {
    assert.equal((await prisma.task.findUnique({ where: { id: "106" } }))?.deleted, true);
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
    const tasks = await loadTasks();
    const byClient = groupByClient(monthView(tasks, "all"), true);
    assert.ok(byClient.find((c) => c.name === "AdinNYC" && c.type === "CLIENT"));
    assert.ok(byClient.find((c) => c.name === "Eurofins" && c.type === "CLIENT"));
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
    assert.equal(await prisma.task.count(), 7);
    assert.equal(await prisma.taskAssignee.count(), 6);
    assert.equal(mock.cliqPosts.length, 0);
  });
  await check("two syncs at once: only one runs", async () => {
    const [a, b] = await Promise.all([fullSync(), fullSync()]);
    assert.ok([a, b].some((r) => /already running/.test(r)), `got: ${a} | ${b}`);
  });

  console.log("\nWebhook + Cliq");
  await check("webhook refuses a wrong secret", async () => {
    const res = await webhook.POST(new NextRequest("https://x/api/webhooks/zoho?secret=nope", { method: "POST", body: "{}" }));
    assert.equal(res.status, 401);
  });
  await check("webhook re-syncs the task and posts one Cliq alert when it worsens", async () => {
    mock.setTaskStatus("101", { name: "Blocked - waiting on client", is_closed_type: false });
    const res = await webhook.POST(
      new NextRequest("https://x/api/webhooks/zoho?secret=hook-secret", { method: "POST", body: JSON.stringify({ task_id: "101", project_id: "11" }) })
    );
    assert.equal(res.status, 200);
    assert.equal((await t("101")).confidence, "AT_RISK");
    assert.equal(mock.cliqPosts.length, 1);
    assert.match(mock.cliqPosts[0], /At Risk.*EUR-T101/);
    assert.match(mock.cliqPosts[0], /Client: AdinNYC/);
  });
  await check("no repeat alert while a task stays At Risk", async () => {
    await syncOneTask("11", "101");
    assert.equal(mock.cliqPosts.length, 1);
  });
  await check("more than 5 alerts at once become one digest", async () => {
    const past = new Date(Date.now() - 5 * 86_400_000);
    for (let i = 0; i < 6; i++) {
      await prisma.task.create({
        data: { id: `d${i}`, projectId: "11", name: `Digest ${i}`, zohoStatus: "In Progress", bucket: "IN_PROGRESS", dueDate: past, confidence: "ON_TRACK" },
      });
    }
    await refreshConfidence();
    assert.equal(mock.cliqPosts.length, 2);
    assert.match(mock.cliqPosts[1], /6 tasks changed confidence/);
    await prisma.task.deleteMany({ where: { id: { startsWith: "d" } } });
  });

  console.log("\nMetrics, month end, report");
  await check("current month metrics: counts, missed, completion", async () => {
    const items = monthView(await loadTasks(), currentMonth());
    const m = computeMetrics(items, true);
    assert.equal(m.total, 6);
    assert.equal(m.completed, 1);
    assert.equal(m.overdueOpen, 1);
  });
  await check("people removed in Settings disappear with their tasks", async () => {
    const vahid = await prisma.user.findUnique({ where: { email: "vahid@growthmaksolutions.com" } });
    await prisma.user.update({ where: { id: vahid!.id }, data: { active: false } });
    const d = await periodData(currentMonth());
    assert.ok(!d.people.find((p) => p.name === "Vahid"));
    assert.ok(!d.items.find((i) => i.task.id === "102"), "a task only Vahid had is gone");
    assert.ok(!d.items.some((i) => i.task.assignees.some((a) => a.user.name === "Vahid")), "no Vahid names anywhere");
    assert.ok(d.items.find((i) => i.task.id === "107"), "unassigned tasks stay");
    await prisma.user.update({ where: { id: vahid!.id }, data: { active: true } });
  });
  await check("periodData builds insights for the overview", async () => {
    const d = await periodData(currentMonth());
    assert.ok(d.insights.length > 0);
    assert.ok(d.people.find((p) => p.name === "Sandeep"));
  });
  await check("month end: snapshot + PDF once, then no-op", async () => {
    const last = addMonths(currentMonth(), -1);
    await prisma.task.create({
      data: { id: "prev1", projectId: "11", name: "Last month task", zohoStatus: "Completed", bucket: "COMPLETED", isClosed: true, dueDate: new Date(monthRange(last).start.getTime() + 5 * 86_400_000), completedAt: new Date(monthRange(last).start.getTime() + 4 * 86_400_000), createdAtZoho: monthRange(last).start },
    });
    assert.equal(await closePreviousMonthIfNeeded(), last);
    assert.ok(await prisma.monthlySnapshot.findUnique({ where: { month_scope: { month: last, scope: "overall" } } }));
    assert.equal(await closePreviousMonthIfNeeded(), null);
    const pdf = await generateReport(last);
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
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
