import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { listFrom, listPortals, resolvePortalId, zget } from "@/lib/zoho/client";

export const dynamic = "force-dynamic";

// Admin-only: shows the *shape* of what Zoho returns (names, ids, field names —
// no tokens), so the field mapping can be checked against the real portal.
const shape = (json: any, key: string) => {
  const list = listFrom(json, key);
  return {
    responseType: Array.isArray(json) ? "array" : typeof json,
    topLevelKeys: Array.isArray(json) ? [] : Object.keys(json ?? {}),
    pageInfo: json?.page_info ?? null,
    count: list.length,
    firstItemKeys: list[0] ? Object.keys(list[0]) : [],
  };
};

export async function GET() {
  const u = await currentUser();
  if (u?.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const out: Record<string, unknown> = { portalNameSetting: config.zoho.portalName };
  try {
    const portals = await listPortals();
    out.portals = portals.map((p: any) => ({ id: p.id ?? p.id_string, name: p.name, portal_name: p.portal_name, keys: Object.keys(p) }));
    const portal = await resolvePortalId();
    out.chosenPortalId = portal;

    const projects = await zget<any>(`/api/v3/portal/${portal}/projects`, { page: 1, per_page: 10 });
    out.projects = shape(projects, "projects");
    const list = listFrom(projects, "projects");
    out.projectSamples = list.slice(0, 5).map((p: any) => ({ id: p.id, name: p.name, status: p.status, is_archived: p.is_archived }));

    if (list[0]) {
      const tasks = await zget<any>(`/api/v3/portal/${portal}/projects/${list[0].id}/tasks`, { page: 1, per_page: 5 });
      out.tasks = shape(tasks, "tasks");
      const t = listFrom(tasks, "tasks")[0];
      if (t) out.taskSample = { id: t.id, prefix: t.prefix, key: t.key, name: t.name, status: t.status, start_date: t.start_date, end_date: t.end_date, completion_percentage: t.completion_percentage, owners: t.owners_and_work?.owners ?? t.owners ?? t.details?.owners, tags: t.tags };
    }
  } catch (e: any) {
    out.error = String(e?.message ?? e);
  }
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
