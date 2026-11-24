// Task updates: Zoho comment threads for the tasks the managers follow, and replies/follow-ups
// from the dashboard that are posted back onto the Zoho task (the team only ever works in Zoho).
//
// API budget: only a narrow set of tasks is followed (this month's open planned deliverables plus
// open overdue tasks). Their comments are re-read a few at a time in rotation, oldest-checked first,
// so the dashboard never spends more than a handful of Zoho calls per scheduler tick.
import type { User } from "@prisma/client";
import { prisma, getState, setState } from "./db";
import { currentMonth } from "./time";
import { addComment, listComments } from "./zoho/write";
import { enqueue, mention } from "./cliq";
import { audit } from "./audit";

const OPEN = { isClosed: false, deleted: false, bucket: { notIn: ["COMPLETED", "BACKLOG", "CLOSED"] as any } };

/** The followed tasks: open deliverables in this month's plan, and open tasks past their due date. */
export async function followedTasks(now = new Date()) {
  const plan = await prisma.monthPlan.findUnique({ where: { month: currentMonth(now) }, include: { items: { where: { removedAt: null }, select: { taskId: true } } } });
  const planned = new Set(plan?.items.map((i) => i.taskId) ?? []);
  const rows = await prisma.task.findMany({
    where: { ...OPEN, project: { active: true }, OR: [{ id: { in: [...planned] } }, { dueDate: { lt: now } }] },
    select: { id: true },
  });
  return { ids: rows.map((r) => r.id), planned };
}
export const followedTaskIds = async (now = new Date()) => (await followedTasks(now)).ids;

/** Read one task's comments from Zoho into the cache. */
export async function refreshComments(taskId: string) {
  const t = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, projectId: true } });
  if (!t) return 0;
  const items = await listComments(t.projectId, t.id);
  for (const c of items) {
    const data = { taskId: t.id, author: c.author, authorId: c.authorId ? String(c.authorId) : null, text: c.text, raw: c.raw, at: c.at ?? new Date(), fromDashboard: /via Task Monitor/.test(c.text) };
    await prisma.zohoComment.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
  }
  // Comments deleted in Zoho disappear here too (only within the window Zoho returned)
  if (items.length < 50) await prisma.zohoComment.deleteMany({ where: { taskId: t.id, id: { notIn: items.map((c) => c.id) } } });
  const newest = items[0]?.at ?? null;
  await prisma.task.update({ where: { id: t.id }, data: { commentsCheckedAt: new Date(), lastCommentAt: newest } });
  return items.length;
}

/** Scheduler: refresh the followed tasks that were checked longest ago, a few per tick. */
export async function refreshDueComments(limit = 10) {
  const ids = await followedTaskIds();
  if (!ids.length) return 0;
  const due = await prisma.task.findMany({
    where: { id: { in: ids }, OR: [{ commentsCheckedAt: null }, { commentsCheckedAt: { lt: new Date(Date.now() - 20 * 60_000) } }] },
    orderBy: [{ commentsCheckedAt: { sort: "asc", nulls: "first" } }],
    select: { id: true },
    take: limit,
  });
  let n = 0;
  for (const t of due) {
    try {
      await refreshComments(t.id);
      n++;
    } catch (e) {
      console.error("[updates] comments", t.id, e);
      await prisma.task.update({ where: { id: t.id }, data: { commentsCheckedAt: new Date() } }); // try again next cycle
    }
  }
  return n;
}

/** Queue a comment for the Zoho task. Sent straight away by flushZohoComments, retried if Zoho is unreachable. */
export async function queueZohoComment(taskId: string, text: string, source: string, requestedById?: string | null) {
  const t = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true, key: true } });
  if (!t) return;
  await prisma.zohoChange.create({
    data: { kind: "ADD_COMMENT", taskId, projectId: t.projectId, payload: { text }, summary: `${t.key ?? taskId}: comment — ${text.slice(0, 90)}`, source, requestedById: requestedById ?? null, auto: true },
  });
}

/** Post queued comments to Zoho. Backs off after repeated failures. */
export async function flushZohoComments(limit = 20) {
  const due = await prisma.zohoChange.findMany({
    where: { auto: true, kind: "ADD_COMMENT", status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 12 } },
    orderBy: { requestedAt: "asc" },
    take: limit,
  });
  let sent = 0;
  for (const ch of due) {
    if (ch.status === "FAILED" && ch.decidedAt && Date.now() - ch.decidedAt.getTime() < Math.min(120, 2 ** ch.attempts) * 60_000) continue;
    try {
      await addComment(ch.projectId, ch.taskId!, (ch.payload as any).text);
      await prisma.zohoChange.update({ where: { id: ch.id }, data: { status: "APPLIED", decidedAt: new Date(), error: null, attempts: { increment: 1 } } });
      sent++;
      await refreshComments(ch.taskId!).catch(() => null); // show it in the thread right away
    } catch (e: any) {
      await prisma.zohoChange.update({ where: { id: ch.id }, data: { status: "FAILED", decidedAt: new Date(), error: String(e?.message ?? e).slice(0, 400), attempts: { increment: 1 } } });
    }
  }
  return sent;
}

/**
 * A manager replies or follows up on a task. The text goes onto the Zoho task as a comment
 * (with "@Name" for each person tagged), and the tagged people are pinged in Cliq so they see it.
 */
export async function postUpdate(user: User, taskId: string, text: string, tagUserIds: string[], kind: "reply" | "follow_up") {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Task not found");
  const tagged = tagUserIds.length ? await prisma.user.findMany({ where: { id: { in: tagUserIds } } }) : [];
  const body = `${tagged.map((u) => `@${u.name}`).join(" ")}${tagged.length ? " " : ""}${text.trim()}`;
  await queueZohoComment(taskId, `${body}\n— ${user.name} (via Task Monitor)`, kind, user.id);
  if (tagged.length) {
    // Into the task's alert thread when there is one, else a plain post
    await enqueue({
      kind: "reply",
      taskId,
      month: currentMonth(),
      ignoreQuiet: false,
      text: [
        `[${kind === "follow_up" ? "FOLLOW UP" : "REPLY"}] ${task.key ?? ""} ${task.name}`.trim(),
        `${tagged.map(mention).join(" ")} ${user.name}: ${text.trim()}`,
        `Please reply on the Zoho task${task.url ? `: ${task.url}` : "."}`,
      ].join("\n"),
    });
  }
  await audit(user, kind === "follow_up" ? "update.follow_up" : "update.reply", "Task", taskId, { text: text.slice(0, 200), tagged: tagged.map((u) => u.name) });
}

/** When this manager last opened Task updates (for the "new" count in the menu). */
export const seenKey = (userId: string) => `updates.seen.${userId}`;
export async function markUpdatesSeen(userId: string) {
  await setState(seenKey(userId), new Date().toISOString());
}
export async function newUpdatesCount(userId: string) {
  const seen = await getState(seenKey(userId));
  const since = seen ? new Date(seen) : new Date(Date.now() - 3 * 86_400_000);
  const ids = await followedTaskIds();
  return prisma.task.count({ where: { id: { in: ids }, lastCommentAt: { gt: since } } });
}
