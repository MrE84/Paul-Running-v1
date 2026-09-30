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
      sourceMetadata: { name: "Saturday run", externalId: "i185832465" },
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

test("activity MCP exposes tool metadata before authentication and challenges on tool calls", async () => {
  const listed = await handleActivityMcpRequest(
    new Request("https://example.test/api/activity-mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
    { token: "test-token", runtime: runtime() },
  );
  assert.equal(listed.status, 200);
  const catalog = await listed.json();
  assert.equal(catalog.result.tools[0].securitySchemes[0].type, "oauth2");
  assert.deepEqual(catalog.result.tools[0].securitySchemes[0].scopes, ["activities:read"]);

  const called = await handleActivityMcpRequest(
    new Request("https://example.test/api/activity-mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_activities", arguments: {} } }),
    }),
    { token: "test-token", runtime: runtime() },
  );
  assert.equal(called.status, 200);
  const payload = await called.json();
  assert.equal(payload.result.isError, true);
  assert.match(payload.result._meta["mcp/www_authenticate"][0], /scope="activities:read"/);
  assert.match(payload.result._meta["mcp/www_authenticate"][0], /error="invalid_token"/);
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
    "get_activity_debrief",
    "list_activity_debriefs",
    "compare_provider_streams",
  ]);
});

test("activity MCP supports 2026-07-28 discovery and tool listing", async () => {
  const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };
  const discovered = await handleActivityMcpRequest(
    request({ jsonrpc: "2.0", id: 20, method: "server/discover", params: { _meta: meta } }),
    { token: "test-token", runtime: runtime() },
  );
  const discovery = await discovered.json();
  assert.equal(discovery.result.resultType, "complete");
  assert.deepEqual(discovery.result.supportedVersions, ["2026-07-28"]);
  assert.equal(discovery.result.capabilities.tools.listChanged, false);
  assert.equal(discovery.result._meta["io.modelcontextprotocol/serverInfo"].name, "pauls-running-activity");

  const listed = await handleActivityMcpRequest(
    request({ jsonrpc: "2.0", id: 21, method: "tools/list", params: { _meta: meta } }),
    { token: "test-token", runtime: runtime() },
  );
  const payload = await listed.json();
  assert.equal(payload.result.resultType, "complete");
  assert.equal(payload.result.cacheScope, "private");
  assert.deepEqual(payload.result.tools.map((tool: { name: string }) => tool.name), [
    "list_activities",
    "get_activity_analysis",
    "get_activity_raw",
    "get_activity_sample",
    "get_activity_debrief",
    "list_activity_debriefs",
    "compare_provider_streams",
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

test("activity MCP compares Intervals.icu HR streams with the canonical FIT projection", async () => {
  const bundle = runtime();
  const requested: string[] = [];
  bundle.providerStreams = {
    getActivityStreams: async (id) => {
      requested.push(id);
      return [
        { type: "time", data: [1120, 1123, 1126, 5000] },
        { type: "heartrate", data: [163, 165, 168, 150] },
        { type: "raw_heartrate", data: [163, 166, 166, 150] },
      ];
    },
  };
  const response = await handleActivityMcpRequest(
    request({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "compare_provider_streams", arguments: { activityId: "i185832465" } } }),
    { token: "test-token", runtime: bundle },
  );
  const value = (await response.json()).result.structuredContent;
  assert.deepEqual(requested, ["i185832465"]);
  assert.equal(value.canonicalModified, false);
  assert.equal(value.rawHeartRateAvailable, true);
  const [hr, raw, fixed] = value.heartRate;
  assert.equal(hr.alignedSamples, 3);
  assert.equal(hr.maxAbsoluteDiffBpm, 2);
  assert.equal(hr.withinOneBpmPercent, 66.7);
  assert.equal(raw.meanAbsoluteDiffBpm, 0.33);
  assert.equal(fixed.available, false);
  assert.deepEqual(projection.streams.channels.heart_rate, [163, 165, 166]);
});

test("activity MCP stream comparison reports when Intervals.icu is not configured", async () => {
  const response = await handleActivityMcpRequest(
    request({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "compare_provider_streams", arguments: { activityId: "i185832465" } } }),
    { token: "test-token", runtime: runtime() },
  );
  const payload = await response.json();
  assert.equal(payload.result.isError, true);
  assert.equal(payload.result.structuredContent.error.code, "INTERVALS_ICU_NOT_CONFIGURED");
});
