import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareFenix5LiveValidation,
  publishFenix5LiveValidation,
  type Fenix5LiveValidationInput,
} from "./fenix5-publisher";

const baseInput: Fenix5LiveValidationInput = {
  templateId: "fenix5-time-auto",
  localDate: "2026-09-12",
  localTime: "09:00:00",
  timezone: "Europe/London",
  templateConfig: {
    lthrBpm: 170,
    hrLowBpm: 140,
    hrHighBpm: 150,
    paceLowSecPerKm: 300,
    paceHighSecPerKm: 320,
    manualLapPlaceholderSeconds: 60,
  },
};

test("dry-run preparation is QA-gated and produces a stable provider event without network access", () => {
  const prepared = prepareFenix5LiveValidation(baseInput, {
    now: "2026-09-11T10:00:00.000Z",
  });

  assert.equal(prepared.templateId, "fenix5-time-auto");
  assert.equal(prepared.event.external_id, "paul-running:validation-fenix5-time-auto-2026-09-12");
  assert.equal(prepared.event.start_date_local, "2026-09-12T09:00:00");
  assert.match(prepared.event.description, /Timed work 1m30s 5:00-5:20\/km Pace/);
});

test("live publisher uses the rolling window and sends exactly one event when eligible", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await publishFenix5LiveValidation(baseInput, {
    auth: { type: "api_key", apiKey: "test-secret-never-log" },
    athleteId: "0",
    now: () => "2026-09-11T10:00:00.000Z",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify([{ id: "intervals-event-1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.equal(result.attempted, true);
  assert.equal(result.result?.ok, true);
  assert.equal(result.delivery?.deliveryState, "sent");
  assert.equal(requests.length, 1);
  assert.match(requests[0]?.url ?? "", /\/athlete\/0\/events\/bulk\?upsert=true$/);

  const body = JSON.parse(String(requests[0]?.init?.body));
  assert.equal(body.length, 1);
  assert.equal(body[0].external_id, "paul-running:validation-fenix5-time-auto-2026-09-12");
  assert.ok(!JSON.stringify(body).includes("test-secret-never-log"));
});

test("workouts outside the rolling window are not sent even when publish credentials exist", async () => {
  let networkCalls = 0;
  const result = await publishFenix5LiveValidation(
    { ...baseInput, localDate: "2026-09-30" },
    {
      auth: { type: "api_key", apiKey: "test-secret" },
      now: () => "2026-09-11T10:00:00.000Z",
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("Network should not be called outside the rolling window.");
      },
    },
  );

  assert.equal(result.attempted, false);
  assert.equal(result.delivery?.deliveryState, "planned");
  assert.equal(result.delivery?.reason, "outside_window");
  assert.equal(networkCalls, 0);
});
