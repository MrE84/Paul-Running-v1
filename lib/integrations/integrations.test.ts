import assert from "node:assert/strict";
import test from "node:test";

import type {
  ActivityImportConnector,
  ActivityImportPage,
  CalendarItem,
  CanonicalScheduledWorkout,
  ConnectorResult,
  ExternalActivityEnvelope,
  ExternalReference,
  TrainingSyncConnector,
} from "../domain/contracts";
import {
  buildWorkout,
  distanceDuration,
  heartRateTarget,
  manualLapDuration,
  paceTarget,
  repeat,
  step,
  timeDuration,
} from "../workouts";
import {
  ActivityImportCoordinator,
  InMemoryIntegrationStateStore,
  IntervalsIcuActivityImportConnector,
  IntervalsIcuClient,
  IntervalsIcuHttpError,
  IntervalsIcuTrainingConnector,
  IntervalsIcuTranslationError,
  TrainingSyncCoordinator,
  translateScheduledWorkout,
  type ActivityImportSink,
  type IntegrationRuntime,
} from "./index";

function ids(prefix = "id") {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function runtime(now = "2026-09-11T10:00:00.000Z"): IntegrationRuntime {
  return { idFactory: ids("runtime"), now: () => now };
}

function scheduledWorkout(
  steps: Parameters<typeof buildWorkout>[0]["steps"],
  options: { id?: string; version?: number; updatedAt?: string } = {},
): CanonicalScheduledWorkout {
  const workoutId = options.id ?? "workout-1";
  const version = options.version ?? 1;
  const workout = buildWorkout(
    {
      workoutId,
      version,
      name: "Threshold session",
      sport: "running",
      steps,
      createdAt: "2026-09-11T09:00:00.000Z",
      createdByActor: "user",
    },
    { idFactory: ids("step") },
  ).workout;

  return {
    athlete: {
      id: "athlete-1",
      displayName: "Paul",
      timezone: "Europe/London",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    calendarItem: {
      id: "calendar-1",
      athleteId: "athlete-1",
      workout: { id: workoutId, version },
      scheduledStart: "2026-09-16T17:00:00.000Z",
      timezone: "Europe/London",
      status: "planned",
      createdAt: "2026-09-11T09:00:00.000Z",
      updatedAt: options.updatedAt ?? "2026-09-11T09:00:00.000Z",
    },
    workout,
  };
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("translation preserves local schedule, repeats, absolute pace and intentional manual-Lap semantics", () => {
  const input = scheduledWorkout([
    step("warmup", timeDuration(600), paceTarget(360, 390)),
    repeat(2, [
      step("active", distanceDuration(1000), paceTarget(300, 310)),
      step("recovery", manualLapDuration(), paceTarget(420, 450)),
    ]),
  ]);

  const translated = translateScheduledWorkout(input);
  assert.equal(translated.event.start_date_local, "2026-09-16T18:00:00");
  assert.equal(translated.event.external_id, "paul-running:calendar-1");
  assert.match(translated.event.description, /- 10m 6:00-6:30\/km Pace/);
  assert.match(translated.event.description, /2x/);
  assert.match(translated.event.description, /- 1km 5:00-5:10\/km Pace/);
  assert.match(translated.event.description, /Press lap when ready 1m 7:00-7:30\/km Pace/);
  assert.equal(translated.warnings.length, 1);
});

test("absolute BPM is never silently changed: HR translation requires an explicit Intervals anchor", () => {
  const input = scheduledWorkout([
    step("active", timeDuration(600), heartRateTarget(150, 158)),
  ]);

  assert.throws(
    () => translateScheduledWorkout(input),
    (error: unknown) =>
      error instanceof IntervalsIcuTranslationError && error.code === "HEART_RATE_ANCHOR_REQUIRED",
  );

  const translated = translateScheduledWorkout(input, {
    heartRateAnchor: { type: "lthr", bpm: 165 },
  });
  assert.match(translated.event.description, /90\.9-95\.8% LTHR/);
});

test("mixed target families are blocked by default because provider parsing is not reliably equivalent", () => {
  const input = scheduledWorkout([
    step("warmup", timeDuration(600), heartRateTarget(125, 140)),
    step("active", distanceDuration(1000), paceTarget(300, 310)),
  ]);
  assert.throws(
    () => translateScheduledWorkout(input, { heartRateAnchor: { type: "lthr", bpm: 165 } }),
    (error: unknown) =>
      error instanceof IntervalsIcuTranslationError && error.code === "MIXED_TARGET_TYPES_UNSAFE",
  );
});

test("Intervals client uses API-key auth and surfaces 429 Retry-After as structured retry data", async () => {
  let authorization = "";
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("Authorization") ?? "";
    return jsonResponse(
      { error: "too many requests" },
      429,
      {
        "Retry-After": "370",
        "X-RateLimit-Limit": "2500,5000",
        "X-RateLimit-Remaining": "0,4990",
      },
    );
  }) as typeof fetch;

  const client = new IntervalsIcuClient({
    auth: { type: "api_key", apiKey: "secret-key" },
    fetchImpl,
  });

  await assert.rejects(
    () =>
      client.upsertEvents([
        {
          category: "WORKOUT",
          start_date_local: "2026-09-16T18:00:00",
          type: "Run",
          name: "Test",
          description: "- 10m 5:00/km Pace",
          external_id: "paul-running:test",
        },
      ]),
    (error: unknown) => {
      assert.ok(error instanceof IntervalsIcuHttpError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 370);
      assert.equal(error.rateLimit.remaining, "0,4990");
      return true;
    },
  );
  assert.equal(
    authorization,
    `Basic ${Buffer.from("API_KEY:secret-key", "utf8").toString("base64")}`,
  );
});

test("training connector upserts by Paul's Running external_id and returns provider event id", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return jsonResponse([
      { id: 128751902, external_id: "paul-running:calendar-1" },
    ]);
  }) as typeof fetch;
  const client = new IntervalsIcuClient({
    auth: { type: "api_key", apiKey: "test" },
    fetchImpl,
  });
  const connector = new IntervalsIcuTrainingConnector({ client });
  const result = await connector.publish(
    scheduledWorkout([step("active", distanceDuration(1000), paceTarget(300, 310))]),
  );

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.message);
  assert.equal(result.externalId, "128751902");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/events\/bulk\?upsert=true$/);
  const body = JSON.parse(String(calls[0].init?.body)) as Array<Record<string, unknown>>;
  assert.equal(body[0]?.external_id, "paul-running:calendar-1");
  assert.equal(body[0]?.type, "Run");
});

