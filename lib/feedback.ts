import type { FeedbackType, User } from "@prisma/client";
import { prisma } from "./db";
import { config } from "./config";
import { sendMail, escapeHtml } from "./mail";
import { fmtDateTime } from "./time";

export const FEEDBACK_TYPES: { key: FeedbackType; label: string; hint: string }[] = [
  { key: "FEATURE", label: "Feature request", hint: "Something you'd like the dashboard to do" },
  { key: "PROBLEM", label: "Problem / bug", hint: "Something broken or not working as expected" },
  { key: "DATA_ISSUE", label: "Wrong data", hint: "A number, task or status that doesn't match Zoho" },
  { key: "OTHER", label: "Other", hint: "Anything else" },
];
export const feedbackLabel = (t: FeedbackType) => FEEDBACK_TYPES.find((x) => x.key === t)?.label ?? t;

/** Save feedback, then email it. Saving always happens first so nothing is lost if email fails. */
export async function submitFeedbackFor(user: User, input: { type: FeedbackType; subject: string; message: string; page?: string }) {
  const fb = await prisma.feedback.create({
    data: { userId: user.id, userName: user.name, userEmail: user.email, type: input.type, subject: input.subject, message: input.message, page: input.page },
  });
  const html = `
    <div style="font-family:system-ui,Segoe UI,sans-serif;font-size:14px;color:#0b0b0b">
      <p style="margin:0 0 4px;color:#52514e;font-size:12px;text-transform:uppercase;letter-spacing:.04em">Task Monitor feedback · ${escapeHtml(feedbackLabel(input.type))}</p>
      <h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(input.subject)}</h2>
      <div style="white-space:pre-wrap;line-height:1.5;border-left:3px solid #2a78d6;padding:4px 0 4px 12px;margin:0 0 16px">${escapeHtml(input.message)}</div>
      <table style="font-size:13px;color:#52514e" cellpadding="2">
        <tr><td>From</td><td><b style="color:#0b0b0b">${escapeHtml(user.name)}</b> &lt;${escapeHtml(user.email)}&gt;</td></tr>
        <tr><td>Page</td><td>${escapeHtml(input.page ? `${config.appUrl}${input.page}` : "—")}</td></tr>
        <tr><td>Sent</td><td>${escapeHtml(fmtDateTime(fb.createdAt))}</td></tr>
      </table>
      <p style="font-size:12px;color:#898781;margin-top:16px">All feedback is also listed in the dashboard under Settings → Feedback.</p>
    </div>`;
  try {
    await sendMail({ to: config.mail.feedbackTo, subject: `[Task Monitor · ${feedbackLabel(input.type)}] ${input.subject}`, html });
    await prisma.feedback.update({ where: { id: fb.id }, data: { emailed: true } });
    return { id: fb.id, emailed: true };
  } catch (e: any) {
    await prisma.feedback.update({ where: { id: fb.id }, data: { emailError: String(e?.message ?? e).slice(0, 500) } });
    return { id: fb.id, emailed: false };
  }
}
