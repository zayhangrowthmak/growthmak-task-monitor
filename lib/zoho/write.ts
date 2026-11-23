// Writes to Zoho Projects. Only ever called for a ZohoChange a manager approved.
import { config } from "../config";
import { prisma } from "../db";
import { listFrom, resolvePortalId, zget, zsend } from "./client";

const ymd = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Try payload shapes in order until Zoho accepts one (v3 field formats vary by portal). */
async function patchTask(projectId: string, taskId: string, variants: Record<string, unknown>[]) {
  const portal = await resolvePortalId();
  let last: unknown;
  for (const body of variants) {
    try {
      return await zsend("PATCH", `/api/v3/portal/${portal}/projects/${projectId}/tasks/${taskId}`, body);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Find the id of a status by name, from tasks we've already synced in that project (or any project). */
async function statusIdFor(projectId: string, name: string): Promise<string | null> {
  const want = name.trim().toLowerCase();
  for (const where of [{ projectId }, {}]) {
    const rows = await prisma.task.findMany({ where: { ...where, zohoStatus: { equals: name, mode: "insensitive" } }, select: { raw: true }, take: 5 });
    for (const r of rows) {
      const st = (r.raw as any)?.status;
      if (st?.id && String(st.name ?? "").toLowerCase() === want) return String(st.id);
    }
  }
  // Ask Zoho for the project's task statuses
  try {
    const portal = await resolvePortalId();
    const { zget } = await import("./client");
    const json = await zget<any>(`/api/v3/portal/${portal}/projects/${projectId}/statuses`, { module: "tasks" });
    const list: any[] = Array.isArray(json) ? json : json?.statuses ?? json?.task_statuses ?? [];
    const hit = list.find((s) => String(s.name ?? "").toLowerCase() === want);
    if (hit?.id) return String(hit.id);
  } catch {}
  return null;
}

export async function updateDueDate(projectId: string, taskId: string, due: Date) {
  const d = ymd(due);
  await patchTask(projectId, taskId, [{ end_date: d }, { end_date: `${d}T23:59:00+05:30` }, { due_date: d }]);
}

export async function clearDueDate(projectId: string, taskId: string) {
  await patchTask(projectId, taskId, [{ end_date: "" }, { end_date: null }]);
}

export async function setStatus(projectId: string, taskId: string, statusName: string) {
  const id = await statusIdFor(projectId, statusName);
  if (!id) throw new Error(`Zoho has no task status called "${statusName}" in this project yet. Add it in Zoho Projects → Settings → Task statuses, then approve again.`);
  await patchTask(projectId, taskId, [{ status: { id } }, { status_id: id }, { custom_status: id }]);
}

/** Post a comment on a Zoho task. Throws on failure so the caller (or the outbox) can retry. */
export async function addComment(projectId: string, taskId: string, text: string) {
  const portal = await resolvePortalId();
  const path = `/api/v3/portal/${portal}/projects/${projectId}/tasks/${taskId}/comments`;
  let last: unknown;
  for (const body of [{ comment: text }, { content: text }]) {
    try {
      return await zsend("POST", path, body);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export type ZohoComment = { id: string; text: string; author: string; at: Date | null };
const stripHtml = (h: string) => h.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();

/** Comments on a Zoho task, newest first (Zoho → dashboard). */
export async function listComments(projectId: string, taskId: string): Promise<ZohoComment[]> {
  const portal = await resolvePortalId();
  const json = await zget(`/api/v3/portal/${portal}/projects/${projectId}/tasks/${taskId}/comments`, { page: 1, per_page: 30 });
  return listFrom(json, "comments")
    .map((c: any) => ({
      id: String(c.id ?? c.id_string ?? ""),
      text: stripHtml(String(c.comment ?? c.content ?? c.text ?? "")),
      author: String(c.created_by?.name ?? c.added_by?.name ?? c.owner?.name ?? c.created_person ?? "Zoho"),
      at: c.created_time ? new Date(c.created_time) : c.created_time_long ? new Date(Number(c.created_time_long)) : null,
    }))
    .filter((c: ZohoComment) => c.text)
    .sort((a: ZohoComment, b: ZohoComment) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}

export async function createTask(projectId: string, p: { name: string; due: Date; ownerZpuid?: string | null }) {
  const portal = await resolvePortalId();
  const d = ymd(p.due);
  const owners = p.ownerZpuid ? { owners_and_work: { owners: [{ zpuid: p.ownerZpuid }] } } : {};
  let last: unknown;
  for (const body of [{ name: p.name, end_date: d, ...owners }, { name: p.name, end_date: `${d}T23:59:00+05:30`, ...owners }]) {
    try {
      return await zsend("POST", `/api/v3/portal/${portal}/projects/${projectId}/tasks`, body);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export const zohoTaskUrl = (projectId: string, taskId: string) => `${config.zoho.webBase}/portal/${config.zoho.portalName}#zp/projects/${projectId}/tasks/task-detail/${taskId}`;
