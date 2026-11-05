import type { StatusBucket, Confidence, ReasonCategory } from "@prisma/client";
import { config } from "./config";

// The five columns the team sees, in Kanban order.
export const BUCKETS: { key: StatusBucket; label: string }[] = [
  { key: "READY", label: "Ready" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "BLOCKED", label: "Blocked / Waiting" },
  { key: "REVIEW", label: "Review / QA" },
  { key: "COMPLETED", label: "Completed" },
];

export const bucketLabel = (b: StatusBucket) => BUCKETS.find((x) => x.key === b)?.label ?? b;

// Categorical slots (fixed order) — identity colours for the five status columns.
export const BUCKET_COLOR: Record<StatusBucket, string> = {
  READY: "#898781", // neutral: not started
  IN_PROGRESS: "#2a78d6",
  BLOCKED: "#eb6834",
  REVIEW: "#6250d6",
  COMPLETED: "#1baf7a",
};

/**
 * Map a Zoho status name onto one of the five buckets.
 * Exact matches in STATUS_MAP win; otherwise keyword rules; closed statuses are Completed.
 * Returns null for statuses that should be ignored entirely (e.g. Cancelled).
 */
export function bucketFor(statusName: string, isClosed: boolean): StatusBucket | null {
  const exact = Object.entries(config.statusMap).find(([k]) => k.toLowerCase() === statusName.toLowerCase());
  if (exact) return exact[1] === "IGNORE" ? null : (exact[1] as StatusBucket);
  const s = statusName.toLowerCase();
  if (/cancel|discard|void/.test(s)) return null;
  if (isClosed || /complete|done|closed|finished|delivered/.test(s)) return "COMPLETED";
  if (/review|q\s*&?\s*a|qa|uat|test|approval|feedback/.test(s)) return "REVIEW";
  if (/block|wait|hold|postpone|depend|stuck|paused/.test(s)) return "BLOCKED";
  if (/progress|working|doing|started|ongoing|development/.test(s)) return "IN_PROGRESS";
  return "READY"; // open, to do, not started, ready, backlog…
}

export const CONFIDENCE_META: Record<Confidence, { label: string; color: string; text: string; icon: string; severity: number }> = {
  AT_RISK: { label: "At Risk", color: "#d03b3b", text: "#ffffff", icon: "▲", severity: 3 },
  TIGHT: { label: "Tight", color: "#fab219", text: "#0b0b0b", icon: "◆", severity: 2 },
  ON_TRACK: { label: "On Track", color: "#0ca30c", text: "#ffffff", icon: "●", severity: 1 },
  NO_DUE_DATE: { label: "No due date", color: "#c3c2b7", text: "#0b0b0b", icon: "○", severity: 1 },
  DONE: { label: "Done", color: "#e1e0d9", text: "#0b0b0b", icon: "✓", severity: 0 },
};

export const REASONS: { key: ReasonCategory; label: string }[] = [
  { key: "CLIENT_DEPENDENCY", label: "Client dependency" },
  { key: "WAITING_APPROVAL", label: "Waiting for approval" },
  { key: "INTERNAL_DELAY", label: "Internal delay" },
  { key: "RESOURCE_ABSENT", label: "Resource absent / leave" },
  { key: "SCOPE_CHANGE", label: "Scope change" },
  { key: "TOOL_ACCESS", label: "Blocked by tool / access" },
  { key: "OTHER", label: "Other" },
];
export const reasonLabel = (r: ReasonCategory) => REASONS.find((x) => x.key === r)?.label ?? r;
