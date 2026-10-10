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

test("usage adds the historical baseline without double counting tracked activities", () => {
  const activities = [
    baseActivity({ id: "threshold", summary: { distanceMeters: 10000 } }),
    baseActivity({
      id: "easy",
      startedAt: "2026-10-15T17:00:00.000Z",
      summary: { distanceMeters: 8000 },
      sourceMetadata: { shoeName: "Adizero Evo SL" },
    }),
  ];
  const usage = buildShoeUsage(activities, sessions, "Europe/London", "2026-10-16T12:00:00.000Z");
  const puma = usage.summaries.find((item) => item.shoe.key === "puma-deviate-nitro-3-hyrox");
  const evo = usage.summaries.find((item) => item.shoe.key === "adidas-evo-sl");
  const sky = usage.summaries.find((item) => item.shoe.key === "asics-metaspeed-sky-tokyo");

  assert.equal(puma?.trackedDistanceKm, 10);
  assert.equal(puma?.estimatedHistoricalKm, 0);
  assert.equal(puma?.totalDistanceKm, 10);
  assert.equal(evo?.trackedDistanceKm, 8);
  assert.equal(evo?.estimatedHistoricalKm, 186.98);
  assert.equal(evo?.totalDistanceKm, 194.98);
  assert.equal(sky?.estimatedHistoricalKm, 30.98);
  assert.equal(sky?.totalDistanceKm, 30.98);
  assert.equal(usage.assignments.length, 2);
});

test("lifecycle countdowns use total estimated plus tracked mileage", () => {
  const usage = buildShoeUsage([], [], "Europe/London", "2026-10-10T12:00:00.000Z");
  const evo = usage.summaries.find((item) => item.shoe.key === "adidas-evo-sl");
  const sky = usage.summaries.find((item) => item.shoe.key === "asics-metaspeed-sky-tokyo");

  assert.equal(evo?.remainingToReviewKm, 213.02);
  assert.equal(evo?.remainingToReplaceKm, 363.02);
  assert.equal(evo?.status, "healthy");
  assert.equal(sky?.remainingToReviewKm, 119.02);
  assert.equal(sky?.remainingToReplaceKm, 219.02);
});

test("swap forecast appears only after enough automatic tracking history exists", () => {
  const activities = [
    baseActivity({
      id: "easy-1",
      startedAt: "2026-10-11T09:00:00.000Z",
      summary: { distanceMeters: 10000 },
      sourceMetadata: { shoeName: "Adizero Evo SL" },
    }),
    baseActivity({
      id: "easy-2",
      startedAt: "2026-10-20T09:00:00.000Z",
      summary: { distanceMeters: 10000 },
      sourceMetadata: { shoeName: "Adizero Evo SL" },
    }),
    baseActivity({
      id: "easy-3",
      startedAt: "2026-10-28T09:00:00.000Z",
      summary: { distanceMeters: 10000 },
      sourceMetadata: { shoeName: "Adizero Evo SL" },
    }),
  ];
  const usage = buildShoeUsage(activities, [], "Europe/London", "2026-10-30T12:00:00.000Z");
  const evo = usage.summaries.find((item) => item.shoe.key === "adidas-evo-sl");
  assert.ok(evo?.projectedReplaceDate);
  assert.ok(evo?.projectedReviewDate);
});
