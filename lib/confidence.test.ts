import { test } from "node:test";
import assert from "node:assert/strict";
import { computeConfidence, shouldAlert } from "./confidence";

const now = new Date("2026-11-05T12:00:00+05:30");
const d = (s: string) => new Date(`${s}T00:00:00+05:30`);

test("overdue open task is At Risk", () => {
  const r = computeConfidence({ bucket: "IN_PROGRESS", isClosed: false, dueDate: d("2026-11-02"), startDate: d("2026-10-25") }, now);
  assert.equal(r.level, "AT_RISK");
  assert.match(r.reason, /Overdue by 3 days/);
});
test("blocked is At Risk", () => {
  assert.equal(computeConfidence({ bucket: "BLOCKED", isClosed: false, dueDate: d("2026-11-30") }, now).level, "AT_RISK");
});
test("due tomorrow with little progress is At Risk", () => {
  assert.equal(computeConfidence({ bucket: "IN_PROGRESS", isClosed: false, dueDate: d("2026-11-06"), completionPct: 20, startDate: d("2026-11-01") }, now).level, "AT_RISK");
});
test("due in 2 days, well progressed is Tight", () => {
  assert.equal(computeConfidence({ bucket: "IN_PROGRESS", isClosed: false, dueDate: d("2026-11-07"), completionPct: 70, startDate: d("2026-10-20") }, now).level, "TIGHT");
});
test("in review due tomorrow is Tight not At Risk", () => {
  assert.equal(computeConfidence({ bucket: "REVIEW", isClosed: false, dueDate: d("2026-11-06"), startDate: d("2026-11-01") }, now).level, "TIGHT");
});
test("plenty of time is On Track", () => {
  assert.equal(computeConfidence({ bucket: "IN_PROGRESS", isClosed: false, dueDate: d("2026-11-25"), completionPct: 10, startDate: d("2026-11-03") }, now).level, "ON_TRACK");
});
test("progress far behind time used is Tight", () => {
  assert.equal(computeConfidence({ bucket: "READY", isClosed: false, dueDate: d("2026-11-12"), completionPct: 0, startDate: d("2026-10-20") }, now).level, "TIGHT");
});
test("no due date flagged", () => {
  assert.equal(computeConfidence({ bucket: "IN_PROGRESS", isClosed: false }, now).level, "NO_DUE_DATE");
});
test("done late reports days", () => {
  const r = computeConfidence({ bucket: "COMPLETED", isClosed: true, dueDate: d("2026-11-01"), completedAt: d("2026-11-04") }, now);
  assert.equal(r.level, "DONE");
  assert.match(r.reason, /3 days late/);
});
test("alerts only on worsening into Tight/At Risk", () => {
  assert.equal(shouldAlert("ON_TRACK", "TIGHT"), true);
  assert.equal(shouldAlert("TIGHT", "AT_RISK"), true);
  assert.equal(shouldAlert("AT_RISK", "AT_RISK"), false);
  assert.equal(shouldAlert("AT_RISK", "TIGHT"), false);
  assert.equal(shouldAlert("TIGHT", "ON_TRACK"), false);
});
