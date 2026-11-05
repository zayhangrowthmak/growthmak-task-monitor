// Tests every connection and writes nothing to Zoho or Cliq. Usage: npm run check
// (off Railway: `railway run npm run check`, or set the same variables locally)
import { config, zohoConfigured } from "../lib/config";
import { prisma } from "../lib/db";
import { getRefreshToken, resolvePortalId, zget } from "../lib/zoho/client";
import { cliqConfigured } from "../lib/cliq";

const line = (ok: boolean | null, what: string, detail = "") => console.log(`${ok === null ? "–" : ok ? "✓" : "✕"} ${what}${detail ? `: ${detail}` : ""}`);

async function main() {
  let failed = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    const n = await prisma.task.count();
    line(true, "Database", `${n} tasks stored`);
  } catch (e: any) {
    failed = true;
    line(false, "Database", e.message.split("\n")[0]);
  }

  line(Boolean(config.sessionSecret && config.sessionSecret.length >= 32 && !config.sessionSecret.startsWith("dev-only")), "SESSION_SECRET", "must be 32+ random characters");
  line(config.appUrl.startsWith("https://"), "APP_URL", config.appUrl);
  line(config.adminEmails.length > 0, "ADMIN_EMAILS", config.adminEmails.join(", ") || "none set");
  if (config.demoMode) line(false, "DEMO_MODE", "is true — turn it off in production");

  if (!zohoConfigured()) {
    failed = true;
    line(false, "Zoho app", "ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET missing");
  } else if (!(await getRefreshToken().catch(() => ""))) {
    line(null, "Zoho Projects", "not connected yet — sign in as admin, then Settings → Connect Zoho Projects");
  } else {
    try {
      const portal = await resolvePortalId();
      const json = await zget<any>(`/api/v3/portal/${portal}/projects`, { page: 1, per_page: 5 });
      line(true, "Zoho Projects", `portal ${portal}, first page has ${(json?.projects ?? []).length} projects`);
    } catch (e: any) {
      failed = true;
      line(false, "Zoho Projects", e.message);
    }
  }
  line(Boolean(config.zoho.webhookSecret), "ZOHO_WEBHOOK_SECRET", config.zoho.webhookSecret ? "set" : "missing — webhook calls will be refused");
  line(cliqConfigured(), "Zoho Cliq", cliqConfigured() ? `channel ${config.cliq.channel} (use Settings → Send test message to post)` : "CLIQ_CHANNEL / CLIQ_WEBHOOK_TOKEN missing");
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}
main();
