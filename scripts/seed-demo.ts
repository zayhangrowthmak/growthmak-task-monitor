// Demo data modelled on the Growthmak Deliverables Tracker (Sep 2026 tab onward),
// so the dashboard can be previewed before Zoho is connected. Run with DEMO_MODE=true.
import { PrismaClient, type StatusBucket, type ReasonCategory } from "@prisma/client";
import { computeConfidence } from "../lib/confidence";
import { addMonths, currentMonth, monthRange, DAY } from "../lib/time";

const prisma = new PrismaClient();
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

const PEOPLE = [
  { name: "Mohammed", email: "mohammed@growthmaksolutions.com", role: "ADMIN" as const },
  { name: "Sandeep", email: "sandeep@growthmaksolutions.com" },
  { name: "Vahid", email: "vahid@growthmaksolutions.com" },
  { name: "Manaf", email: "manaf@growthmaksolutions.com" },
  { name: "Sreedharan", email: "sreedharan@growthmaksolutions.com" },
  { name: "Hari", email: "hari@growthmaksolutions.com" },
  { name: "Aakash", email: "aakash@growthmaksolutions.com" },
];

// prefix, project name, client override (null = from name), type, deliverables [title, assignees]
const PROJECTS: [string, string, string | null, "CLIENT" | "INTERNAL", [string, string[]][]][] = [
  ["EUR", "EUR - Eurofins", null, "CLIENT", [
    ["Track S&H and SuSe published blogs + monthly report", ["Sreedharan"]],
    ["Google Ads Maintenance for EUR", ["Sandeep"]],
    ["Eurofins Action Items", ["Sandeep"]],
    ["Eurofins C&PC Canada Campaign Launch", ["Sandeep", "Vahid"]],
  ]],
  ["KM", "KM - Kinetic Motorcycles", null, "CLIENT", [
    ["Google/Meta Ads Maintenance for KM", ["Sandeep"]],
    ["4 Blogs", ["Sreedharan"]],
    ["KM Off-Page Activity", ["Sreedharan"]],
    ["Image creatives for Google Ads", ["Manaf"]],
    ["KM Shopify Website Phase 2 and Launch", ["Sandeep", "Vahid"]],
  ]],
  ["SHBH", "SHBH - Shubh Healing", null, "CLIENT", [["Meta Ads Campaign Maintenance", ["Sandeep"]]]],
  ["ALS", "ALS - Amazing Lash Studios", null, "CLIENT", [
    ["Google and Meta Ads Maintenance for ALS", ["Sandeep"]],
    ["Meta Ads Call Only Campaign Automation", ["Sandeep", "Hari"]],
  ]],
  ["AWS", "AWS - American Wall Systems", null, "CLIENT", [["APW: Search Console manual submission for indexing", ["Sandeep"]]]],
  ["TFS", "TFS - The Fragrance Secrets", null, "CLIENT", [
    ["Google & Meta Ads Maintenance for TFS", ["Sandeep"]],
    ["12 months blog topics (SEO upsell)", ["Sreedharan"]],
    ["Website SEO/AEO/GEO Optimization", ["Sreedharan"]],
  ]],
  ["Z", "ZB - Zuve Beauty", null, "CLIENT", [
    ["Google/Meta Ads Campaign Launch", ["Sandeep"]],
    ["Website UIUX Change plan", ["Vahid", "Manaf"]],
    ["6 months blog topics and organic growth plan", ["Sreedharan"]],
  ]],
  ["T", "T - Technobriq", null, "CLIENT", [["Google Ads Maintenance", ["Sandeep"]]]],
  ["L", "L - Lighting Souq", null, "CLIENT", [
    ["Email to manufacturer for GTIN and product images", ["Sandeep"]],
    ["Meta and Google Ads strategy", ["Sandeep"]],
    ["Each page content + FAQs + CSV import", ["Sandeep", "Hari"]],
  ]],
  ["H", "H - Hydrosox", null, "CLIENT", [
    ["4 blogs", ["Sreedharan"]],
    ["Meta and Google Ads strategy", ["Sandeep"]],
  ]],
  ["CS", "CSAFI.ORG", null, "CLIENT", [
    ["CSAFI webinar link distribution", ["Sreedharan"]],
    ["2 Blogs", ["Sreedharan"]],
  ]],
  ["GM", "GM - Growthmak", "Growthmak", "INTERNAL", [
    ["GM: Paid Ads to increase awareness + leads", ["Sandeep"]],
    ["Social Media Posters", ["Sreedharan"]],
    ["Growthmak LinkedIn Newsletter content", ["Sreedharan"]],
    ["4 blog posts", ["Sreedharan"]],
    ["Client's detailed case studies", ["Sandeep"]],
    ["Video Creatives for Meta Ads", ["Aakash"]],
    ["client:AdinNYC|AdinNYC Website SEO Optimization", ["Sreedharan"]],
    ["client:Decoding Wisdom|Website CMS updates", ["Vahid"]],
    ["client:Urban Precision|Website CMS Integration", ["Vahid"]],
    ["client:Fairneuro Diagnostics|Form integration", ["Vahid"]],
    ["client:PlayPhone|Change Ledger development", ["Vahid"]],
  ]],
];

