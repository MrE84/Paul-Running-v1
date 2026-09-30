import assert from "node:assert/strict";
import test from "node:test";
import type { Activity, Athlete } from "../domain/contracts";
import { handleActivityMcpRequest } from "../mcp/activity-bridge";
import { handleMcpRequest } from "../mcp/bridge";
import { InMemoryIntegrationStateStore } from "../integrations/state";
import { InMemoryTrainingApiStore } from "../training-api/store";
import { TrainingApiError, TrainingApiService } from "../training-api/service";
import type { TrainingApiRuntimeBundle } from "../training-api/runtime";
import { DEBRIEF_LIMITS } from "./contracts";
import { DEBRIEF_PROTOCOL, loadDebriefGuide } from "./protocol";

const athlete: Athlete = {
  id: "athlete-1",
  displayName: "Test Athlete",
  timezone: "Europe/London",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function activity(id: string, startedAt: string, extra: Partial<Activity> = {}): Activity {
  return {
    id,
    athleteId: athlete.id,
    sport: "running",
    startedAt,
    summary: { durationSeconds: 1691 },
    normalizedData: {},
    sourceMetadata: { name: `Run ${id}` },
    createdAt: startedAt,
    updatedAt: startedAt,
    ...extra,
  };
}

const EASY = activity("run-easy", "2026-09-30T18:19:00.000Z");
const BUILD = activity("run-build", "2026-09-30T18:47:00.000Z", { summary: { durationSeconds: 668 } });
const OTHER = activity("run-other", "2026-09-30T18:00:00.000Z", { athleteId: "someone-else" });

function harness(clock = { now: "2026-09-30T20:30:00.000Z" }) {
  let id = 0;
  const store = new InMemoryTrainingApiStore({ athletes: [athlete], activities: [EASY, BUILD, OTHER] });
  const service = new TrainingApiService(store, { idFactory: () => `id-${++id}`, now: () => clock.now }, new InMemoryIntegrationStateStore());
  const actor = { type: "ai_client" as const, id: "claude", requestId: "req-1" };
  return { store, service, actor, clock };
}

const EASY_DEBRIEF = {
  rpe: 7,
  bodyFeel: "Heavy legs, right knee niggle at the start that went away. Breathing got hard towards the end of the warm-up.",
  mentalState: "Felt unfit and was relieved when the clock stopped.",
  context: "Stopped to tie my shoelaces.",
  source: "voice-chat" as const,
};

test("a debrief is created against an activity and read back with derived session load", async () => {
  const { service, actor } = harness();
  assert.equal(await service.getActivityDebrief(athlete.id, EASY.id), null);
  const saved = await service.saveActivityDebrief(athlete.id, EASY.id, EASY_DEBRIEF, actor);
  assert.equal(saved.version, 1);
  assert.equal(saved.activityId, EASY.id);
  assert.equal(saved.activityTitle, "Run run-easy");
  assert.equal(saved.source, "voice-chat");
  assert.equal(saved.recordedAt, "2026-09-30T20:30:00.000Z");
  // RPE 7 x 1691 s (28.18 min) = 197.3, rounded.
  assert.equal(saved.derived.sessionRpeLoad, 197);
  assert.equal(saved.derived.durationSeconds, 1691);
  const read = await service.getActivityDebrief(athlete.id, EASY.id);
  assert.deepEqual(read, saved);
});

test("back-to-back runs on the same day each keep their own debrief", async () => {
  const { service, actor, clock } = harness();
  await service.saveActivityDebrief(athlete.id, EASY.id, EASY_DEBRIEF, actor);
  clock.now = "2026-09-30T20:45:00.000Z";
  await service.saveActivityDebrief(athlete.id, BUILD.id, { rpe: 8, mentalState: "Decided to run home faster.", source: "voice-chat" }, actor);
  assert.equal((await service.getActivityDebrief(athlete.id, EASY.id))?.rpe, 7);
  assert.equal((await service.getActivityDebrief(athlete.id, BUILD.id))?.rpe, 8);
  const recent = await service.listActivityDebriefs(athlete.id, { limit: 10 });
  assert.deepEqual(recent.map((item) => item.activityId), [BUILD.id, EASY.id]);
  assert.equal((await service.listActivityDebriefs(athlete.id, { limit: 1 })).length, 1);
});

test("omitted fields carry forward, blank text and null RPE clear, and every save is a new version", async () => {
  const { service, actor, clock } = harness();
  await service.saveActivityDebrief(athlete.id, EASY.id, EASY_DEBRIEF, actor);
  clock.now = "2026-09-30T21:00:00.000Z";
  const second = await service.saveActivityDebrief(athlete.id, EASY.id, { learnings: "Warm up more slowly.", expectedVersion: 1 }, actor);
  assert.equal(second.version, 2);
  assert.equal(second.rpe, 7);
  assert.equal(second.bodyFeel, EASY_DEBRIEF.bodyFeel);
  assert.equal(second.learnings, "Warm up more slowly.");
  assert.equal(second.createdAt, "2026-09-30T20:30:00.000Z");
  assert.equal(second.updatedAt, "2026-09-30T21:00:00.000Z");
  assert.equal(second.recordedAt, "2026-09-30T20:30:00.000Z");

  const cleared = await service.saveActivityDebrief(athlete.id, EASY.id, { rpe: null, context: "   " }, actor);
  assert.equal(cleared.version, 3);
  assert.equal(cleared.rpe, undefined);
  assert.equal(cleared.context, undefined);
  assert.equal(cleared.derived.sessionRpeLoad, undefined);
  assert.equal(cleared.bodyFeel, EASY_DEBRIEF.bodyFeel);

  const history = await service.getActivityDebriefHistory(athlete.id, EASY.id);
  assert.deepEqual(history.map((item) => item.version), [1, 2, 3]);
  assert.equal(history[0].learnings, undefined);
  assert.equal(history[0].savedByActorId, "claude");
});

test("saving identical content again is a no-op that does not add a version", async () => {
  const { service, store, actor } = harness();
  const first = await service.saveActivityDebrief(athlete.id, EASY.id, EASY_DEBRIEF, actor);
  const again = await service.saveActivityDebrief(athlete.id, EASY.id, EASY_DEBRIEF, actor);
  assert.equal(again.version, 1);
  assert.deepEqual(again, first);
  assert.equal((await store.listActivityDebriefRevisions(EASY.id)).length, 1);
  assert.equal((await store.listAuditEvents()).length, 1);
});

test("a stale expectedVersion is rejected so a website edit is not overwritten", async () => {
  const { service, actor } = harness();
  await service.saveActivityDebrief(athlete.id, EASY.id, EASY_DEBRIEF, actor);
  await service.saveActivityDebrief(athlete.id, EASY.id, { learnings: "Edited on the website.", source: "web-edit", expectedVersion: 1 }, actor);
  await assert.rejects(
    service.saveActivityDebrief(athlete.id, EASY.id, { learnings: "Claude overwrite.", expectedVersion: 1 }, actor),
    (error: unknown) => error instanceof TrainingApiError && error.status === 409 && error.code === "VERSION_CONFLICT"
      && (error.details as { currentVersion: number }).currentVersion === 2,
  );
  assert.equal((await service.getActivityDebrief(athlete.id, EASY.id))?.learnings, "Edited on the website.");
  await assert.rejects(
    service.saveActivityDebrief(athlete.id, BUILD.id, { rpe: 6, expectedVersion: 3 }, actor),
    (error: unknown) => error instanceof TrainingApiError && error.code === "VERSION_CONFLICT",
  );
});

test("invalid debriefs are rejected without being saved", async () => {
  const { service, store, actor } = harness();
  const bad: Array<[Record<string, unknown>, RegExp]> = [
    [{ rpe: 0 }, /rpe/],
    [{ rpe: 10.5 }, /rpe/],
    [{ rpe: 6.3 }, /rpe/],
    [{ rpe: "hard" }, /rpe/],
    [{ bodyFeel: "x".repeat(DEBRIEF_LIMITS.textMaxLength + 1) }, /bodyFeel/],
    [{ context: 42 }, /context/],
    [{ recordedAt: "yesterday" }, /recordedAt/],
    [{ recordedAt: "2026-10-05T10:00:00Z", rpe: 5 }, /future/],
    [{ source: "carrier-pigeon", rpe: 5 }, /source/],
    [{ expectedVersion: -1, rpe: 5 }, /expectedVersion/],
    [{}, /needs an RPE or at least one written field/],
    [{ rpe: null, bodyFeel: "   " }, /needs an RPE or at least one written field/],
  ];
  for (const [input, message] of bad) {
    await assert.rejects(
      service.saveActivityDebrief(athlete.id, EASY.id, input, actor),
      (error: unknown) => error instanceof TrainingApiError && error.status === 400 && error.code === "VALIDATION_FAILED" && message.test(error.message),
      JSON.stringify(input).slice(0, 80),
    );
  }
  assert.equal(await store.getActivityDebrief(EASY.id), undefined);
  // Half points are allowed.
  assert.equal((await service.saveActivityDebrief(athlete.id, EASY.id, { rpe: 6.5 }, actor)).rpe, 6.5);
});

test("a debrief can only be saved against the athlete's own existing activity", async () => {
  const { service, actor } = harness();
  for (const id of ["missing-run", OTHER.id]) {
    await assert.rejects(
      service.saveActivityDebrief(athlete.id, id, { rpe: 5 }, actor),
      (error: unknown) => error instanceof TrainingApiError && error.status === 404,
    );
    await assert.rejects(service.getActivityDebrief(athlete.id, id), (error: unknown) => error instanceof TrainingApiError && error.status === 404);
  }
});

test("audit events record that a debrief was saved but never its text", async () => {
  const { service, store, actor } = harness();
  await service.saveActivityDebrief(athlete.id, EASY.id, EASY_DEBRIEF, actor);
  const audits = await store.listAuditEvents();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "debrief.saved");
  assert.equal(audits[0].entityType, "activity_debrief");
  assert.equal(audits[0].entityId, EASY.id);
  assert.equal(audits[0].entityVersion, 1);
  const serialized = JSON.stringify(audits);
  assert.ok(!serialized.includes("knee"));
  assert.ok(!serialized.includes("shoelaces"));
});

