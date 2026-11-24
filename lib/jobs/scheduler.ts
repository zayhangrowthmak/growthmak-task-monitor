// In-process scheduler (Railway keeps one replica running). Every minute:
//   full Zoho sync every SYNC_INTERVAL_MIN · plan draft/lock · Cliq state alerts every 5 min
//   · 1st-of-month posts, digest · send the Cliq outbox · post queued Zoho comments
//   · re-read Zoho comments on a few followed tasks (Task updates) · month-end close
import { config, zohoConfigured } from "../config";
import { zohoConnected } from "../zoho/client";
import { fullSync } from "../zoho/sync";
import { closePreviousMonthIfNeeded, generateReport } from "./monthEnd";
import { planTick } from "../plan";
import { loadTasks } from "../metrics";
import { runAlerts, cliqScheduleTick } from "./alerts";
import { flushOutbox } from "../cliq";
import { acquireLock, releaseLock } from "../lock";

let started = false;
let lastSync = 0;
let lastAlerts = 0;
let lastComments = 0;

export async function tick(now = Date.now()) {
  try {
    const canSync = !config.demoMode && zohoConfigured() && (await zohoConnected());
    if (canSync && now - lastSync >= config.jobs.syncIntervalMin * 60_000) {
      lastSync = now;
      console.log("[sync] run ->", await fullSync());
    }
    if (await acquireLock("planning", 5)) {
      try {
        await planTick(await loadTasks(), new Date(now));
        if (now - lastAlerts >= 5 * 60_000) {
          lastAlerts = now;
          const r = await runAlerts(new Date(now), config.demoMode ? { silentBaseline: true } : {});
          if (r.queued) console.log(`[cliq] queued ${r.queued} alert(s)`);
        }
        await cliqScheduleTick(new Date(now));
        await closePreviousMonthIfNeeded(new Date(now));
      } finally {
        await releaseLock("planning");
      }
    }
    const sent = await flushOutbox((m) => generateReport(m));
    if (sent) console.log(`[cliq] sent ${sent}`);
    // Two-way sync: comments, reasons and verdicts written in the dashboard go onto the Zoho task
    const { flushZohoComments } = await import("../updates");
    const posted = await flushZohoComments();
    if (posted) console.log(`[zoho] posted ${posted} comment(s)`);
    // Task updates feed: re-read Zoho comments for a few followed tasks every 5 minutes (stays far under Zoho's limit)
    if (canSync && now - lastComments >= 5 * 60_000) {
      lastComments = now;
      const { refreshDueComments } = await import("../updates");
      const n = await refreshDueComments(config.jobs.commentsPerTick);
      if (n) console.log(`[updates] read comments on ${n} task(s)`);
    }
  } catch (e) {
    console.error("[jobs] tick failed:", e);
  }
}

export function startScheduler() {
  if (started || !config.jobs.enabled) return;
  started = true;
  if (!config.jobs.syncOnBoot) lastSync = Date.now();
  setTimeout(() => tick(), 15_000);
  setInterval(() => tick(), 60_000);
  console.log(`[boot] scheduler started (sync every ${config.jobs.syncIntervalMin} min, on boot: ${config.jobs.syncOnBoot})`);
}