const COMMENTS: [ReasonCategory, string][] = [
  ["CLIENT_DEPENDENCY", "Waiting for client inputs (domain + app access). Followed up twice this week."],
  ["WAITING_APPROVAL", "Draft sent for review, client yet to approve."],
  ["INTERNAL_DELAY", "Picked up late because of another launch; will close by Friday."],
  ["RESOURCE_ABSENT", "Was on leave for 3 days."],
  ["TOOL_ACCESS", "No access to the ad account yet."],
  ["SCOPE_CHANGE", "Client changed the topics mid-way; redoing two pieces."],
  ["CLIENT_DEPENDENCY", "Payment issue on the client's side has paused the campaign."],
];

async function main() {
  await prisma.$transaction([
    prisma.alertLog.deleteMany(), prisma.taskComment.deleteMany(), prisma.taskAssignee.deleteMany(),
    prisma.task.deleteMany(), prisma.project.deleteMany(), prisma.monthlyReview.deleteMany(),
    prisma.monthlySnapshot.deleteMany(), prisma.monthlyReport.deleteMany(), prisma.user.deleteMany(),
  ]);
  const users = new Map<string, string>();
  for (const p of PEOPLE) {
    const u = await prisma.user.create({ data: { name: p.name, email: p.email, role: p.role ?? "MEMBER", zohoUserId: `zp-${p.name}` } });
    users.set(p.name, u.id);
  }
  const admin = users.get("Mohammed")!;

  const now = new Date();
  const cur = currentMonth(now);
  const months = [addMonths(cur, -2), addMonths(cur, -1), cur];
  let n = 1000;
  const counters: Record<string, number> = {};

  for (const [prefix, pname, clientOverride, type, deliverables] of PROJECTS) {
    const projectId = `p-${prefix}`;
    await prisma.project.create({
      data: {
        id: projectId, name: pname, prefix, active: true, zohoStatus: "Active",
        ownerName: "Aakash", ownerEmail: "aakash@growthmaksolutions.com",
        zohoClientName: clientOverride, zohoClientType: type,
        url: `https://projects.zoho.in/portal/growthmak#zp/projects/${projectId}`,
      },
    });
    for (const [mi, month] of months.entries()) {
      const { start, end } = monthRange(month);
      const isCur = month === cur;
      for (const [rawTitle, who] of deliverables) {
        if (rnd() < 0.12 && !isCur) continue; // not every deliverable every month
        const [clientTag, title] = rawTitle.includes("|") ? rawTitle.split("|") : [null, rawTitle];
        counters[prefix] = (counters[prefix] ?? 100 + Math.floor(rnd() * 150)) + 1;
        const key = `${prefix === "Z" ? "Z-1" : prefix === "T" || prefix === "L" || prefix === "H" ? `${prefix}-1` : prefix}-T${counters[prefix]}`;
        const startDate = new Date(start.getTime() + Math.floor(rnd() * 8) * DAY);
        const due = new Date(Math.min(end.getTime() - DAY, startDate.getTime() + (7 + Math.floor(rnd() * 18)) * DAY));
        let bucket: StatusBucket = "COMPLETED";
        let completedAt: Date | null = null;
        let pct = 100;
        const r = rnd();
        if (!isCur) {
          // past months: most done, some late, a few still open (carried over)
          if (r < 0.62) completedAt = new Date(due.getTime() - Math.floor(rnd() * 4) * DAY);
          else if (r < 0.82) completedAt = new Date(due.getTime() + (1 + Math.floor(rnd() * 9)) * DAY);
          else if (mi === 0 && r < 0.9) completedAt = new Date(end.getTime() + (3 + Math.floor(rnd() * 10)) * DAY);
          else { bucket = pick(["BLOCKED", "IN_PROGRESS", "BLOCKED", "REVIEW"] as StatusBucket[]); pct = Math.floor(rnd() * 70); }
          if (completedAt && completedAt > now) { bucket = "IN_PROGRESS"; completedAt = null; pct = 60; }
        } else {
          const dueCur = new Date(now.getTime() + (Math.floor(rnd() * 24) - 4) * DAY);
          due.setTime(Math.min(Math.max(dueCur.getTime(), start.getTime() + DAY), end.getTime() - DAY));
          startDate.setTime(Math.min(startDate.getTime(), due.getTime() - 3 * DAY));
          if (r < 0.16 && due < now) completedAt = new Date(due.getTime() - DAY);
          else if (r < 0.22) completedAt = new Date(Math.min(now.getTime() - DAY, due.getTime()));
          else {
            bucket = r < 0.4 ? "READY" : r < 0.72 ? "IN_PROGRESS" : r < 0.86 ? "BLOCKED" : "REVIEW";
            pct = bucket === "READY" ? 0 : bucket === "REVIEW" ? 90 : Math.floor(10 + rnd() * 60);
          }
          if (completedAt && completedAt > now) completedAt = new Date(now.getTime() - DAY);
          if (completedAt && completedAt < startDate) startDate.setTime(completedAt.getTime() - 5 * DAY);
        }
        const noDue = rnd() < 0.05;
        const closed = bucket === "COMPLETED";
        const conf = computeConfidence({ bucket, isClosed: closed, startDate, dueDate: noDue ? null : due, createdAt: startDate, completedAt, completionPct: pct }, now);
        const id = `t-${n++}`;
        await prisma.task.create({
          data: {
            id, projectId, key, name: title, description: `Deliverable for ${pname} — ${title}.`,
            zohoStatus: { READY: "Ready", IN_PROGRESS: "In Progress", BLOCKED: "Blocked / Waiting", REVIEW: "Review / QA", COMPLETED: "Completed" }[bucket],
            bucket, isClosed: closed, startDate, dueDate: noDue ? null : due, completedAt, completionPct: pct,
            loggedHours: Math.round(rnd() * 20 * 10) / 10, createdAtZoho: new Date(startDate.getTime() - DAY),
            updatedAtZoho: completedAt ?? now, createdByName: "Aakash", createdByEmail: "aakash@growthmaksolutions.com",
            tags: clientTag ? [clientTag] : [], clientFromTag: clientTag ? clientTag.replace(/^client:/, "") : null,
            url: `https://projects.zoho.in/portal/growthmak#zp/projects/${projectId}/tasks/task-detail/${id}`,
            confidence: conf.level, confidenceReason: conf.reason, confidenceAt: now,
            assignees: { create: who.map((w) => ({ userId: users.get(w)! })) },
          },
        });
        const late = (completedAt && completedAt > due) || (!closed && due < now);
        if ((bucket === "BLOCKED" || late) && rnd() < 0.8) {
          const [reason, text] = bucket === "BLOCKED" ? pick(COMMENTS.filter((c) => c[0] !== "RESOURCE_ABSENT")) : pick(COMMENTS);
          await prisma.taskComment.create({ data: { taskId: id, authorId: users.get(who[0])!, month, reason, text } });
        }
      }
    }
  }

  const last = addMonths(cur, -1);
  const notes: Record<string, [number, string]> = {
    Sandeep: [8, "Carries the most load across clients. Ads maintenance is consistent; launches slip on client dependencies — escalate earlier."],
    Vahid: [7, "Good delivery on CMS work. Website UI/UX plan has been open too long — needs a firm date."],
    Manaf: [7, "Creatives quality is good, but due dates are being missed by a few days."],
    Sreedharan: [9, "Blogs and SEO deliverables on time almost every week."],
    Hari: [6, "Automation task blocked on client access for weeks — needs a workaround plan."],
    Aakash: [6, "Video creatives still pending; set intermediate milestones."],
  };
  for (const [name, [rating, comment]] of Object.entries(notes)) {
    await prisma.monthlyReview.create({ data: { userId: users.get(name)!, reviewerId: admin, month: last, rating, comment } });
  }
  console.log(`Seeded ${n - 1000} demo tasks across ${PROJECTS.length} projects for ${months.join(", ")}`);
}

main().finally(() => prisma.$disconnect());
