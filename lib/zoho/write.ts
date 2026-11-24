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

export type ZohoComment = { id: string; text: string; raw: string; author: string; authorId: string | null; at: Date | null };
const stripHtml = (h: string) =>
  h
    // Zoho @mentions (zp[@...]zp) → "@Name" when the name is inside, else "@someone"
    .replace(/zp\[@([^\]]*?)\]zp/g, (_m, inner: string) => {
      const name = inner.split(/[#:|]/).find((p) => p && !/^\d+$/.test(p) && !/^user$/i.test(p));
      return `@${name ?? "someone"}`;
    })
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
const when = (o: any, ...keys: string[]) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v === undefined || v === null || v === "") continue;
    const d = /^\d{10,}$/.test(String(v)) ? new Date(Number(v)) : new Date(String(v));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
};
const taskPath = async (projectId: string, taskId: string) => `/api/v3/portal/${await resolvePortalId()}/projects/${projectId}/tasks/${taskId}`;

/** Comments on a Zoho task, newest first (Zoho → dashboard). */
export async function listComments(projectId: string, taskId: string): Promise<ZohoComment[]> {
  const json = await zget(`${await taskPath(projectId, taskId)}/comments`, { page: 1, per_page: 50 });
  return listFrom(json, "comments")
    .map((c: any) => {
      const raw = String(c.comment ?? c.content ?? c.text ?? "");
      return {
        id: String(c.id ?? c.id_string ?? ""),
        raw,
        text: stripHtml(raw),
        author: String(c.created_by?.name ?? c.added_by?.name ?? c.owner?.name ?? c.created_person ?? "Zoho"),
        authorId: c.created_by?.zpuid ?? c.created_by?.id ?? c.added_by?.id ?? null,
        at: when(c, "created_time", "created_time_long", "added_time", "created_date"),
      };
    })
    .filter((c: ZohoComment) => c.id && c.text)
    .sort((a: ZohoComment, b: ZohoComment) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}

export type ZohoDoc = { id: string; name: string; size: string | null; by: string | null; at: Date | null; url: string | null; type: string | null };
/** Documents attached to the task (read-only). */
export async function listAttachments(projectId: string, taskId: string): Promise<ZohoDoc[]> {
  const json = await zget(`${await taskPath(projectId, taskId)}/attachments`);
  return listFrom(json, "attachments").map((a: any) => ({
    id: String(a.attachment_id ?? a.id ?? a.file_id ?? a.name),
    name: String(a.name ?? a.file_name ?? a.attachment_name ?? "Document"),
    size: a.size ? String(a.size) : a.file_size ? String(a.file_size) : null,
    by: a.created_by?.name ?? a.uploaded_by?.name ?? a.author?.name ?? null,
    at: when(a, "created_time", "uploaded_time", "added_time", "created_time_long"),
    url: a.permanent_url ?? a.preview_url ?? a.download_url ?? a.third_party_file_url ?? a.link?.self?.url ?? null,
    type: a.type ?? a.file_type ?? a.extension ?? null,
  }));
}

export type ZohoSubtask = { id: string; key: string | null; name: string; status: string | null; closed: boolean; owners: string; due: Date | null };
/** Subtasks (read-only). */
export async function listSubtasks(projectId: string, taskId: string): Promise<ZohoSubtask[]> {
  const json = await zget(`${await taskPath(projectId, taskId)}/subtasks`, { page: 1, per_page: 100 });
  const rows = (json as any)?.tasks ?? (json as any)?.subtasks ?? listFrom(json, "tasks");
  return (Array.isArray(rows) ? rows : []).map((t: any) => ({
    id: String(t.id ?? t.id_string),
    key: t.prefix ?? t.key ?? null,
    name: String(t.name ?? ""),
    status: t.status?.name ?? null,
    closed: Boolean(t.status?.is_closed_type ?? t.completed),
    owners: (t.owners_and_work?.owners ?? t.details?.owners ?? t.owners ?? []).map((o: any) => o.name ?? o.full_name).filter(Boolean).join(", "),
    due: when(t, "end_date", "end_date_long", "due_date"),
  }));
}

export type ZohoActivity = { id: string; text: string; by: string | null; at: Date | null };
/** The task's activity log (read-only). */
export async function listActivities(projectId: string, taskId: string): Promise<ZohoActivity[]> {
  const json = await zget(`${await taskPath(projectId, taskId)}/activities`, { page: 1, per_page: 50 });
  return listFrom(json, "activities")
    .map((a: any, i: number) => ({
      id: String(a.id ?? i),
      text: stripHtml(String(a.activity_for ?? a.state ?? a.action ?? a.description ?? a.message ?? a.name ?? "")) + (a.old_value || a.new_value ? `${a.old_value ? `: ${stripHtml(String(a.old_value))}` : ""}${a.new_value ? ` → ${stripHtml(String(a.new_value))}` : ""}` : ""),
      by: a.created_by?.name ?? a.actor?.name ?? a.display_name ?? a.user?.name ?? null,
      at: when(a, "time", "created_time", "time_long", "created_time_long", "activity_time"),
    }))
    .filter((a: ZohoActivity) => a.text)
    .sort((a: ZohoActivity, b: ZohoActivity) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
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
