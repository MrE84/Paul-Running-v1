import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisProjection } from "../activity-analysis/projection";
import type { TrainingApiRuntimeBundle } from "../training-api/runtime";
import { activityMcpTools, handleActivityMcpRequest } from "./activity-bridge";

function request(body: unknown, token = "test-token") {
  return new Request("https://example.test/api/activity-mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

const projection: AnalysisProjection = {
  version: "test",
  source: { id: "src-1", name: "Saturday run.fit", origin: "backend" },
  activity: { id: "i185832465", title: "Saturday run", sport: "running", startedAt: "2026-09-12T07:32:00.000Z", distance: 5000, duration: 1500 },
  summary: { distance: 5000, duration: 1500, elapsed: 1500, speed: 3.33, heartRate: 165, cadence: 172, ascent: 42, calories: 350 },
  streams: {
    elapsed: [1120, 1123, 1126],
    distance: [3700, 3710, 3720],
    latitude: [51.9, 51.9001, 51.9002],
    longitude: [-2.08, -2.0801, -2.0802],
    recordIndex: [410, 411, 412],
    breakBefore: [false, false, false],
    channels: {
      heart_rate: [163, 165, 166],
      pace: [315, 312, 310],
      speed: [3.175, 3.205, 3.226],
      altitude: [67.1, 67.4, 67.9],
      cadence: [170, 172, 174],
    },
  },
  laps: [],
  zones: {},
  provenance: { sourceFields: ["heart_rate", "enhanced_speed", "enhanced_altitude", "cadence"], algorithms: { projection: "test" } },
  quality: { flags: [], inputRecords: 3, samples: 3, missing: {} },
  derived: {
    intervals: { version: "1", status: "pending", sourceChannels: ["speed"] },
    zones: { version: "1", status: "pending", sourceChannels: [] },
    weather: { version: "1", status: "pending", sourceChannels: [] },
    bestEfforts: { version: "1", status: "pending", sourceChannels: ["speed"] },
    efficiency: { version: "1", status: "pending", sourceChannels: ["heart_rate", "speed"] },
    plannedActual: { version: "1", status: "pending", sourceChannels: [] },
  },
};

function runtime(): TrainingApiRuntimeBundle {
  const service = {
    listActivitySummaries: async () => [projection.activity],
    getActivityAnalysis: async () => projection,
    getActivity: async () => ({
      id: projection.activity.id,
      athleteId: "primary-athlete",
      sport: "running",
      startedAt: projection.activity.startedAt,
      sourceFileName: "Saturday run.fit",
      sourceMetadata: { name: "Saturday run" },
      normalizedData: { records: [{ heart_rate: 165, enhanced_altitude: 67.4 }] },
    }),
  };
  return {
    service,
    primaryAthleteId: "primary-athlete",
    storageMode: "memory_reference",
    intervalsIcuConfigured: false,
    activityImportConfigured: false,
  } as unknown as TrainingApiRuntimeBundle;
}

test("activity MCP requires bearer authentication", async () => {
  const response = await handleActivityMcpRequest(
    new Request("https://example.test/api/activity-mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    { token: "test-token" },
  );
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.error.data.code, "UNAUTHORIZED");
});

test("activity MCP exposes only the constrained read-only activity catalog", async () => {
  const response = await handleActivityMcpRequest(
    request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    { token: "test-token", runtime: runtime() },
  );
  const payload = await response.json();
  assert.deepEqual(payload.result.tools.map((tool: { name: string }) => tool.name), activityMcpTools.map(tool => tool.name));
  assert.deepEqual(payload.result.tools.map((tool: { name: string }) => tool.name), [
    "list_activities",
    "get_activity_analysis",
    "get_activity_raw",
    "get_activity_sample",
  ]);
});

test("activity MCP returns the complete sample projection", async () => {
  const response = await handleActivityMcpRequest(
    request({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_activity_analysis", arguments: { activityId: "i185832465" } } }),
    { token: "test-token", runtime: runtime() },
  );
  const payload = await response.json();
  const value = payload.result.structuredContent as AnalysisProjection;
  assert.equal(value.activity.id, "i185832465");
  assert.deepEqual(value.streams.elapsed, [1120, 1123, 1126]);
  assert.deepEqual(value.streams.channels.heart_rate, [163, 165, 166]);
  assert.deepEqual(value.streams.channels.altitude, [67.1, 67.4, 67.9]);
  assert.deepEqual(value.streams.latitude, [51.9, 51.9001, 51.9002]);
});

test("activity MCP returns the nearest sample at an elapsed time", async () => {
  const response = await handleActivityMcpRequest(
    request({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_activity_sample", arguments: { activityId: "i185832465", elapsedSeconds: 1123 } } }),
    { token: "test-token", runtime: runtime() },
  );
  const payload = await response.json();
  const value = payload.result.structuredContent;
  assert.equal(value.elapsedSeconds, 1123);
  assert.equal(value.heartRateBpm, 165);
  assert.equal(value.paceSecondsPerKm, 312);
  assert.equal(value.elevationMetres, 67.4);
  assert.equal(value.cadenceSpm, 172);
  assert.equal(value.latitude, 51.9001);
  assert.equal(value.longitude, -2.0801);
});

test("activity MCP exposes the stored decoded FIT payload", async () => {
  const response = await handleActivityMcpRequest(
    request({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_activity_raw", arguments: { activityId: "i185832465" } } }),
    { token: "test-token", runtime: runtime() },
  );
  const payload = await response.json();
  assert.equal(payload.result.structuredContent.activity.id, "i185832465");
  assert.equal(payload.result.structuredContent.normalizedData.records[0].heart_rate, 165);
});
