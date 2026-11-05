import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { syncOneTask } from "@/lib/zoho/sync";
import { prisma } from "@/lib/db";

// Zoho Projects → Automation → Webhooks (Tasks). Point it at
//   https://<your-app>/api/webhooks/zoho?secret=<ZOHO_WEBHOOK_SECRET>
// and append the task id and project id as parameters (task_id, project_id).
async function handle(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (!config.zoho.webhookSecret || q.get("secret") !== config.zoho.webhookSecret)
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  let body: Record<string, any> = {};
  const text = req.method === "POST" ? await req.text() : "";
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = Object.fromEntries(new URLSearchParams(text));
    }
  }
  const pick = (...keys: string[]) => keys.map((k) => q.get(k) ?? body[k] ?? body?.task?.[k]).find(Boolean);
  const taskId = pick("task_id", "taskId", "taskid", "id");
  let projectId = pick("project_id", "projectId", "projectid");
  if (taskId && !projectId) projectId = (await prisma.task.findUnique({ where: { id: String(taskId) } }))?.projectId;
  if (!taskId || !projectId) return NextResponse.json({ error: "task_id and project_id are required" }, { status: 400 });

  const log = await prisma.syncLog.create({ data: { kind: "webhook", detail: `task ${taskId}` } });
  try {
    await syncOneTask(String(projectId), String(taskId));
    await prisma.syncLog.update({ where: { id: log.id }, data: { ok: true, finishedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    await prisma.syncLog.update({ where: { id: log.id }, data: { finishedAt: new Date(), detail: `task ${taskId}: ${e?.message}` } });
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
export const POST = handle;
export const GET = handle;
