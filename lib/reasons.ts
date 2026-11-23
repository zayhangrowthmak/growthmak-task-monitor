// Delay reasons and the manager's review of them.
// A team member gives a reason for a slipped task; a manager agrees, disagrees, or asks for proof
// (an official email to the manager with the CC list copied). Every step is posted on the Zoho task.
import type { SlipReason, User } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { slipLabel } from "./status";
import { currentMonth } from "./time";
import { getSettings } from "./settings";
import { enqueue, mention } from "./cliq";
import { addComment } from "./zoho/write";
import { config } from "./config";

export const VERDICT_LABEL = {
  PENDING: "Waiting for review",
  AGREED: "Agreed",
  DISAGREED: "Disagreed",
  PROOF_REQUESTED: "Proof requested",
  PROOF_SENT: "Proof sent — waiting for review",
} as const;

/** Queue a comment for the Zoho task. Sent by the scheduler right away; retried if Zoho is unreachable. */
export async function queueZohoComment(taskId: string, text: string, source: string, requestedById?: string | null) {
  const t = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true, key: true } });
  if (!t) return;
  await prisma.zohoChange.create({
    data: { kind: "ADD_COMMENT", taskId, projectId: t.projectId, payload: { text }, summary: `${t.key ?? taskId}: comment — ${text.slice(0, 90)}`, source, requestedById: requestedById ?? null, auto: true },
  });
}

/** Send queued comments. Called by the scheduler and straight after an action. Backs off after repeated failures. */
export async function flushZohoComments(limit = 20) {
  const due = await prisma.zohoChange.findMany({
    where: { auto: true, kind: "ADD_COMMENT", status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 12 } },
    orderBy: { requestedAt: "asc" },
    take: limit,
  });
  let sent = 0;
  for (const ch of due) {
    // after a failure, wait 2^attempts minutes (capped at ~2 hours) before trying again
    if (ch.status === "FAILED" && ch.decidedAt && Date.now() - ch.decidedAt.getTime() < Math.min(120, 2 ** ch.attempts) * 60_000) continue;
    try {
      await addComment(ch.projectId, ch.taskId!, (ch.payload as any).text);
      await prisma.zohoChange.update({ where: { id: ch.id }, data: { status: "APPLIED", decidedAt: new Date(), error: null, attempts: { increment: 1 } } });
      sent++;
    } catch (e: any) {
      await prisma.zohoChange.update({ where: { id: ch.id }, data: { status: "FAILED", decidedAt: new Date(), error: String(e?.message ?? e).slice(0, 400), attempts: { increment: 1 } } });
    }
  }
  return sent;
}

const taskLink = (taskId: string) => `${config.appUrl}/tasks/${taskId}`;

/** A team member gives (or changes) the reason a task slipped. Opens a review for the managers. */
export async function submitReason(user: User, taskId: string, reason: SlipReason, note: string | null) {
  await prisma.task.update({ where: { id: taskId }, data: { slipReason: reason, slipNote: note, slipAt: new Date() } });
  // A new reason replaces one still waiting; reviewed ones stay as history
  await prisma.reasonReview.deleteMany({ where: { taskId, status: "PENDING" } });
  const r = await prisma.reasonReview.create({ data: { taskId, month: currentMonth(), reason, note, submittedById: user.id } });
  await queueZohoComment(taskId, `Delay reason (via Task Monitor, ${user.name}): ${slipLabel(reason)}${note ? ` — ${note}` : ""}`, "reason", user.id);
  await audit(user, "reason.submit", "ReasonReview", r.id, { reason, note });
  return r;
}

type Verdict = "AGREED" | "DISAGREED" | "PROOF_REQUESTED";

/** A manager decides. Asking for proof tags the person in Cliq with what to send and to whom. */
export async function decideReason(admin: User, id: string, verdict: Verdict, managerNote: string | null) {
  const r = await prisma.reasonReview.findUnique({ where: { id }, include: { task: { include: { assignees: { include: { user: true } } } }, submittedBy: true } });
  if (!r) throw new Error("Reason not found");
  if (verdict === "PROOF_REQUESTED" && !managerNote) throw new Error("Say what proof you need");
  const now = new Date();
  await prisma.reasonReview.update({
    where: { id },
    data: { status: verdict, managerNote, decidedById: admin.id, decidedAt: now, ...(verdict === "PROOF_REQUESTED" ? { proofAskedAt: now, proofSentAt: null, proofNote: null } : {}) },
  });
  const key = r.task.key ?? r.task.id;
  const who = r.submittedBy ?? r.task.assignees[0]?.user ?? null;
  const s = await getSettings();
  const cc = s.ccEmails.filter((e) => e.toLowerCase() !== admin.email.toLowerCase());

  if (verdict === "PROOF_REQUESTED") {
    await queueZohoComment(r.taskId, `${admin.name} asked for proof of the delay reason: ${managerNote}. Please email ${admin.email}${cc.length ? ` (CC ${cc.join(", ")})` : ""}.`, "reason", admin.id);
    await enqueue({
      kind: "proof",
      taskId: r.taskId,
      text: [
        `[PROOF NEEDED] ${key} ${r.task.name}`,
        `${who ? mention(who) : "Team"}, ${admin.name} needs proof for the delay reason "${slipLabel(r.reason)}${r.note ? ` — ${r.note}` : ""}".`,
        `What's needed: ${managerNote}`,
        `Please send an official email to ${admin.email}${cc.length ? ` with CC ${cc.join(", ")}` : ""}, then mark it sent in the Task Monitor: ${taskLink(r.taskId)}`,
      ].join("\n"),
      ignoreQuiet: false,
    });
  } else {
    await queueZohoComment(r.taskId, `Delay reason ${verdict === "AGREED" ? "agreed" : "disagreed"} by ${admin.name}${managerNote ? `: ${managerNote}` : ""}`, "reason", admin.id);
    if (verdict === "DISAGREED" && who) {
      await enqueue({
        kind: "proof",
        taskId: r.taskId,
        text: [`[REASON DISAGREED] ${key} ${r.task.name}`, `${mention(who)}, ${admin.name} disagreed with "${slipLabel(r.reason)}"${managerNote ? `: ${managerNote}` : "."}`, taskLink(r.taskId)].join("\n"),
      });
    }
  }
  await audit(admin, `reason.${verdict.toLowerCase()}`, "ReasonReview", id, { task: key, note: managerNote });
}

/** The team member confirms they sent the proof email. Goes back to the managers. */
export async function markProofSent(user: User, id: string, note: string | null) {
  const r = await prisma.reasonReview.findUnique({ where: { id }, include: { task: { include: { assignees: true } } } });
  if (!r || r.status !== "PROOF_REQUESTED") throw new Error("No proof was requested");
  const mine = r.submittedById === user.id || r.task.assignees.some((a) => a.userId === user.id);
  if (!mine && user.role !== "ADMIN") throw new Error("Not your task");
  await prisma.reasonReview.update({ where: { id }, data: { status: "PROOF_SENT", proofSentAt: new Date(), proofNote: note } });
  await queueZohoComment(r.taskId, `Proof emailed by ${user.name}${note ? `: ${note}` : ""}`, "reason", user.id);
  await audit(user, "reason.proof_sent", "ReasonReview", id, { note });
}

/** Counts for the nav badge: reasons a manager needs to look at. */
export const reasonsToReview = () => prisma.reasonReview.count({ where: { status: { in: ["PENDING", "PROOF_SENT"] } } });