test("re-importing or repairing an activity does not lose or orphan its debrief", async () => {
  const { service, store, actor } = harness();
  await service.saveActivityDebrief(athlete.id, EASY.id, EASY_DEBRIEF, actor);
  await store.saveActivity({ ...EASY, summary: { durationSeconds: 1700, distanceMeters: 4030 }, updatedAt: "2026-10-01T06:00:00.000Z" });
  const read = await service.getActivityDebrief(athlete.id, EASY.id);
  assert.equal(read?.rpe, 7);
  assert.equal(read?.derived.durationSeconds, 1700);
});

test("listing still returns debriefs whose activity is no longer stored", async () => {
  const { service, store, actor } = harness();
  await service.saveActivityDebrief(athlete.id, EASY.id, EASY_DEBRIEF, actor);
  const orphanStore = new InMemoryTrainingApiStore({ athletes: [athlete], debriefs: [(await store.getActivityDebrief(EASY.id))!] });
  const orphanService = new TrainingApiService(orphanStore, { idFactory: () => "x", now: () => "2026-10-01T00:00:00.000Z" });
  const [item] = await orphanService.listActivityDebriefs(athlete.id);
  assert.equal(item.activityId, EASY.id);
  assert.equal(item.activityTitle, undefined);
  assert.equal(item.derived.sessionRpeLoad, undefined);
});

