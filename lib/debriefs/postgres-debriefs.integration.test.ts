import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import type { Activity, Athlete } from "../domain/contracts";
import type { TrainingApiActor, TrainingApiRuntime } from "../training-api/contracts";
import { SerializedPostgresTrainingStore } from "../training-api/serialized-postgres-store";
import { TrainingApiError, TrainingApiService } from "../training-api/service";

/**
 * PAU-82 against a real PostgreSQL database. Skipped unless DATABASE_URL_UNPOOLED is set;
 * set TEST_DATABASE_SSL=false for a local server without TLS. Runs in a throwaway schema.
 */
const databaseUrl = process.env.DATABASE_URL_UNPOOLED?.trim();
const ssl = process.env.TEST_DATABASE_SSL !== "false";

function connectionForSchema(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const searchPathOption = `-csearch_path=${schema}`;
  const existing = url.searchParams.get("options");
  url.searchParams.set("options", existing ? `${existing} ${searchPathOption}` : searchPathOption);
  return url.toString();
}

const createdAt = "2026-09-30T18:00:00.000Z";
const athlete: Athlete = { id: "debrief-test-athlete", displayName: "Debrief Test", timezone: "Europe/London", createdAt, updatedAt: createdAt };

function activity(id: string, startedAt: string): Activity {
  return { id, athleteId: athlete.id, sport: "running", startedAt, summary: { durationSeconds: 1200 }, normalizedData: {}, sourceMetadata: { name: id }, createdAt: startedAt, updatedAt: startedAt };
}

function runtime(clock: { now: string }): TrainingApiRuntime {
  return { now: () => clock.now, idFactory: () => randomUUID() };
}

const actor: TrainingApiActor = { type: "ai_client", id: "pg-test", requestId: "req" };

test("PostgreSQL stores debriefs, history and ordered lists, and serializes competing saves", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const schema = `pau80_test_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1, ssl: ssl ? { rejectUnauthorized: false } : undefined });
  await admin.query(`create schema "${schema}"`);
  const isolatedUrl = connectionForSchema(databaseUrl, schema);
  const options = { connectionString: isolatedUrl, seedAthlete: athlete, maxConnections: 3, ssl } as const;
  const storeA = new SerializedPostgresTrainingStore(options);
  const storeB = new SerializedPostgresTrainingStore(options);
  const clock = { now: "2026-09-30T20:30:00.000Z" };
  const serviceA = new TrainingApiService(storeA, runtime(clock), storeA);
  const serviceB = new TrainingApiService(storeB, runtime(clock), storeB);
  // Ids with LIKE wildcards and underscores exercise the revision lookup escaping.
  const tricky = activity("run_1%x", "2026-09-30T18:19:00.000Z");
  const plain = activity("run-2", "2026-09-30T18:47:00.000Z");
  const lookalike = activity("runX1Yx", "2026-09-30T19:10:00.000Z");
  try {
    for (const item of [tricky, plain, lookalike]) await storeA.saveActivity(item);

    // Schema bootstrap creates the partial index used for listing.
    const index = await admin.query(`select indexdef from pg_indexes where schemaname = $1 and indexname = 'training_api_documents_debrief_idx'`, [schema]);
    assert.equal(index.rowCount, 1);

    const first = await serviceA.saveActivityDebrief(athlete.id, tricky.id, { rpe: 7, bodyFeel: "Heavy legs, knee niggle.", source: "voice-chat" }, actor);
    assert.equal(first.version, 1);
    assert.equal(first.derived.sessionRpeLoad, 140);
    assert.deepEqual(await serviceB.getActivityDebrief(athlete.id, tricky.id), first);

    clock.now = "2026-09-30T21:00:00.000Z";
    await serviceB.saveActivityDebrief(athlete.id, tricky.id, { learnings: "Warm up slower.", source: "web-edit", expectedVersion: 1 }, actor);
    clock.now = "2026-09-30T21:05:00.000Z";
    await serviceA.saveActivityDebrief(athlete.id, lookalike.id, { rpe: 5 }, actor);
    clock.now = "2026-09-30T21:10:00.000Z";
    await serviceA.saveActivityDebrief(athlete.id, plain.id, { rpe: 8, mentalState: "Pushed for home." }, actor);

    // History is per activity: the wildcard id must not pick up the look-alike's revisions.
    const history = await serviceA.getActivityDebriefHistory(athlete.id, tricky.id);
    assert.deepEqual(history.map((item) => item.version), [1, 2]);
    assert.ok(history.every((item) => item.activityId === tricky.id));
    assert.deepEqual((await serviceA.getActivityDebriefHistory(athlete.id, lookalike.id)).map((item) => item.version), [1]);

    // Newest first, limit and date filters.
    const recent = await serviceB.listActivityDebriefs(athlete.id, { limit: 10 });
    assert.deepEqual(recent.map((item) => item.activityId), [plain.id, lookalike.id, tricky.id]);
    assert.equal((await serviceB.listActivityDebriefs(athlete.id, { limit: 2 })).length, 2);
    assert.deepEqual((await serviceB.listActivityDebriefs(athlete.id, { from: "2026-09-30T21:00:00.000Z" })).map((item) => item.activityId), [plain.id, lookalike.id]);
    assert.deepEqual((await serviceB.listActivityDebriefs(athlete.id, { to: "2026-09-30T20:45:00.000Z" })).map((item) => item.activityId), [tricky.id]);

    // Re-importing an activity leaves its debrief alone.
    await storeB.saveActivity({ ...tricky, summary: { durationSeconds: 1300 }, updatedAt: "2026-10-01T06:00:00.000Z" });
    const afterReimport = await serviceA.getActivityDebrief(athlete.id, tricky.id);
    assert.equal(afterReimport?.version, 2);
    assert.equal(afterReimport?.derived.durationSeconds, 1300);

    // Two instances saving from the same starting version: exactly one wins.
    const results = await Promise.allSettled([
      serviceA.saveActivityDebrief(athlete.id, plain.id, { learnings: "Writer A", expectedVersion: 1 }, actor),
      serviceB.saveActivityDebrief(athlete.id, plain.id, { learnings: "Writer B", expectedVersion: 1 }, actor),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof TrainingApiError && rejected.reason.code === "VERSION_CONFLICT");
    assert.equal((await serviceA.getActivityDebrief(athlete.id, plain.id))?.version, 2);
    assert.equal((await serviceA.getActivityDebriefHistory(athlete.id, plain.id)).length, 2);

    // Audit trail carries no free text.
    const audits = JSON.stringify(await storeA.listAuditEvents());
    assert.ok(audits.includes("debrief.saved"));
    assert.ok(!audits.includes("knee niggle") && !audits.includes("Pushed for home"));
  } finally {
    await Promise.allSettled([storeA.close(), storeB.close()]);
    await admin.query(`drop schema if exists "${schema}" cascade`);
    await admin.end();
  }
});
