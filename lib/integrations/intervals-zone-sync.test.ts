import test from "node:test";
import assert from "node:assert/strict";
import type { CapacityRevision, ZoneSet } from "../domain/contracts";
import { IntervalsZoneSync, toIntervalsHeartRateSettings } from "./intervals-icu/zone-sync";

const capacity: CapacityRevision = {
  id: "cap", athleteId: "a", effectiveFrom: "2026-09-29T00:00:00.000Z", lt2HrBpm: 176, maxHrBpm: 198,
  source: "athlete-reported", createdAt: "2026-09-29T00:00:00.000Z",
};

function zoneSet(overrides: Partial<ZoneSet> = {}): ZoneSet {
  const bounds: Array<[string, number | undefined, number | undefined]> = [
    ["Z1 Recovery", undefined, 149], ["Z2 Easy", 150, 157], ["Z3 Tempo", 158, 165], ["Z4 Threshold", 166, 175], ["Z5 VO2", 176, 198],
  ];
  return {
    id: "zs", athleteId: "a", sport: "running", targetType: "heart_rate", name: "Running HR", effectiveFrom: "2026-09-29T00:00:00.000Z",
    source: "test", createdAt: "2026-09-29T00:00:00.000Z",
    zones: bounds.map(([name, lowerBound, upperBound], index) => ({
      id: `z${index + 1}`, zoneNumber: index + 1, name, unit: "bpm",
      ...(lowerBound !== undefined ? { lowerBound } : {}), ...(upperBound !== undefined ? { upperBound } : {}),
    })),
    ...overrides,
  };
}

test("maps canonical HR zones to Intervals.icu Run sport settings upper bounds", () => {
  const { activityType, settings } = toIntervalsHeartRateSettings(zoneSet(), capacity);
  assert.equal(activityType, "Run");
  assert.deepEqual(settings, {
    hr_zones: [149, 157, 165, 175, 198],
    hr_zone_names: ["Z1 Recovery", "Z2 Easy", "Z3 Tempo", "Z4 Threshold", "Z5 VO2"],
    lthr: 176,
    max_hr: 198,
  });
});

test("closes an open top zone at max HR and requires max HR when it is missing", () => {
  const open = zoneSet();
  delete open.zones[4].upperBound;
  assert.equal(toIntervalsHeartRateSettings(open, capacity).settings.hr_zones.at(-1), 198);
  assert.throws(() => toIntervalsHeartRateSettings(open, { ...capacity, maxHrBpm: undefined }), /maxHrBpm/);
  assert.throws(() => toIntervalsHeartRateSettings(zoneSet({ targetType: "pace" }), capacity), /heart-rate/);
});

test("pushes with recalcHrZones=false and reports HTTP failures without throwing", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const ok = new IntervalsZoneSync({
    apiKey: "key", intervalsAthleteId: "i123",
    fetchImpl: (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); }) as typeof fetch,
  });
  const sent = await ok.push(zoneSet(), capacity);
  assert.equal(sent.state, "sent");
  assert.equal(calls[0].url, "https://intervals.icu/api/v1/athlete/i123/sport-settings/Run?recalcHrZones=false");
  assert.equal(calls[0].init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)).hr_zones, [149, 157, 165, 175, 198]);

  const failing = new IntervalsZoneSync({
    apiKey: "key",
    fetchImpl: (async () => new Response("nope", { status: 422 })) as typeof fetch,
  });
  const failed = await failing.push(zoneSet(), capacity);
  assert.equal(failed.state, "failed");
  assert.equal(failed.state === "failed" && failed.code, "INTERVALS_HTTP_ERROR");
});