test("training connector fails safely before HTTP when provider translation cannot preserve the target", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse([]);
  }) as typeof fetch;
  const connector = new IntervalsIcuTrainingConnector({
    client: new IntervalsIcuClient({
      auth: { type: "api_key", apiKey: "test" },
      fetchImpl,
    }),
  });
  const result = await connector.publish(
    scheduledWorkout([step("active", timeDuration(600), heartRateTarget(150, 158))]),
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected failure");
  assert.equal(result.kind, "permanent");
  assert.equal(result.code, "HEART_RATE_ANCHOR_REQUIRED");
  assert.equal(calls, 0);
});

test("sync coordinator stores external IDs and successful sync state separately from canonical calendar state", async () => {
  let publishCalls = 0;
  const connector: TrainingSyncConnector = {
    provider: "intervals_icu",
    async publish(): Promise<ConnectorResult> {
      publishCalls += 1;
      return { ok: true, externalId: "event-123", providerMetadata: { remote: true } };
    },
    async update(): Promise<ConnectorResult> {
      return { ok: true, externalId: "event-123" };
    },
    async cancel(): Promise<ConnectorResult> {
      return { ok: true, externalId: "event-123" };
    },
  };
  const state = new InMemoryIntegrationStateStore();
  const coordinator = new TrainingSyncCoordinator({ connector, state, runtime: runtime() });
  const input = scheduledWorkout([step("active", timeDuration(600), paceTarget(300))]);
  const result = await coordinator.syncScheduledWorkout(input);

  assert.equal(result.ok, true);
  assert.equal(publishCalls, 1);
  const reference = await state.findExternalReference("intervals_icu", "calendar_item", "calendar-1");
  assert.equal(reference?.externalId, "event-123");
  const jobs = state.listSyncJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.state, "succeeded");
  assert.equal(input.calendarItem.status, "planned");
});

test("sync coordinator persists Retry-After into nextAttemptAt for retryable failures", async () => {
  const connector: TrainingSyncConnector = {
    provider: "intervals_icu",
    async publish(): Promise<ConnectorResult> {
      return {
        ok: false,
        kind: "retryable",
        code: "RATE_LIMITED",
        message: "retry later",
        providerMetadata: { retryAfterSeconds: 370 },
      };
    },
    async update(): Promise<ConnectorResult> {
      throw new Error("not expected");
    },
    async cancel(): Promise<ConnectorResult> {
      throw new Error("not expected");
    },
  };
  const state = new InMemoryIntegrationStateStore();
  const coordinator = new TrainingSyncCoordinator({ connector, state, runtime: runtime() });
  const result = await coordinator.syncScheduledWorkout(
    scheduledWorkout([step("active", timeDuration(600), paceTarget(300))]),
  );
  assert.equal(result.ok, false);
  const job = state.listSyncJobs()[0];
  assert.equal(job?.state, "retryable_failure");
  assert.equal(job?.nextAttemptAt, "2026-09-11T10:06:10.000Z");
});

