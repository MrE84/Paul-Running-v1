import test from "node:test";
import assert from "node:assert/strict";
import { linkActivitiesToItems } from "./link-activities";

const dateKey = (value: string) => value.slice(0, 10);

const item = (id: string, status: string, time: string) => ({
  id,
  status,
  scheduledStart: `2026-09-30T${time}:00.000Z`,
  scheduledLocalDate: "2026-09-30",
});

test("one activity is linked to at most one item and superseded items are untouched", () => {
  const items = [
    item("old-1", "superseded", "04:30"),
    item("old-2", "superseded", "11:30"),
    item("planned-a", "planned", "16:30"),
    item("planned-b", "planned", "17:00"),
  ];
  const activities = [{ id: "act-1", startedAt: "2026-09-30T18:47:00.000Z" }];

  const result = linkActivitiesToItems(items, activities, dateKey);

  assert.equal(result.filter((entry) => entry.activity).length, 1);
  assert.equal(result.find((entry) => entry.id === "planned-b")?.activity?.id, "act-1");
  assert.equal(result.find((entry) => entry.id === "planned-b")?.status, "completed");
  assert.equal(result.find((entry) => entry.id === "planned-a")?.status, "planned");
  assert.equal(result.find((entry) => entry.id === "old-1")?.status, "superseded");
  assert.equal(result.find((entry) => entry.id === "old-2")?.activity, undefined);
});

test("explicit calendarItemId links win and are never duplicated onto other items", () => {
  const items = [item("a", "planned", "10:00"), item("b", "planned", "11:00")];
  const activities = [{ id: "act-1", startedAt: "2026-09-30T10:05:00.000Z", calendarItemId: "b" }];

  const result = linkActivitiesToItems(items, activities, dateKey);

  assert.equal(result.find((entry) => entry.id === "b")?.activity?.id, "act-1");
  assert.equal(result.find((entry) => entry.id === "a")?.activity, undefined);
  assert.equal(result.find((entry) => entry.id === "a")?.status, "planned");
});

test("an explicit link to a superseded item is ignored", () => {
  const items = [item("old", "superseded", "10:00")];
  const activities = [{ id: "act-1", startedAt: "2026-09-30T10:05:00.000Z", calendarItemId: "old" }];

  const [result] = linkActivitiesToItems(items, activities, dateKey);

  assert.equal(result.status, "superseded");
  assert.equal(result.activity, undefined);
});

test("activities on other days are not inferred onto planned items", () => {
  const items = [item("a", "planned", "10:00")];
  const activities = [{ id: "act-1", startedAt: "2026-09-29T10:05:00.000Z" }];

  const [result] = linkActivitiesToItems(items, activities, dateKey);

  assert.equal(result.status, "planned");
  assert.equal(result.activity, undefined);
});