test("date filters bound the debrief list", async () => {
  const { service, actor, clock } = harness();
  await service.saveActivityDebrief(athlete.id, EASY.id, { rpe: 5 }, actor);
  clock.now = "2026-10-02T10:00:00.000Z";
  await service.saveActivityDebrief(athlete.id, BUILD.id, { rpe: 6 }, actor);
  assert.deepEqual((await service.listActivityDebriefs(athlete.id, { from: "2026-10-01T00:00:00.000Z" })).map((item) => item.activityId), [BUILD.id]);
  assert.deepEqual((await service.listActivityDebriefs(athlete.id, { to: "2026-10-01T00:00:00.000Z" })).map((item) => item.activityId), [EASY.id]);
});

// ---- MCP ---------------------------------------------------------------------------------

function mcp(service: TrainingApiService) {
  const runtime = { service, primaryAthleteId: athlete.id } as unknown as TrainingApiRuntimeBundle;
  let rpcId = 0;
  const call = async (handler: typeof handleMcpRequest, path: string, method: string, params: unknown) => {
    const response = await handler(new Request(`https://example.test/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }), { token: "test-token", runtime });
    return (await response.json()).result;
  };
  return {
    training: (name: string, args: Record<string, unknown> = {}) => call(handleMcpRequest, "api/mcp", "tools/call", { name, arguments: args }),
    trainingList: () => call(handleMcpRequest, "api/mcp", "tools/list", {}),
    activity: (name: string, args: Record<string, unknown> = {}) => call(handleActivityMcpRequest, "api/activity-mcp", "tools/call", { name, arguments: args }),
    activityList: () => call(handleActivityMcpRequest, "api/activity-mcp", "tools/list", {}),
  };
}

test("the training MCP exposes debrief tools and only the save tool is marked as a write", async () => {
  const { service } = harness();
  const { tools } = await mcp(service).trainingList();
  const byName = new Map<string, { annotations: { readOnlyHint: boolean }; inputSchema: { required?: string[] } }>(tools.map((tool: { name: string }) => [tool.name, tool]));
  for (const name of ["save_activity_debrief", "get_activity_debrief", "list_activity_debriefs", "get_debrief_guide"]) assert.ok(byName.has(name), name);
  assert.equal(byName.get("save_activity_debrief")!.annotations.readOnlyHint, false);
  for (const name of ["get_activity_debrief", "list_activity_debriefs", "get_debrief_guide"]) assert.equal(byName.get(name)!.annotations.readOnlyHint, true, name);
  assert.deepEqual(byName.get("save_activity_debrief")!.inputSchema.required, ["activityId"]);
});

test("Claude can save, read back and list a debrief through the MCP", async () => {
  const { service } = harness();
  const client = mcp(service);
  const saved = await client.training("save_activity_debrief", { activityId: EASY.id, ...EASY_DEBRIEF });
  assert.equal(saved.isError, undefined);
  assert.equal(saved.structuredContent.version, 1);
  assert.equal(saved.structuredContent.derived.sessionRpeLoad, 197);
  // Repeating the same call is safe.
  const repeat = await client.training("save_activity_debrief", { activityId: EASY.id, ...EASY_DEBRIEF });
  assert.equal(repeat.structuredContent.version, 1);

  const read = await client.training("get_activity_debrief", { activityId: EASY.id });
  assert.equal(read.structuredContent.bodyFeel, EASY_DEBRIEF.bodyFeel);
  const listed = await client.training("list_activity_debriefs", { limit: 5 });
  assert.deepEqual(listed.structuredContent.map((item: { activityId: string }) => item.activityId), [EASY.id]);

  const none = await client.training("get_activity_debrief", { activityId: BUILD.id });
  assert.equal(none.structuredContent, null);
});

test("MCP save failures come back as clear tool errors", async () => {
  const { service } = harness();
  const client = mcp(service);
  const invalid = await client.training("save_activity_debrief", { activityId: EASY.id, rpe: 11 });
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent.error.code, "VALIDATION_FAILED");
  const missing = await client.training("save_activity_debrief", { activityId: "nope", rpe: 5 });
  assert.equal(missing.structuredContent.error.code, "NOT_FOUND");
  const noId = await client.training("save_activity_debrief", { rpe: 5 });
  assert.equal(noId.structuredContent.error.code, "VALIDATION_FAILED");
  await client.training("save_activity_debrief", { activityId: EASY.id, rpe: 5 });
  const stale = await client.training("save_activity_debrief", { activityId: EASY.id, rpe: 6, expectedVersion: 0 });
  assert.equal(stale.structuredContent.error.code, "VERSION_CONFLICT");
  const badLimit = await client.training("list_activity_debriefs", { limit: 0 });
  assert.equal(badLimit.structuredContent.error.code, "VALIDATION_FAILED");
});

test("the debrief guide tool returns the protocol and the coaching knowledge base", async () => {
  const { service } = harness();
  const guide = (await mcp(service).training("get_debrief_guide")).structuredContent;
  assert.equal(guide.protocol, DEBRIEF_PROTOCOL);
  assert.match(guide.protocol, /Ask before you interpret/);
  assert.match(guide.protocol, /save_activity_debrief/);
  assert.match(guide.knowledgeBase, /Debrief question bank/);
  assert.match(guide.knowledgeBase, /Session RPE/);
});

test("the guide still serves the protocol when the knowledge base file is unavailable", async () => {
  const guide = await loadDebriefGuide("/nonexistent-root");
  assert.equal(guide.knowledgeBase, null);
  assert.equal(guide.protocol, DEBRIEF_PROTOCOL);
  assert.match(guide.note ?? "", /could not be read/);
});

test("the read-only activity MCP can read debriefs but cannot write them", async () => {
  const { service, actor } = harness();
  await service.saveActivityDebrief(athlete.id, EASY.id, EASY_DEBRIEF, actor);
  const client = mcp(service);
  const { tools } = await client.activityList();
  const names = tools.map((tool: { name: string }) => tool.name);
  assert.ok(names.includes("get_activity_debrief"));
  assert.ok(names.includes("list_activity_debriefs"));
  assert.ok(!names.includes("save_activity_debrief"));
  assert.ok(tools.every((tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint));
  const read = await client.activity("get_activity_debrief", { activityId: EASY.id });
  assert.equal(read.structuredContent.rpe, 7);
  const listed = await client.activity("list_activity_debriefs", {});
  assert.equal(listed.structuredContent.length, 1);
  const write = await client.activity("save_activity_debrief", { activityId: EASY.id, rpe: 2 });
  assert.equal(write.isError, true);
  assert.equal(write.structuredContent.error.code, "TOOL_NOT_FOUND");
});

// ---- HTTP API ----------------------------------------------------------------------------

test("the HTTP API requires authentication and supports create, read, history and list", async () => {
  const { NextRequest } = await import("next/server");
  const { handleTrainingApiRequest } = await import("../training-api/http");
  const { service } = harness();
  const globals = globalThis as typeof globalThis & { __paulRunningTrainingApi?: unknown };
  const previousRuntime = globals.__paulRunningTrainingApi;
  const previousToken = process.env.PAUL_RUNNING_API_TOKEN;
  process.env.PAUL_RUNNING_API_TOKEN = "http-test-token";
  globals.__paulRunningTrainingApi = { service, primaryAthleteId: athlete.id, storageMode: "memory_reference" };
  const send = async (method: string, path: string, body?: unknown, token: string | null = "http-test-token") => {
    const response = await handleTrainingApiRequest(new NextRequest(`https://example.test/api/v1/${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), path.split("?")[0].split("/"));
    return { status: response.status, body: await response.json() };
  };
  try {
    for (const [method, path] of [["GET", `activities/${EASY.id}/debrief`], ["PUT", `activities/${EASY.id}/debrief`], ["GET", "debriefs"]] as const) {
      assert.equal((await send(method, path, method === "PUT" ? { rpe: 5 } : undefined, null)).status, 401, `${method} ${path} without a token`);
      assert.equal((await send(method, path, method === "PUT" ? { rpe: 5 } : undefined, "wrong-token")).status, 401, `${method} ${path} with a wrong token`);
    }

    const empty = await send("GET", `activities/${EASY.id}/debrief`);
    assert.equal(empty.status, 200);
    assert.equal(empty.body.data, null);

    const created = await send("PUT", `activities/${EASY.id}/debrief`, { ...EASY_DEBRIEF, expectedVersion: 0 });
    assert.equal(created.status, 200);
    assert.equal(created.body.data.version, 1);
    assert.equal(created.body.data.derived.sessionRpeLoad, 197);

    const edited = await send("PUT", `activities/${EASY.id}/debrief`, { learnings: "Warm up slower.", source: "web-edit", expectedVersion: 1 });
    assert.equal(edited.body.data.version, 2);
    assert.equal(edited.body.data.source, "web-edit");

    const conflict = await send("PUT", `activities/${EASY.id}/debrief`, { rpe: 3, expectedVersion: 1 });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, "VERSION_CONFLICT");

    const invalid = await send("PUT", `activities/${EASY.id}/debrief`, { rpe: 99 });
    assert.equal(invalid.status, 400);
    assert.ok(!JSON.stringify(invalid.body).includes("knee"));

    const missing = await send("PUT", "activities/not-a-run/debrief", { rpe: 4 });
    assert.equal(missing.status, 404);

    const history = await send("GET", `activities/${EASY.id}/debrief?history=1`);
    assert.deepEqual(history.body.data.map((item: { version: number }) => item.version), [1, 2]);

    const listed = await send("GET", "debriefs?limit=5");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.length, 1);
    assert.equal(listed.body.data[0].rpe, 7);

    const caps = await send("GET", "capabilities");
    assert.ok(caps.body.data.endpoints.some((endpoint: string) => endpoint.includes("/debrief")));
  } finally {
    globals.__paulRunningTrainingApi = previousRuntime;
    if (previousToken === undefined) delete process.env.PAUL_RUNNING_API_TOKEN;
    else process.env.PAUL_RUNNING_API_TOKEN = previousToken;
  }
});

