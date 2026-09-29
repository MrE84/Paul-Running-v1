import assert from "node:assert/strict";
import test from "node:test";
import type { TrainingApiRuntimeBundle } from "../training-api/runtime";
import { handleScheduledActivitySync } from "./scheduled-activity-sync";

function fakeRuntime(importRecent?: (maxPages: number) => Promise<unknown>) {
  const calls: number[] = [];
  const runtime = {
    primaryAthleteId: "primary-athlete",
    activityImporter: importRecent
      ? { importRecent: async (maxPages: number) => { calls.push(maxPages); return importRecent(maxPages); } }
      : undefined,
  } as unknown as TrainingApiRuntimeBundle;
  return { runtime: () => runtime, calls };
}

const okResult = { items: [], pagesProcessed: 1, imported: 1, repaired: 0, alreadyComplete: 3, alreadyImported: 3, failed: 0 };

function cronRequest(token?: string) {
  return new Request("https://example.test/api/cron/activity-sync", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

test("scheduled sync fails closed when CRON_SECRET is not configured", async () => {
  const { runtime, calls } = fakeRuntime(async () => okResult);
  const response = await handleScheduledActivitySync(cronRequest("anything"), { secret: undefined, runtime });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "CRON_SECRET_NOT_CONFIGURED");
  assert.equal(calls.length, 0);
});

test("scheduled sync rejects a missing or wrong bearer token", async () => {
  const { runtime, calls } = fakeRuntime(async () => okResult);
  assert.equal((await handleScheduledActivitySync(cronRequest(), { secret: "s3cret", runtime })).status, 401);
  assert.equal((await handleScheduledActivitySync(cronRequest("wrong"), { secret: "s3cret", runtime })).status, 401);
  assert.equal(calls.length, 0);
});

test("scheduled sync imports one page and reports counts", async () => {
  const { runtime, calls } = fakeRuntime(async () => okResult);
  const response = await handleScheduledActivitySync(cronRequest("s3cret"), { secret: "s3cret", runtime });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(calls, [1]);
  assert.equal(body.status, "ok");
  assert.equal(body.imported, 1);
  assert.equal(body.alreadyComplete, 3);
});

test("scheduled sync reports partial success and hides provider errors", async () => {
  const partial = await handleScheduledActivitySync(cronRequest("s3cret"), {
    secret: "s3cret",
    runtime: fakeRuntime(async () => ({ ...okResult, failed: 1 })).runtime,
  });
  assert.equal((await partial.json()).status, "partial");

  const failing = await handleScheduledActivitySync(cronRequest("s3cret"), {
    secret: "s3cret",
    runtime: fakeRuntime(async () => { throw new Error("upstream said api_key=leaked"); }).runtime,
  });
  assert.equal(failing.status, 502);
  const text = await failing.text();
  assert.equal(text.includes("leaked"), false);
});

test("scheduled sync reports when the importer is not configured", async () => {
  const response = await handleScheduledActivitySync(cronRequest("s3cret"), { secret: "s3cret", runtime: fakeRuntime().runtime });
  assert.equal(response.status, 503);
});