test("completed activities are listed, fetched, ingested locally and deduplicated by external ID", async () => {
  const activity: ExternalActivityEnvelope = {
    externalId: "i55751783",
    startedAt: "2026-09-10T07:35:18Z",
    sport: "running",
    sourceFileUrl: "https://intervals.icu/api/v1/activity/i55751783/file",
    sourceMetadata: { id: "i55751783", type: "Run" },
  };
  let fetchDetailCalls = 0;
  const importConnector: ActivityImportConnector = {
    provider: "intervals_icu",
    async listCompleted(): Promise<ActivityImportPage> {
      return { items: [activity] };
    },
    async fetchActivity(): Promise<ExternalActivityEnvelope> {
      fetchDetailCalls += 1;
      return activity;
    },
  };
  const stored: ExternalActivityEnvelope[] = [];
  const sink: ActivityImportSink = {
    async ingest({ activity: item }) {
      stored.push(item);
      return { activityId: "local-activity-1" };
    },
  };
  const state = new InMemoryIntegrationStateStore();
  const coordinator = new ActivityImportCoordinator({
    athleteId: "athlete-1",
    connector: importConnector,
    state,
    sink,
    runtime: runtime(),
  });

  const first = await coordinator.importNextPage();
  const second = await coordinator.importNextPage();
  assert.equal(first.items[0]?.status, "imported");
  assert.equal(second.items[0]?.status, "already_complete");
  assert.equal(fetchDetailCalls, 1);
  assert.equal(stored.length, 1);
  const reference = await state.findExternalReferenceByExternalId(
    "intervals_icu",
    "activity",
    "i55751783",
  );
  assert.equal(reference?.entityId, "local-activity-1");
});

test("Intervals activity connector maps API summaries and original file endpoint into provider-neutral envelopes", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/activities?")) {
      return jsonResponse([
        {
          id: "i55751783",
          start_date: "2026-09-10T07:35:18Z",
          start_date_local: "2026-09-10T08:35:18",
          type: "Run",
          file_type: "fit",
        },
      ]);
    }
    return jsonResponse({
      id: "i55751783",
      start_date: "2026-09-10T07:35:18Z",
      type: "Run",
      file_type: "fit",
      moving_time: 3600,
    });
  }) as typeof fetch;
  const client = new IntervalsIcuClient({
    auth: { type: "api_key", apiKey: "test" },
    fetchImpl,
  });
  const connector = new IntervalsIcuActivityImportConnector({
    client,
    now: () => new Date("2026-09-11T10:00:00Z"),
    defaultLookbackDays: 7,
    pageDays: 14,
  });
  const page = await connector.listCompleted();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.sport, "running");
  assert.match(page.items[0]?.sourceFileUrl ?? "", /\/activity\/i55751783\/file$/);
  const detail = await connector.fetchActivity("i55751783");
  assert.equal(detail.externalId, "i55751783");
  assert.equal(detail.sourceMetadata.moving_time, 3600);
});

test("cancel treats an already-deleted provider event as idempotent success", async () => {
  const fetchImpl = (async () => jsonResponse({ error: "not found" }, 404)) as typeof fetch;
  const connector = new IntervalsIcuTrainingConnector({
    client: new IntervalsIcuClient({
      auth: { type: "api_key", apiKey: "test" },
      fetchImpl,
    }),
  });
  const input = scheduledWorkout([step("active", timeDuration(600), paceTarget(300))]);
  const reference: ExternalReference = {
    id: "ref-1",
    athleteId: "athlete-1",
    entityType: "calendar_item",
    entityId: input.calendarItem.id,
    provider: "intervals_icu",
    externalId: "12345",
    providerMetadata: {},
    createdAt: "2026-09-11T09:00:00Z",
    updatedAt: "2026-09-11T09:00:00Z",
  };
  const result = await connector.cancel(input.calendarItem as CalendarItem, reference);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.message);
  assert.equal(result.providerMetadata?.alreadyAbsent, true);
});
