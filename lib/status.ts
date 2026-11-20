import type { StatusBucket, Confidence, ReasonCategory, BlockedType, SlipReason, RemoveReason } from "@prisma/client";
import { config } from "./config";

// The five Kanban columns, in order. Backlog and Closed are separate tabs, never columns.
export const BUCKETS: { key: StatusBucket; label: string }[] = [
  { key: "READY", label: "Ready" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "BLOCKED", label: "Blocked / Waiting" },
  { key: "REVIEW", label: "Review / QA" },
  { key: "COMPLETED", label: "Completed" },
];
export const ALL_BUCKET_LABELS: Record<StatusBucket, string> = {
  READY: "Ready",
  IN_PROGRESS: "In Progress",
  BLOCKED: "Blocked / Waiting",
  REVIEW: "Review / QA",
  COMPLETED: "Completed",
  BACKLOG: "Backlog",
  CLOSED: "Closed – not needed",
};
export const bucketLabel = (b: StatusBucket) => ALL_BUCKET_LABELS[b] ?? b;

// Categorical slots (fixed order) — identity colours for the status columns.
export const BUCKET_COLOR: Record<StatusBucket, string> = {
  READY: "#898781",
  IN_PROGRESS: "#2a78d6",
  BLOCKED: "#eb6834",
  REVIEW: "#6250d6",
  COMPLETED: "#1baf7a",
  BACKLOG: "#c3c2b7",
  CLOSED: "#c3c2b7",
};

/**
 * Map a Zoho status name onto a bucket. Exact STATUS_MAP entries win, then keyword rules.
 * Returns null only for statuses mapped to IGNORE.
 */
export function bucketFor(statusName: string, isClosed: boolean): StatusBucket | null {
  const exact = Object.entries(config.statusMap).find(([k]) => k.toLowerCase() === statusName.toLowerCase());
  if (exact) return exact[1] === "IGNORE" ? null : (exact[1] as StatusBucket);
  const s = statusName.toLowerCase();
  if (/not\s*needed|cancel|discard|void|won'?t\s*do|dropped/.test(s)) return "CLOSED";
  if (/backlog|parked|someday|on\s*ice|idea/.test(s)) return "BACKLOG";
  if (isClosed || /complete|done|closed|finished|delivered/.test(s)) return "COMPLETED";
  if (/review|q\s*&?\s*a|qa|uat|test|approval|feedback/.test(s)) return "REVIEW";
  if (/block|wait|hold|postpone|depend|stuck|paused/.test(s)) return "BLOCKED";
  if (/progress|working|doing|started|ongoing|development/.test(s)) return "IN_PROGRESS";
  return "READY";
}

/** "Blocked - Client" / "Waiting on client" → CLIENT; any other blocked status → INTERNAL. */
export function blockedTypeFor(statusName: string, bucket: StatusBucket | null): BlockedType | null {
  if (bucket !== "BLOCKED") return null;
  return /client|customer/i.test(statusName) ? "CLIENT" : "INTERNAL";
}

// v1 computed confidence (kept for task history screens)
export const CONFIDENCE_META: Record<Confidence, { label: string; color: string; text: string; icon: string; severity: number }> = {
  AT_RISK: { label: "At Risk", color: "#d03b3b", text: "#ffffff", icon: "▲", severity: 3 },
  TIGHT: { label: "Tight", color: "#fab219", text: "#0b0b0b", icon: "◆", severity: 2 },
  ON_TRACK: { label: "On Track", color: "#0ca30c", text: "#0b0b0b", icon: "●", severity: 1 },
  NO_DUE_DATE: { label: "No due date", color: "#c3c2b7", text: "#0b0b0b", icon: "○", severity: 1 },
  DONE: { label: "Done", color: "#e1e0d9", text: "#0b0b0b", icon: "✓", severity: 0 },
};

// v2: confidence set by the assignee, 1–3
export const USER_CONFIDENCE: Record<number, { label: string; color: string; text: string }> = {
  1: { label: "1 · At Risk", color: "#d03b3b", text: "#ffffff" },
  2: { label: "2 · Watch", color: "#fab219", text: "#0b0b0b" },
  3: { label: "3 · On Track", color: "#0ca30c", text: "#ffffff" },
};

// v2 task state shown on cards and used for Cliq alerts
export type TaskState = "DONE" | "DONE_LATE" | "OVERDUE" | "MOVED" | "BLOCKED_CLIENT" | "BLOCKED_INTERNAL" | "AT_RISK" | "TIGHT" | "ON_TRACK" | "NO_DUE";
export const STATE_META: Record<TaskState, { label: string; color: string; text: string; icon: string }> = {
  DONE: { label: "Done", color: "#1baf7a", text: "#0b0b0b", icon: "✓" },
  DONE_LATE: { label: "Done late", color: "#e1e0d9", text: "#0b0b0b", icon: "✓" },
  OVERDUE: { label: "Overdue", color: "#d03b3b", text: "#ffffff", icon: "▲" },
  MOVED: { label: "Moved out of month", color: "#ec835a", text: "#0b0b0b", icon: "→" },
  BLOCKED_CLIENT: { label: "Waiting on client", color: "#eb6834", text: "#0b0b0b", icon: "⏸" },
  BLOCKED_INTERNAL: { label: "Blocked internally", color: "#b4471d", text: "#ffffff", icon: "■" },
  AT_RISK: { label: "At Risk", color: "#d03b3b", text: "#ffffff", icon: "▲" },
  TIGHT: { label: "Tight", color: "#fab219", text: "#0b0b0b", icon: "◆" },
  ON_TRACK: { label: "On Track", color: "#0ca30c", text: "#0b0b0b", icon: "●" },
  NO_DUE: { label: "No due date", color: "#c3c2b7", text: "#0b0b0b", icon: "○" },
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

export const SLIP_REASONS: { key: SlipReason; label: string }[] = [
  { key: "CLIENT_INPUT", label: "Client input pending" },
  { key: "CLIENT_APPROVAL", label: "Client approval pending" },
  { key: "SCOPE_CHANGE", label: "Scope change" },
  { key: "CAPACITY", label: "Capacity" },
  { key: "INTERNAL_DEPENDENCY", label: "Internal dependency" },
  { key: "TECH_ISSUE", label: "Tech issue" },
  { key: "OTHER", label: "Other" },
];
export const slipLabel = (r: SlipReason) => SLIP_REASONS.find((x) => x.key === r)?.label ?? r;

export const REMOVE_REASONS: { key: RemoveReason; label: string }[] = [
  { key: "CLIENT_CANCELLED", label: "Client cancelled" },
  { key: "SCOPE_CHANGE", label: "Scope change" },
  { key: "MOVED_NEXT_MONTH", label: "Moved to next month" },
  { key: "OTHER", label: "Other" },
];
export const removeLabel = (r: RemoveReason) => REMOVE_REASONS.find((x) => x.key === r)?.label ?? r;
