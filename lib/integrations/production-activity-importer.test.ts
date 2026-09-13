import test from "node:test";
import assert from "node:assert/strict";
import { analyseDecodedFit } from "../activity-analysis";
import type { Activity, Athlete, ExternalReference } from "../domain/contracts";
import { InMemoryTrainingApiStore } from "../training-api/store";
import { ProductionActivityImporter } from "./production-activity-importer";
import { InMemoryIntegrationStateStore } from "./state";

const athlete: Athlete = {
  id: "athlete-activity-import",
  displayName: "Activity Import",
  timezone: "Europe/London",
  createdAt: "2026-09-12T12:00:00.000Z",
  updatedAt: "2026-09-12T12:00:00.000Z",
};

test("production activity importer downloads FIT detail, persists canonical analysis and deduplicates provider activity IDs", async () => {
  const store = new InMemoryTrainingApiStore({ athletes: [athlete] });
  const state = new InMemoryIntegrationStateStore();
  let id = 0;
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    const auth = new Headers(init?.headers).get("Authorization");
    assert.match(auth ?? "", /^Basic /);

    if (url.endsWith("/activity/act-1/file")) {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
    if (url.endsWith("/activity/act-1")) {
      return new Response(JSON.stringify({
        id: "act-1",
        type: "Run",
        start_date: "2026-09-12T08:00:00.000Z",
        name: "Morning Run",
        file_type: "fit",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/athlete/intervals-athlete/activities?")) {
      return new Response(JSON.stringify([{
        id: "act-1",
        type: "Run",
        start_date: "2026-09-12T08:00:00.000Z",
        file_type: "fit",
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const importer = new ProductionActivityImporter({
    store,
    state,
    runtime: {
      idFactory: () => `id-${++id}`,
      now: () => "2026-09-12T15:30:00.000Z",
    },
    apiKey: "secret",
    athleteId: athlete.id,
    intervalsAthleteId: "intervals-athlete",
    fetchImpl,
    analyseFit: async (_bytes, activity) => analyseDecodedFit(
      {
        id: activity.externalId,
        name: `${activity.externalId}.fit`,
        origin: "backend",
        externalId: activity.externalId,
      },
      {
        protocolVersion: 2,
        profileVersion: 2200,
        sessions: [{
          sport: "running",
          start_time: "2026-09-12T08:00:00.000Z",
          timestamp: "2026-09-12T08:25:00.000Z",
          total_timer_time: 1500,
          total_elapsed_time: 1510,
          total_distance: 5000,
          enhanced_avg_speed: 3.3333333333,
          avg_heart_rate: 151,
          max_heart_rate: 171,
          avg_cadence: 86,
          total_ascent: 42,
          total_descent: 40,
        }],
        records: [
          { timestamp: "2026-09-12T08:00:00.000Z", heart_rate: 130, distance: 0, enhanced_altitude: 55 },
          { timestamp: "2026-09-12T08:25:00.000Z", heart_rate: 168, distance: 5000, enhanced_altitude: 57 },
        ],
        laps: [],
      },
    ),
  });

  const first = await importer.importRecent(1);
  assert.equal(first.imported, 1);
  assert.equal(first.alreadyImported, 0);
  assert.equal(first.failed, 0);

  const stored = await store.listActivities(athlete.id, 10);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].summary.distanceMeters, 5000);
  assert.equal(stored[0].summary.avgHrBpm, 151);
  assert.equal(stored[0].summary.maxHrBpm, 171);
  assert.equal(stored[0].summary.elevationGainMeters, 42);
  assert.ok(Math.abs((stored[0].summary.avgPaceSecPerKm ?? 0) - 300) < 0.01);
  assert.equal((stored[0].normalizedData.records as unknown[]).length, 2);
  assert.equal(stored[0].sourceMetadata.externalId, "act-1");
  assert.equal(stored[0].sourceFileSha256?.length, 64);

  const second = await importer.importRecent(1);
  assert.equal(second.imported, 0);
  assert.equal(second.alreadyComplete, 1);
  assert.equal((await store.listActivities(athlete.id, 10)).length, 1);
  assert.equal(requests.filter((url) => url.endsWith("/activity/act-1/file")).length, 1);

  const originalId = stored[0].id;
  const originalCreatedAt = stored[0].createdAt;
  await store.saveActivity({
    ...stored[0],
    calendarItemId: "calendar-1",
    normalizedData: {},
    sourceFileSha256: undefined,
    updatedAt: "2026-09-12T16:00:00.000Z",
  });
  const repaired = await importer.importRecent(1);
  assert.equal(repaired.repaired, 1);
  assert.equal(repaired.failed, 0);
  const restored = await store.getActivity(originalId);
  assert.equal(restored?.id, originalId);
  assert.equal(restored?.createdAt, originalCreatedAt);
  assert.equal(restored?.calendarItemId, "calendar-1");
  assert.equal((restored?.normalizedData.records as unknown[]).length, 2);
  assert.equal(restored?.sourceMetadata.repair && typeof restored.sourceMetadata.repair, "object");

  const afterRepair = await importer.importRecent(1);
  assert.equal(afterRepair.alreadyComplete, 1);
  assert.equal(requests.filter((url) => url.endsWith("/activity/act-1/file")).length, 2);
});

test("failed repair keeps the existing canonical activity unchanged and returns a safe reason", async () => {
  const store = new InMemoryTrainingApiStore({ athletes: [athlete] });
  const state = new InMemoryIntegrationStateStore();
  const legacy: Activity = {
    id: "stable-activity-id",
    athleteId: athlete.id,
    sport: "running",
    startedAt: "2026-09-11T08:00:00.000Z",
    summary: { durationSeconds: 1800, distanceMeters: 6000 },
    normalizedData: {},
    sourceMetadata: { provider: "intervals_icu", externalId: "act-broken" },
    createdAt: "2026-09-11T09:00:00.000Z",
    updatedAt: "2026-09-11T09:00:00.000Z",
  };
  await store.saveActivity(legacy);
  const reference: ExternalReference = {
    id: "reference-1",
    athleteId: athlete.id,
    entityType: "activity",
    entityId: legacy.id,
    provider: "intervals_icu",
    externalId: "act-broken",
    providerMetadata: {},
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  };
  await state.saveExternalReference(reference);

  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/activity/act-broken/file")) return new Response(new Uint8Array([0, 1, 2]), { status: 200 });
    if (url.endsWith("/activity/act-broken")) return new Response(JSON.stringify({ id: "act-broken", type: "Run", start_date: legacy.startedAt, file_type: "fit" }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("/activities?")) return new Response(JSON.stringify([{ id: "act-broken", type: "Run", start_date: legacy.startedAt, file_type: "fit" }]), { status: 200, headers: { "Content-Type": "application/json" } });
    throw new Error("Unexpected request");
  };
  const importer = new ProductionActivityImporter({
    store,
    state,
    runtime: { idFactory: () => "generated-id", now: () => "2026-09-12T15:30:00.000Z" },
    apiKey: "secret",
    athleteId: athlete.id,
    fetchImpl,
    analyseFit: async () => { throw new Error("decoder leaked internal detail"); },
  });

  const result = await importer.repairRecent(1);
  assert.equal(result.failed, 1);
  assert.equal(result.items[0]?.activityId, legacy.id);
  assert.equal(result.items[0]?.errorCode, "ACTIVITY_IMPORT_FAILED");
  assert.equal(result.items[0]?.errorMessage, "Activity detail could not be downloaded or decoded.");
  assert.deepEqual(await store.getActivity(legacy.id), legacy);
});
