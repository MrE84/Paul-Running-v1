import test from "node:test";
import assert from "node:assert/strict";
import type { Activity } from "../domain/contracts";
import { assessActivityData } from "./readiness";

function activity(normalizedData: Record<string, unknown>, overrides: Partial<Activity> = {}): Activity {
  return {
    id: "activity-1",
    athleteId: "athlete-1",
    sport: "running",
    startedAt: "2026-09-12T08:00:00.000Z",
    summary: { durationSeconds: 1200, distanceMeters: 5000 },
    normalizedData,
    sourceFileSha256: "a".repeat(64),
    sourceMetadata: {},
    createdAt: "2026-09-12T09:00:00.000Z",
    updatedAt: "2026-09-12T09:00:00.000Z",
    ...overrides,
  };
}

test("readiness exposes safe counts for complete FIT-backed activity data", () => {
  const result = assessActivityData(activity({
    sessions: [{ sport: "running" }],
    records: [
      { timestamp: "2026-09-12T08:00:00.000Z", heart_rate: 130, position_lat: 10, position_long: 20 },
      { timestamp: "2026-09-12T08:00:01.000Z", heart_rate: 131, position_lat: 11, position_long: 21 },
    ],
    laps: [{ total_timer_time: 1200 }],
  }));
  assert.equal(result.state, "complete");
  assert.equal(result.recordCount, 2);
  assert.equal(result.lapCount, 1);
  assert.equal(result.gpsPointCount, 2);
  assert.equal(result.channelCount, 1);
  assert.equal(result.sourceFileHashAvailable, true);
  assert.deepEqual(result.reasons, []);
});

test("readiness distinguishes summary-only, partial and invalid canonical data", () => {
  const summaryOnly = assessActivityData(activity({}, { sourceFileSha256: undefined }));
  assert.equal(summaryOnly.state, "summary_only");
  assert.match(summaryOnly.reasons.join(" "), /detailed FIT records/i);

  const partial = assessActivityData(activity({ records: [{ timestamp: "2026-09-12T08:00:00.000Z", heart_rate: 130 }] }));
  assert.equal(partial.state, "partial");

  const missingHash = assessActivityData(activity({ records: [
    { timestamp: "2026-09-12T08:00:00.000Z", heart_rate: 130 },
    { timestamp: "2026-09-12T08:00:01.000Z", heart_rate: 131 },
  ] }, { sourceFileSha256: undefined }));
  assert.equal(missingHash.state, "partial");

  const invalid = assessActivityData(activity({}, { summary: {} }));
  assert.equal(invalid.state, "invalid");
});
