import assert from "node:assert/strict";
import test from "node:test";
import { buildMonthGrid, monthLabel, monthQueryRange, shiftMonthKey } from "./month-grid";

test("September 2026 renders a Monday-first six-week month grid", () => {
  const cells = buildMonthGrid("2026-09");
  assert.equal(cells.length, 42);
  assert.equal(cells[0].date, "2026-08-31");
  assert.equal(cells[1].date, "2026-09-01");
  assert.equal(cells[1].inMonth, true);
  assert.equal(cells[41].date, "2026-10-11");
  assert.equal(cells[41].inMonth, false);
});

test("month navigation crosses year boundaries", () => {
  assert.equal(shiftMonthKey("2026-12", 1), "2027-01");
  assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
  assert.equal(monthLabel("2026-09"), "September 2026");
});

test("month query range includes the full visible grid plus edge padding", () => {
  const range = monthQueryRange("2026-09");
  assert.equal(range.from, "2026-08-30T00:00:00.000Z");
  assert.equal(range.to, "2026-10-12T23:59:59.999Z");
});
