import test from "node:test";
import assert from "node:assert/strict";
import { analyseDecodedFit } from "../activity-analysis";
import type { Athlete } from "../domain/contracts";
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
  assert.equal(second.alreadyImported, 1);
  assert.equal((await store.listActivities(athlete.id, 10)).length, 1);
  assert.equal(requests.filter((url) => url.endsWith("/activity/act-1/file")).length, 1);
});
