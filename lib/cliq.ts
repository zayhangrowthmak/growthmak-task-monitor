// Zoho Cliq channel posting (webhook token / zapikey — no extra OAuth).
// Mentions use {@email}; thread replies use thread_message_id when Cliq gave us one.
import { config } from "./config";
import { prisma } from "./db";
import { getSettings } from "./settings";
import { outsideQuietHours } from "./workdays";

export const cliqConfigured = () => Boolean(config.cliq.channel && config.cliq.webhookToken);

const channelUrl = (path: "message" | "files") => {
  const url = new URL(`${config.cliq.apiBase}/api/v2/channelsbyname/${encodeURIComponent(config.cliq.channel)}/${path}`);
  url.searchParams.set("zapikey", config.cliq.webhookToken);
  if (config.cliq.botName) url.searchParams.set("bot_unique_name", config.cliq.botName);
  return url;
};

/** Post a message. With threadParentId it goes into that message's thread. */
export async function postToCliq(text: string, opts: { threadParentId?: string | null } = {}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (!cliqConfigured()) return { ok: false, error: "Cliq not configured (CLIQ_CHANNEL / CLIQ_WEBHOOK_TOKEN)" };
  const body: Record<string, unknown> = { text: text.slice(0, 4900), sync_message: true };
  if (opts.threadParentId) {
    body.thread_message_id = opts.threadParentId;
    body.post_in_parent = false;
  }
  try {
    const res = await fetch(channelUrl("message"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const raw = await res.text();
    if (!res.ok) return { ok: false, error: `${res.status} ${raw.slice(0, 200)}` };
    let messageId: string | undefined;
    try {
      const j = raw ? JSON.parse(raw) : {};
      messageId = j.message_id ?? j.id ?? j.data?.message_id ?? j.data?.id ?? j.message?.id;
    } catch {}
    return { ok: true, messageId: messageId ? String(messageId) : undefined };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** Upload a file (the monthly PDF) into the channel, with a comment. */
export async function uploadToCliq(file: Buffer, filename: string, comment: string): Promise<{ ok: boolean; error?: string }> {
  if (!cliqConfigured()) return { ok: false, error: "Cliq not configured" };
  try {
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(file)], { type: "application/pdf" }), filename);
    form.append("comments", JSON.stringify([comment.slice(0, 900)]));
    const res = await fetch(channelUrl("files"), { method: "POST", body: form });
    if (!res.ok) return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** Mention a person by their Cliq address (Settings mapping) or Zoho email. */
export const mention = (u: { email: string; cliqEmail?: string | null; name: string }) => (u.email.includes("@") || u.cliqEmail ? `{@${u.cliqEmail || u.email}}` : u.name);

export async function ccLine(): Promise<string> {
  const s = await getSettings();
  return s.ccEmails.length ? `CC: ${s.ccEmails.map((e) => `{@${e}}`).join(" ")}` : "";
}

/** Queue a post. Quiet hours (default 20:00–09:00 IST) hold it until the morning. */
export async function enqueue(p: { kind: string; text: string; taskId?: string; month?: string; state?: string; fileMonth?: string; at?: Date; ignoreQuiet?: boolean }) {
  const s = await getSettings();
  const at = p.at ?? new Date();
  const notBefore = p.ignoreQuiet ? at : outsideQuietHours(at, s.quietStart, s.quietEnd);
  return prisma.cliqOutbox.create({ data: { kind: p.kind, text: p.text, taskId: p.taskId, month: p.month, state: p.state, fileMonth: p.fileMonth, notBefore } });
}

/**
 * Send what's due. Task alerts become the parent of that task's thread; later updates for
 * the same task go into the thread (or as a plain message if Cliq gave no message id).
 */
export async function flushOutbox(renderPdf?: (month: string) => Promise<Buffer>): Promise<number> {
  if (!cliqConfigured()) return 0;
  const due = await prisma.cliqOutbox.findMany({ where: { sentAt: null, notBefore: { lte: new Date() }, attempts: { lt: 5 } }, orderBy: { createdAt: "asc" }, take: 20 });
  let sent = 0;
  for (const m of due) {
    let res: { ok: boolean; messageId?: string; error?: string };
    if (m.fileMonth && renderPdf) {
      const post = await postToCliq(m.text);
      const pdf = await renderPdf(m.fileMonth).catch((e) => {
        throw e;
      });
      const up = await uploadToCliq(pdf, `Growthmak_Deliverables_${m.fileMonth}.pdf`, `Monthly deliverables report — ${m.fileMonth}`);
      res = post.ok ? { ok: true, error: up.ok ? undefined : `PDF upload failed: ${up.error}` } : post;
    } else if (m.kind === "reply" && m.taskId && m.month) {
      const thread = await prisma.cliqMessage.findUnique({ where: { taskId_month: { taskId: m.taskId, month: m.month } } });
      res = await postToCliq(m.text, { threadParentId: thread?.messageId });
      if (!res.ok && thread?.messageId) res = await postToCliq(m.text); // thread replies not allowed → plain post
    } else {
      res = await postToCliq(m.text);
    }
    if (res.ok) {
      sent++;
      await prisma.cliqOutbox.update({ where: { id: m.id }, data: { sentAt: new Date(), attempts: { increment: 1 }, error: res.error ?? null } });
      if (m.kind === "alert" && m.taskId && m.month)
        await prisma.cliqMessage.updateMany({ where: { taskId: m.taskId, month: m.month }, data: { messageId: res.messageId ?? undefined, sentAt: new Date() } });
    } else {
      await prisma.cliqOutbox.update({ where: { id: m.id }, data: { attempts: { increment: 1 }, error: res.error ?? "failed" } });
    }
  }
  return sent;
}
