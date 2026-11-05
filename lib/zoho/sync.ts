// Pull projects + tasks from Zoho Projects into Postgres, then re-score confidence.
import type { Prisma } from "@prisma/client";
import { prisma, getState, setState } from "../db";
import { config } from "../config";
import { bucketFor } from "../status";
import { zgetAll, zget, resolvePortalId, listFrom } from "./client";
import { normalizeProject, normalizeTask, type NormPerson, type NormTask } from "./normalize";
import { refreshConfidence } from "../jobs/confidence";
import { acquireLock, releaseLock } from "../lock";

async function upsertPerson(p: NormPerson): Promise<string | null> {
  const email = p.email?.toLowerCase();
  if (!email) {
    if (!p.zohoUserId) return null;
    const existing = await prisma.user.findUnique({ where: { zohoUserId: p.zohoUserId } });
    return existing?.id ?? null;
  }
  const role = config.adminEmails.includes(email) ? "ADMIN" : undefined;
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: p.name, zohoUserId: p.zohoUserId, role: role ?? "MEMBER" },
    update: { name: p.name, ...(p.zohoUserId ? { zohoUserId: p.zohoUserId } : {}), ...(role ? { role } : {}) },
  });
  return user.id;
}

async function saveTask(n: NormTask, raw: any) {
  const bucket = bucketFor(n.statusName, n.isClosed);
  const data = {
    projectId: n.projectId,
    key: n.key,
    name: n.name,
    description: n.description,
    zohoStatus: n.statusName,
    zohoStatusColor: n.statusColor,
    bucket: bucket ?? "READY",
    isClosed: n.isClosed || bucket === "COMPLETED",
    startDate: n.startDate ?? null,
    dueDate: n.dueDate ?? null,
    completedAt: n.completedAt ?? null,
    completionPct: n.isClosed ? 100 : n.completionPct,
    loggedHours: n.loggedHours,
    createdAtZoho: n.createdAt ?? null,
    updatedAtZoho: n.updatedAt ?? null,
    createdByName: n.createdBy?.name,
    createdByEmail: n.createdBy?.email,
    tags: n.tags,
    clientFromTag: n.clientFromTag ?? null,
    url: n.url,
    deleted: bucket === null, // cancelled statuses drop out of the numbers
    raw: raw as Prisma.InputJsonValue,
    syncedAt: new Date(),
  };
  await prisma.task.upsert({ where: { id: n.id }, create: { id: n.id, ...data }, update: data });

  const userIds = (await Promise.all(n.owners.map(upsertPerson))).filter(Boolean) as string[];
  await prisma.$transaction([
    prisma.taskAssignee.deleteMany({ where: { taskId: n.id, userId: { notIn: userIds } } }),
    ...userIds.map((userId) =>
      prisma.taskAssignee.upsert({ where: { taskId_userId: { taskId: n.id, userId } }, create: { taskId: n.id, userId }, update: {} })
    ),
  ]);
}

let running = false;

export async function fullSync(): Promise<string> {
  if (running) return "A sync is already running";
  if (!(await acquireLock("sync"))) return "A sync is already running in another process";
  running = true;
  const log = await prisma.syncLog.create({ data: { kind: "full" } });
  try {
    const portal = await resolvePortalId();
    const rawProjects = await zgetAll(`/api/v3/portal/${portal}/projects`, "projects");
    let taskCount = 0;
    let projectCount = 0;
    const seenTasks = new Set<string>();

    for (const rp of rawProjects) {
      const p = normalizeProject(rp);
      const pdata = {
        name: p.name,
        prefix: p.prefix,
        zohoStatus: p.status,
        active: p.active,
        ownerName: p.owner?.name,
        ownerEmail: p.owner?.email,
        zohoClientName: p.clientName ?? null,
        zohoClientType: p.clientType ?? null,
        url: p.url ?? `${config.zoho.webBase}/portal/${config.zoho.portalName}#zp/projects/${p.id}`,
        raw: rp as Prisma.InputJsonValue,
      };
      await prisma.project.upsert({ where: { id: p.id }, create: { id: p.id, ...pdata }, update: pdata });
      if (p.owner) await upsertPerson(p.owner);
      if (!p.active) continue;
      projectCount++;

      const rawTasks = await zgetAll(`/api/v3/portal/${portal}/projects/${p.id}/tasks`, "tasks");
      for (const rt of rawTasks) {
        const n = normalizeTask(rt, p.id, config.zoho.portalName);
        await saveTask(n, rt);
        seenTasks.add(n.id);
        taskCount++;
      }
      // Tasks deleted in Zoho disappear from the list → mark them deleted
      await prisma.task.updateMany({
        where: { projectId: p.id, id: { notIn: [...seenTasks] }, deleted: false },
        data: { deleted: true },
      });
    }

    // First ever sync sets the baseline silently; alerts only fire on later changes
    const baseline = !(await getState("alerts.baseline"));
    const scored = await refreshConfidence({ silent: baseline });
    if (baseline) await setState("alerts.baseline", new Date().toISOString());

    const detail = `${projectCount} active projects (of ${rawProjects.length} in Zoho), ${taskCount} tasks, ${scored.alerts} alerts`;
    await prisma.syncLog.update({ where: { id: log.id }, data: { ok: true, finishedAt: new Date(), detail } });
    await setState("sync.last_ok", new Date().toISOString());
    return detail;
  } catch (e: any) {
    await prisma.syncLog.update({ where: { id: log.id }, data: { ok: false, finishedAt: new Date(), detail: String(e?.message ?? e) } });
    throw e;
  } finally {
    running = false;
    await releaseLock("sync");
  }
}

/** Called by the webhook: refresh one task straight away. */
export async function syncOneTask(projectId: string, taskId: string): Promise<void> {
  const portal = await resolvePortalId();
  if (!(await prisma.project.findUnique({ where: { id: projectId } }))) {
    const rp = await zget<any>(`/api/v3/portal/${portal}/projects/${projectId}`);
    const p = normalizeProject(listFrom(rp, "projects")[0] ?? rp);
    await prisma.project.create({
      data: { id: p.id, name: p.name, prefix: p.prefix, active: p.active, zohoClientName: p.clientName, zohoClientType: p.clientType, raw: rp },
    });
  }
  try {
    const json = await zget<any>(`/api/v3/portal/${portal}/projects/${projectId}/tasks/${taskId}`);
    const rt = listFrom(json, "tasks")[0] ?? json?.task ?? json;
    await saveTask(normalizeTask(rt, projectId, config.zoho.portalName), rt);
  } catch (e: any) {
    if (/404/.test(String(e?.message))) await prisma.task.updateMany({ where: { id: taskId }, data: { deleted: true } });
    else throw e;
  }
  await refreshConfidence({ taskIds: [taskId] });
}
