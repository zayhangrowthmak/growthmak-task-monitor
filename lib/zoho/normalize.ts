// Turn Zoho Projects API objects into our shape. Written defensively: it accepts
// both V3 field names and the older V2 names, because Zoho's payloads vary by
// endpoint and portal configuration. Run `npm run zoho:discover` to see raw data.
import type { ClientType } from "@prisma/client";
import { config } from "../config";

export type NormPerson = { zohoUserId?: string; name: string; email?: string };

export type NormTask = {
  id: string;
  projectId: string;
  key?: string;
  name: string;
  description?: string;
  statusName: string;
  statusColor?: string;
  isClosed: boolean;
  startDate?: Date;
  dueDate?: Date;
  completedAt?: Date;
  completionPct: number;
  loggedHours: number;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: NormPerson;
  owners: NormPerson[];
  tags: string[];
  clientFromTag?: string;
  url?: string;
};

export type NormProject = {
  id: string;
  name: string;
  prefix?: string;
  status?: string;
  active: boolean;
  owner?: NormPerson;
  clientName?: string;
  clientType?: ClientType;
  url?: string;
};

const first = (...vals: any[]) => vals.find((v) => v !== undefined && v !== null && v !== "");

export function parseZohoDate(v: any): Date | undefined {
  if (v === undefined || v === null || v === "" || v === -1 || v === "-1") return undefined;
  if (typeof v === "number" || /^\d{10,13}$/.test(String(v))) {
    const n = Number(v);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  const s = String(v).trim();
  // V2 style "MM-DD-YYYY" (optionally with time)
  const mdy = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (mdy) return new Date(`${mdy[3]}-${mdy[1]}-${mdy[2]}T00:00:00+05:30`);
  // Plain date → treat as IST midnight
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00+05:30`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

function parseHours(v: any): number {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v);
  const hm = s.match(/^(\d+):(\d{2})$/);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function person(p: any): NormPerson | undefined {
  if (!p) return undefined;
  const name = first(
    p.name,
    p.full_name,
    p.display_name,
    [p.first_name, p.last_name].filter(Boolean).join(" "),
    p.email
  );
  if (!name || /^unassigned$/i.test(String(name))) return undefined;
  return {
    zohoUserId: first(p.zpuid, p.id, p.zuid, p.user_id)?.toString(),
    name: String(name).trim(),
    email: first(p.email, p.email_id, p.mail)?.toString().toLowerCase(),
  };
}

function stripHtml(s?: string): string | undefined {
  if (!s) return undefined;
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tagNames(raw: any): string[] {
  const arr = Array.isArray(raw) ? raw : raw?.tags ?? [];
  return arr.map((t: any) => (typeof t === "string" ? t : first(t.name, t.tag_name))).filter(Boolean);
}

/** Pull a custom field's value by label (V3 arrays, V2 arrays, or plain objects) */
function customField(raw: any, labels: string[]): string | undefined {
  const wanted = labels.map((l) => l.toLowerCase());
  const pools = [raw?.custom_fields, raw?.customfields, raw?.custom_field_values, raw?.layout_fields].filter(Boolean);
  for (const pool of pools) {
    if (Array.isArray(pool)) {
      for (const f of pool) {
        const label = String(first(f.label_name, f.label, f.display_name, f.field_name, f.column_name, f.api_name) ?? "").toLowerCase();
        if (wanted.includes(label)) {
          const v = first(f.value, f.field_value, f.values?.[0]?.name, f.selected_option?.name);
          if (v) return typeof v === "object" ? first(v.name, v.value) : String(v);
        }
      }
    } else if (typeof pool === "object") {
      for (const [k, v] of Object.entries(pool)) {
        if (wanted.includes(k.toLowerCase()) && v) return typeof v === "object" ? first((v as any).name, (v as any).value) : String(v);
      }
    }
  }
  // V3 often exposes custom fields as top-level keys named after their api name
  for (const l of wanted) {
    const k = Object.keys(raw ?? {}).find((key) => key.toLowerCase() === `cf_${l.replace(/\s+/g, "_")}`);
    if (k && raw[k]) return typeof raw[k] === "object" ? first(raw[k].name, raw[k].value) : String(raw[k]);
  }
  return undefined;
}

export function normalizeProject(p: any): NormProject {
  const statusName = String(first(p.status?.name, typeof p.status === "string" ? p.status : undefined, p.project_status) ?? "");
  const archived = Boolean(p.is_archived ?? p.archived) || /archiv|cancel|closed|completed/i.test(statusName);
  const allowed = config.zoho.activeProjectStatuses.map((s) => s.toLowerCase());
  const active = allowed.length ? allowed.includes(statusName.toLowerCase()) : !archived;

  const typeRaw = customField(p, config.zoho.clientTypeFieldLabels);
  const tagList = tagNames(p.tags);
  let clientType: ClientType | undefined;
  if (typeRaw) clientType = /intern/i.test(typeRaw) ? "INTERNAL" : "CLIENT";
  else if (tagList.some((t) => /^internal$/i.test(t))) clientType = "INTERNAL";

  const clientTag = tagList.find((t) => /^client\s*[:\-]/i.test(t));
  return {
    id: String(first(p.id, p.id_string)),
    name: String(p.name ?? "Untitled project").trim(),
    prefix: first(p.prefix, p.key, p.project_key)?.toString(),
    status: statusName || undefined,
    active,
    owner: person(first(p.owner, p.owner_details, { name: p.owner_name, email: p.owner_email, id: p.owner_id })),
    clientName:
      customField(p, config.zoho.clientFieldLabels) ??
      (clientTag ? clientTag.replace(/^client\s*[:\-]\s*/i, "").trim() : undefined) ??
      first(p.group?.name, p.project_group?.name, p.group_name),
    clientType,
    url: first(p.link?.web?.url, p.url),
  };
}

export function normalizeTask(t: any, projectId: string, portalName: string): NormTask {
  const status = t.status ?? {};
  const statusName = String(first(status.name, typeof t.status === "string" ? t.status : undefined, "Open"));
  const closed = Boolean(
    first(status.is_closed_type, status.is_closed, status.type === "closed" ? true : undefined, t.completed, t.is_completed) ?? false
  );

  const ownerPool = first(
    t.owners_and_work?.owners,
    t.details?.owners,
    t.owners,
    t.assignees,
    t.assignee ? [t.assignee] : undefined
  ) as any[] | undefined;
  const owners = (ownerPool ?? []).map(person).filter(Boolean) as NormPerson[];

  const tags = tagNames(t.tags);
  const clientTag = tags.find((x) => /^client\s*[:\-]/i.test(x));

  const id = String(first(t.id, t.id_string));
  const updatedAt = parseZohoDate(first(t.last_modified_time, t.last_updated_time_long, t.last_updated_time, t.modified_time));
  let completedAt = parseZohoDate(first(t.completed_time, t.completed_time_long, t.completed_on, t.completed_date));
  if (closed && !completedAt) completedAt = updatedAt;

  return {
    id,
    projectId,
    key: first(t.prefix, t.key, t.task_key)?.toString(),
    name: String(t.name ?? "Untitled task").trim(),
    description: stripHtml(first(t.description, t.details?.description)),
    statusName,
    statusColor: first(status.color, status.color_code, status.colour),
    isClosed: closed,
    startDate: parseZohoDate(first(t.start_date_long, t.start_date, t.start_time)),
    dueDate: parseZohoDate(first(t.end_date_long, t.end_date, t.due_date, t.end_time)),
    completedAt: closed ? completedAt : undefined,
    completionPct: Math.round(Number(first(t.completion_percentage, t.percent_complete, t.percentage, 0)) || 0),
    loggedHours: parseHours(
      first(
        t.log_hours?.total_hours,
        t.log_hours?.total,
        t.total_log_hours,
        t.log_hours
          ? parseHours(t.log_hours.billable_hours) + parseHours(t.log_hours.non_billable_hours)
          : undefined
      )
    ),
    createdAt: parseZohoDate(first(t.created_time, t.created_time_long, t.created_date)),
    updatedAt,
    createdBy: person(first(t.created_by, t.created_person ? { name: t.created_person } : undefined)),
    owners,
    tags,
    clientFromTag: clientTag ? clientTag.replace(/^client\s*[:\-]\s*/i, "").trim() : undefined,
    url:
      first(t.link?.web?.url, t.web_url) ??
      `${config.zoho.webBase}/portal/${portalName}#zp/projects/${projectId}/tasks/task-detail/${id}`,
  };
}
