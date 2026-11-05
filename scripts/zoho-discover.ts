// Prints raw Zoho data (first project + first 2 tasks + all status names) so the
// field mapping can be checked against your portal. Usage: npm run zoho:discover
import { zget, zgetAll, resolvePortalId } from "../lib/zoho/client";
import { normalizeProject, normalizeTask } from "../lib/zoho/normalize";
import { config } from "../lib/config";

async function main() {
  const portal = await resolvePortalId();
  console.log("Portal id:", portal);
  const projects = await zgetAll(`/api/v3/portal/${portal}/projects`, "projects");
  console.log(`\n${projects.length} projects. First raw project:\n`, JSON.stringify(projects[0], null, 2));
  console.log("\nNormalised:", normalizeProject(projects[0]));
  const statuses = new Map<string, number>();
  for (const p of projects.slice(0, 10)) {
    const tasks = await zgetAll(`/api/v3/portal/${portal}/projects/${p.id}/tasks`, "tasks");
    for (const t of tasks) statuses.set(t.status?.name ?? String(t.status), (statuses.get(t.status?.name ?? String(t.status)) ?? 0) + 1);
    if (p === projects[0] && tasks[0]) {
      console.log("\nFirst raw task:\n", JSON.stringify(tasks[0], null, 2));
      console.log("\nNormalised:", normalizeTask(tasks[0], String(p.id), config.zoho.portalName));
      const single = await zget(`/api/v3/portal/${portal}/projects/${p.id}/tasks/${tasks[0].id}`);
      console.log("\nSingle-task endpoint keys:", Object.keys(single));
    }
  }
  console.log("\nStatus names seen (first 10 projects):", Object.fromEntries(statuses));
}
main().catch((e) => { console.error(e); process.exit(1); });
