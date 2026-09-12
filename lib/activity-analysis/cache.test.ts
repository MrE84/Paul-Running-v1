import assert from "node:assert/strict";
import test from "node:test";
import type { Activity } from "../domain/contracts";
import {
  activityAnalysisProjectionCacheSize,
  clearActivityAnalysisProjectionCache,
  getCachedActivityAnalysisProjection,
} from "./cache";
import { buildCanonicalActivityAnalysisReadModel } from "./read-model";

const decoded = {
  sessions: [{ sport: "running", start_time: "2026-09-12T08:00:00.000Z", total_elapsed_time: 2, total_distance: 8 }],
  records: [
    { timestamp: "2026-09-12T08:00:00.000Z", distance: 0, heart_rate: 140 },
    { timestamp: "2026-09-12T08:00:01.000Z", distance: 4, heart_rate: 142 },
    { timestamp: "2026-09-12T08:00:02.000Z", distance: 8, heart_rate: 144 },
  ],
};

const source = { id: "activity-cache-test", name: "cache.fit", origin: "backend" as const };

test("projection cache reuses the immutable versioned read model", () => {
  clearActivityAnalysisProjectionCache();
  const first = getCachedActivityAnalysisProjection(source, decoded);
  const second = getCachedActivityAnalysisProjection(source, decoded);
  assert.equal(first, second);
  assert.equal(activityAnalysisProjectionCacheSize(), 1);
  clearActivityAnalysisProjectionCache(source.id);
  assert.equal(activityAnalysisProjectionCacheSize(), 0);
});

test("canonical read model omits normalizedData while retaining projection", () => {
  clearActivityAnalysisProjectionCache();
  const activity = {
    id: "activity-cache-test",
    athleteId: "athlete-1",
    sport: "running",
    startedAt: "2026-09-12T08:00:00.000Z",
    summary: { durationSeconds: 2, distanceMeters: 8 },
    normalizedData: decoded,
    sourceFileName: "cache.fit",
    sourceMetadata: { externalId: "intervals-123" },
    createdAt: "2026-09-12T08:05:00.000Z",
    updatedAt: "2026-09-12T08:05:00.000Z",
  } as Activity;
  const readModel = buildCanonicalActivityAnalysisReadModel(activity);
  assert.equal(readModel.activity.id, activity.id);
  assert.equal(readModel.activity.sourceMetadata.externalId, "intervals-123");
  assert.equal(readModel.projection.stream.length, 3);
  assert.equal("normalizedData" in readModel.activity, false);
});
