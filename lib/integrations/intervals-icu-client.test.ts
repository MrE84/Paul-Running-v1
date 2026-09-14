import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INTERVALS_ACTIVITY_STREAM_TYPES,
  IntervalsIcuClient,
  intervalsEventHasParsedWorkout,
} from "./intervals-icu/client";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("activity streams preserve complete arrays and explicitly request raw HR variants", async () => {
  let requestedUrl = "";
  const heartRate = Array.from({ length: 20 }, (_, index) => 140 + index);
  const rawHeartRate = Array.from({ length: 20 }, (_, index) => 141 + index);
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return jsonResponse([
      { type: "heartrate", data: heartRate },
      { type: "raw_heartrate", data: rawHeartRate },
      { type: "latlng", data: [51.9, 51.91], data2: [-2.06, -2.05] },
    ]);
  }) as typeof fetch;

  const client = new IntervalsIcuClient({
    auth: { type: "api_key", apiKey: "test" },
    fetchImpl,
  });
  const response = await client.getActivityStreams("i185832465");

  const url = new URL(requestedUrl);
  const requestedTypes = url.searchParams.get("types")?.split(",") ?? [];
  assert.deepEqual(requestedTypes, [...DEFAULT_INTERVALS_ACTIVITY_STREAM_TYPES]);
  assert.ok(requestedTypes.includes("raw_heartrate"));
  assert.ok(requestedTypes.includes("fixed_heartrate"));
  assert.equal(response.data[0]?.data?.length, 20);
  assert.deepEqual(response.data[1]?.data, rawHeartRate);
  assert.deepEqual(response.data[2]?.data2, [-2.06, -2.05]);
});

test("activity stream reads allow a narrow explicit stream selection", async () => {
  let requestedUrl = "";
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return jsonResponse([{ type: "raw_heartrate", data: [170, 171, 172] }]);
  }) as typeof fetch;

  const client = new IntervalsIcuClient({
    auth: { type: "api_key", apiKey: "test" },
    fetchImpl,
  });
  await client.getActivityStreams("activity/with spaces", ["raw_heartrate"]);

  const url = new URL(requestedUrl);
  assert.match(url.pathname, /activity\/activity%2Fwith%20spaces\/streams$/);
  assert.equal(url.searchParams.get("types"), "raw_heartrate");
});

test("activity intervals and provider workout parse state are exposed without changing canonical models", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/intervals")) {
      return jsonResponse({ icu_intervals: [{ id: 1, duration: 300 }], icu_groups: [] });
    }
    return jsonResponse({
      id: 42,
      external_id: "paul-running:calendar-1",
      workout_doc: { steps: [{ duration: 600 }] },
    });
  }) as typeof fetch;

  const client = new IntervalsIcuClient({
    auth: { type: "api_key", apiKey: "test" },
    athleteId: "i123",
    fetchImpl,
  });

  const intervals = await client.getActivityIntervals("a1");
  const event = await client.getEvent("42");

  assert.equal(intervals.data.icu_intervals?.length, 1);
  assert.equal(intervalsEventHasParsedWorkout(event.data), true);
  assert.equal(intervalsEventHasParsedWorkout({ id: 43, workout_doc: { steps: [] } }), false);
  assert.match(calls[0] ?? "", /\/activity\/a1\/intervals$/);
  assert.match(calls[1] ?? "", /\/athlete\/i123\/events\/42$/);
});