test("the website's browser session can read and edit a debrief only from the same origin", async () => {
  const { NextRequest } = await import("next/server");
  const { handleTrainingApiRequest } = await import("../training-api/http");
  const { ANALYSIS_COOKIE, createBrowserSession } = await import("../training-api/browser-session");
  const { service, actor } = harness();
  await service.saveActivityDebrief(athlete.id, EASY.id, EASY_DEBRIEF, actor);
  const globals = globalThis as typeof globalThis & { __paulRunningTrainingApi?: unknown };
  const previousRuntime = globals.__paulRunningTrainingApi;
  const previousToken = process.env.PAUL_RUNNING_API_TOKEN;
  process.env.PAUL_RUNNING_API_TOKEN = "http-test-token";
  globals.__paulRunningTrainingApi = { service, primaryAthleteId: athlete.id, storageMode: "memory_reference" };
  const cookie = `${ANALYSIS_COOKIE}=${createBrowserSession("http-test-token")}`;
  const browser = async (method: string, origin: string | null, body?: unknown) => {
    const path = `activities/${EASY.id}/debrief`;
    const response = await handleTrainingApiRequest(new NextRequest(`https://example.test/api/v1/${path}`, {
      method,
      headers: { cookie, ...(origin ? { origin } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), path.split("/"));
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await browser("GET", null)).body.data.rpe, 7);
    assert.equal((await browser("PUT", null, { rpe: 2 })).status, 403);
    assert.equal((await browser("PUT", "https://evil.example", { rpe: 2 })).status, 403);
    const edited = await browser("PUT", "https://example.test", { rpe: 6.5, source: "web-edit", expectedVersion: 1 });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.rpe, 6.5);
    assert.equal(edited.body.data.version, 2);
  } finally {
    globals.__paulRunningTrainingApi = previousRuntime;
    if (previousToken === undefined) delete process.env.PAUL_RUNNING_API_TOKEN;
    else process.env.PAUL_RUNNING_API_TOKEN = previousToken;
  }
});
