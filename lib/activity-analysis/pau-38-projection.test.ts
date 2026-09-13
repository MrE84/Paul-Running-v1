import assert from "node:assert/strict";
import test from "node:test";
import { projectActivity } from "./projection";
import { routeSamples } from "./selection";

const source = { id: "pau-38", name: "pau-38.fit", origin: "browser" as const };

test("PAU-38 projection coalesces duplicate timestamps without discarding GPS fields", () => {
  const projection = projectActivity(source, {
    sessions: [{ sport: "running", total_elapsed_time: 4, total_timer_time: 4 }],
    records: [
      {
        timestamp: "2026-09-12T07:32:24.000Z",
        elapsed_time: 0,
        position_lat: 51.9382652733475,
        position_long: -2.066009296104312,
        distance: 0,
      },
      {
        timestamp: "2026-09-12T07:32:24.000Z",
        elapsed_time: 0,
        heart_rate: 69,
        cadence: 47,
        temperature: 26,
      },
      {
        timestamp: "2026-09-12T07:32:28.000Z",
        elapsed_time: 4,
        position_lat: 51.93852477706969,
        position_long: -2.0660135708749294,
        distance: 6.61,
        heart_rate: 72,
      },
    ],
  });

  assert.equal(projection.quality.inputRecords, 3);
  assert.equal(projection.quality.samples, 2);
  assert.equal(projection.streams.latitude[0], 51.938265);
  assert.equal(projection.streams.longitude[0], -2.066009);
  assert.equal(projection.streams.channels.heart_rate?.[0], 69);
  assert.equal(projection.streams.latitude[1], 51.938525);
  assert.equal(routeSamples(projection, 0, [], 2_000).length, 2);
  assert.ok(projection.quality.flags.some(flag => flag.includes("Duplicate timestamps coalesced field-wise")));
});
