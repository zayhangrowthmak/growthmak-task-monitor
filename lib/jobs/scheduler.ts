// In-process scheduler. Railway keeps the Next.js server running, so a minute
// ticker is enough: periodic full sync, confidence re-scoring as time passes,
// and the month-end close on the 1st. Disable with RUN_JOBS=false if you prefer
// Railway Cron hitting /api/cron/<job> instead.
import { config, zohoConfigured } from "../config";
import { zohoConnected } from "../zoho/client";
import { fullSync } from "../zoho/sync";
import { refreshConfidence } from "./confidence";
import { closePreviousMonthIfNeeded } from "./monthEnd";

let started = false;
let lastSync = 0;
let lastScore = 0;

async function tick() {
  const now = Date.now();
  try {
    const canSync = !config.demoMode && zohoConfigured() && (await zohoConnected());
    if (canSync && now - lastSync >= config.jobs.syncIntervalMin * 60_000) {
      lastSync = now;
      lastScore = now;
      console.log("[sync] run ->", await fullSync());
    } else if (now - lastScore >= config.jobs.confidenceIntervalMin * 60_000) {
      lastScore = now;
      await refreshConfidence({ silent: config.demoMode });
    }
    const closed = await closePreviousMonthIfNeeded();
    if (closed) console.log("[jobs] closed month", closed);
  } catch (e) {
    console.error("[jobs] tick failed:", e);
  }
}

export function startScheduler() {
  if (started || !config.jobs.enabled) return;
  started = true;
  // SYNC_ON_BOOT=false waits a full interval before the first sync
  if (!config.jobs.syncOnBoot) lastSync = lastScore = Date.now();
  setTimeout(tick, 15_000);
  setInterval(tick, 60_000);
  console.log(`[boot] scheduler started (sync every ${config.jobs.syncIntervalMin} min, on boot: ${config.jobs.syncOnBoot})`);
}
