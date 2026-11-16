// In-process scheduler (Railway keeps one replica running). Every minute:
//   full Zoho sync every SYNC_INTERVAL_MIN · plan draft/lock · Cliq state alerts every 5 min
//   · 1st-of-month posts, Monday check-in, digest · send the Cliq outbox · month-end close
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
