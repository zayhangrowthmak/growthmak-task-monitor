// Task updates: the short list of tasks a manager should look at now — recently commented on,
// waiting in Review / QA, blocked, or newly created — and replies/follow-ups posted back onto the
// Zoho task (the team only ever works in Zoho).
//
// Recency rule: nothing older than 35 days shows up. A task is on the list when, within the window,
//   · someone commented on it in Zoho, or
//   · it sits in Review / QA or Blocked and something happened on it (status move, update, comment), or
//   · it was created in Zoho in the last 7 days.
// API budget: comments are re-read only for tasks that could qualify, a few per scheduler tick, and
// tasks Zoho reports as changed since we last read them go first.
import type { User, StatusBucket } from "@prisma/client";
import { prisma, getState, setState } from "./db";
import { currentMonth } from "./time";
import { addComment, listComments } from "./zoho/write";
import { enqueue, mention } from "./cliq";
import { audit } from "./audit";

const DAY = 86_400_000;
export const MAX_DAYS = 35;
export const NEW_TASK_DAYS = 7;
const OPEN = { isClosed: false, deleted: false, bucket: { notIn: ["COMPLETED", "BACKLOG", "CLOSED"] as any } };
const WATCH: StatusBucket[] = ["REVIEW", "BLOCKED"];

/** Tasks that could be on the list: open, and touched in the last 35 days (or in Review / Blocked). */
export async function candidateTasks(now = new Date()) {
  const since = new Date(now.getTime() - MAX_DAYS * DAY);
  return prisma.task.findMany({
    where: {
      ...OPEN,
      project: { active: true },
      OR: [{ lastCommentAt: { gte: since } }, { updatedAtZoho: { gte: since } }, { createdAtZoho: { gte: since } }, { bucket: { in: WATCH } }],
    },
    select: { id: true, bucket: true, updatedAtZoho: true, createdAtZoho: true, commentsCheckedAt: true, lastCommentAt: true },
  });
}

export type FeedWhy = "comment" | "review" | "blocked" | "new";
export type FeedItem = { taskId: string; activityAt: Date; why: FeedWhy[]; statusSince: Date | null };

/** The list itself, newest activity first. `days` narrows the window (never beyond 35). */
export async function feed(now = new Date(), days = MAX_DAYS): Promise<FeedItem[]> {
  const win = Math.min(MAX_DAYS, Math.max(1, days));
  const since = new Date(now.getTime() - win * DAY);
  const newSince = new Date(now.getTime() - Math.min(win, NEW_TASK_DAYS) * DAY);
  const cands = await candidateTasks(now);
  const moves = await prisma.statusChange.findMany({
    where: { taskId: { in: cands.map((c) => c.id) }, to: { in: WATCH } },
    orderBy: { at: "desc" },
    select: { taskId: true, to: true, at: true },
  });
  const movedAt = new Map<string, Date>();
  for (const m of moves) if (!movedAt.has(m.taskId)) movedAt.set(m.taskId, m.at);
  const out: FeedItem[] = [];
  for (const t of cands) {
    const statusSince = WATCH.includes(t.bucket) ? movedAt.get(t.id) ?? null : null;
    const activityAt = new Date(Math.max(...[t.lastCommentAt, t.updatedAtZoho, t.createdAtZoho, statusSince].map((d) => d?.getTime() ?? 0)));
    if (activityAt < since) continue;
    const why: FeedWhy[] = [];
    if (t.lastCommentAt && t.lastCommentAt >= since) why.push("comment");
    if (t.bucket === "REVIEW") why.push("review");
    if (t.bucket === "BLOCKED") why.push("blocked");
    if (t.createdAtZoho && t.createdAtZoho >= newSince) why.push("new");
    if (!why.length) continue;
    out.push({ taskId: t.id, activityAt, why, statusSince });
  }
  return out.sort((a, b) => b.activityAt.getTime() - a.activityAt.getTime());
}
export const feedTaskIds = async (now = new Date()) => (await feed(now)).map((f) => f.taskId);

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

/**
 * Scheduler: re-read Zoho comments on a few candidate tasks per tick. Order: never read; changed in
 * Zoho since we last read it; in Review / Blocked; then whoever was read longest ago. A task is not
 * re-read within 15 minutes.
 */
export async function refreshDueComments(limit = 10, now = new Date()) {
  const cands = await candidateTasks(now);
  const fresh = new Date(now.getTime() - 15 * 60_000);
  const rank = (t: (typeof cands)[number]) =>
    !t.commentsCheckedAt ? 0 : t.updatedAtZoho && t.updatedAtZoho > t.commentsCheckedAt ? 1 : WATCH.includes(t.bucket) ? 2 : 3;
  const due = cands
    .filter((t) => !t.commentsCheckedAt || t.commentsCheckedAt < fresh)
    .sort((a, b) => rank(a) - rank(b) || (a.commentsCheckedAt?.getTime() ?? 0) - (b.commentsCheckedAt?.getTime() ?? 0))
    .slice(0, limit);
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
  const ids = await feedTaskIds();
  // New comments from the team (not the managers' own replies) on tasks in the list
  return prisma.task.count({ where: { id: { in: ids }, zohoComments: { some: { at: { gt: since }, fromDashboard: false } } } });
}
