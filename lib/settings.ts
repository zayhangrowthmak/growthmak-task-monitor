// Admin-editable settings (Settings page), stored as JSON in AppState.
import { getState, setState } from "./db";

export type AppSettings = {
  ccEmails: string[]; // CC'd on every Cliq alert
  reportRecipients: string[]; // tagged on the monthly report post
  quietStart: number; // hour, IST — no posts from this hour…
  quietEnd: number; // …until this hour
  alertsEnabled: boolean;
  digestEnabled: boolean; // weekday 09:00 morning digest
  checkinEnabled: boolean; // Monday confidence check-in
  lockWorkingDay: number; // Plan locks at the end of this working day of the month
  maxKeepMonths: number; // consecutive Keeps before a manager must approve
  workloadGreen: number; // ≤ this = green
  workloadAmber: number; // ≤ this = amber, above = red
  workingDays: number[]; // 0=Sun … 6=Sat
  reportPostHour: number; // IST hour on the 1st for the report + review posts
  includeRatingsInClientPdf: boolean;
  backlogStatusName: string; // Zoho status used when a review moves a task to Backlog
  closedStatusName: string; // Zoho status used when a review closes a task
};

export const DEFAULT_SETTINGS: AppSettings = {
  ccEmails: ["sandeep@growthmak.com", "mohammed@growthmak.com"],
  reportRecipients: ["sandeep@growthmak.com", "mohammed@growthmak.com"],
  quietStart: 20,
  quietEnd: 9,
  alertsEnabled: true,
  digestEnabled: false,
  checkinEnabled: true,
  lockWorkingDay: 3,
  maxKeepMonths: 2,
  workloadGreen: 5,
  workloadAmber: 8,
  workingDays: [1, 2, 3, 4, 5],
  reportPostHour: 10,
  includeRatingsInClientPdf: false,
  backlogStatusName: "Backlog",
  closedStatusName: "Closed - Not needed",
};

let cache: { at: number; value: AppSettings } | null = null;

export async function getSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  const raw = await getState("settings.v2");
  let value = DEFAULT_SETTINGS;
  if (raw) {
    try {
      value = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {}
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getSettings()), ...patch };
  await setState("settings.v2", JSON.stringify(next));
  cache = { at: Date.now(), value: next };
  return next;
}

export function clearSettingsCache() {
  cache = null;
}
