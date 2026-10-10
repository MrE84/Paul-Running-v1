import assert from "node:assert/strict";
import test from "node:test";
import type { Activity } from "../domain/contracts";
import {
  assignActivityShoe,
  buildShoeUsage,
  prescribedShoeKeyForTitle,
  type PlannedShoeSession,
} from "../shoe-rotation";

test("shoe prescription separates easy, quality and race work", () => {
  assert.equal(prescribedShoeKeyForTitle("Long Aerobic 85 min"), "adidas-evo-sl");
  assert.equal(prescribedShoeKeyForTitle("Easy aerobic + strides"), "adidas-evo-sl");
  assert.equal(prescribedShoeKeyForTitle("Threshold 3 × 10 min"), "puma-deviate-nitro-3-hyrox");
  assert.equal(prescribedShoeKeyForTitle("Controlled parkrun 95%"), "puma-deviate-nitro-3-hyrox");
  assert.equal(prescribedShoeKeyForTitle("5K benchmark / parkrun"), "asics-metaspeed-sky-tokyo");
  assert.equal(prescribedShoeKeyForTitle("10K PB Attempt #1"), "asics-metaspeed-sky-tokyo");
  assert.equal(prescribedShoeKeyForTitle("Strength / no run"), null);
});

const baseActivity = (overrides: Partial<Activity> = {}): Activity => ({
  id: "activity-1",
  athleteId: "primary-athlete",
  sport: "running",
  startedAt: "2026-10-14T17:55:00.000Z",
  endedAt: "2026-10-14T18:45:00.000Z",
  summary: { distanceMeters: 10000, durationSeconds: 3000 },
  normalizedData: {},
  sourceMetadata: {},
  createdAt: "2026-10-14T19:00:00.000Z",
  updatedAt: "2026-10-14T19:00:00.000Z",
  ...overrides,
});

const sessions: PlannedShoeSession[] = [
  {
    id: "threshold-session",
    scheduledStart: "2026-10-14T17:00:00.000Z",
    timezone: "Europe/London",
    title: "Threshold 3 × 10 min",
  },
];

test("a completed run inherits the prescribed shoe from the planned session", () => {
  const assignment = assignActivityShoe(baseActivity(), sessions);
  assert.equal(assignment?.shoeKey, "puma-deviate-nitro-3-hyrox");
  assert.equal(assignment?.source, "planned_session");
  assert.equal(assignment?.distanceKm, 10);
});

test("actual shoe metadata overrides the planned shoe", () => {
  const activity = baseActivity({
    sourceMetadata: { shoe: "Adidas Adizero Evo SL" },
  });
  const assignment = assignActivityShoe(activity, sessions);
  assert.equal(assignment?.shoeKey, "adidas-evo-sl");
  assert.equal(assignment?.source, "activity_metadata");
});

test("usage is derived from activities so re-rendering does not double count", () => {
  const activities = [
    baseActivity({ id: "threshold", summary: { distanceMeters: 10000 } }),
    baseActivity({
      id: "easy",
      startedAt: "2026-10-15T17:00:00.000Z",
      summary: { distanceMeters: 8000 },
      sourceMetadata: { shoeName: "Adizero Evo SL" },
    }),
  ];
  const usage = buildShoeUsage(activities, sessions);
  assert.equal(usage.summaries.find((item) => item.shoe.key === "puma-deviate-nitro-3-hyrox")?.distanceKm, 10);
  assert.equal(usage.summaries.find((item) => item.shoe.key === "adidas-evo-sl")?.distanceKm, 8);
  assert.equal(usage.assignments.length, 2);
});
