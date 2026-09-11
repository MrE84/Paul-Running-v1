import assert from "node:assert/strict";
import test from "node:test";

import type { Athlete, CanonicalScheduledWorkout, WorkoutRevision } from "../domain/contracts";
import { buildWorkout } from "../workouts/builder";
import type { Fenix5ValidationTemplate } from "./fenix5-validation";
import {
  FENIX5_VALIDATION_MATRIX,
  createFenix5ValidationTemplates,
} from "./fenix5-validation";
import { translateScheduledWorkout } from "./intervals-icu/translation";

const athlete: Athlete = {
  id: "athlete-paul",
  displayName: "Paul",
  timezone: "Europe/London",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-11T10:00:00.000Z",
};

function idFactory(prefix: string) {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

const templates = createFenix5ValidationTemplates({
  lthrBpm: 165,
  hrLowBpm: 145,
  hrHighBpm: 155,
  paceLowSecPerKm: 300,
  paceHighSecPerKm: 320,
  manualLapPlaceholderSeconds: 60,
});

function template(id: string): Fenix5ValidationTemplate {
  const found = templates.find((item) => item.id === id);
  assert.ok(found, `Missing Fenix 5 validation template: ${id}`);
  return found;
}

function build(templateInput: Fenix5ValidationTemplate, version = 1): WorkoutRevision {
  return buildWorkout(
    {
      workoutId: `workout-${templateInput.id}`,
      version,
      name: templateInput.name,
      sport: "running",
      steps: templateInput.preset.steps,
      createdAt: "2026-09-11T10:00:00.000Z",
      createdByActor: "user",
    },
    { idFactory: idFactory(`${templateInput.id}-step`) },
  ).workout;
}

function scheduled(
  templateInput: Fenix5ValidationTemplate,
  options: { version?: number; updatedAt?: string; start?: string } = {},
): CanonicalScheduledWorkout {
  const version = options.version ?? 1;
  return {
    athlete,
    calendarItem: {
      id: `calendar-${templateInput.id}`,
      athleteId: athlete.id,
      workout: { id: `workout-${templateInput.id}`, version },
      scheduledStart: options.start ?? "2026-09-12T08:00:00.000Z",
      timezone: "Europe/London",
      status: "planned",
      createdAt: "2026-09-11T10:00:00.000Z",
      updatedAt: options.updatedAt ?? "2026-09-11T10:00:00.000Z",
    },
    workout: build(templateInput, version),
  };
}

test("validation matrix covers every PAU-14 compatibility case and keeps device verification explicit", () => {
  assert.deepEqual(
    FENIX5_VALIDATION_MATRIX.map((item) => item.id),
    [
      "time_auto",
      "distance_auto",
      "repeat_block",
      "warmup_cooldown",
      "recovery",
      "heart_rate_range",
      "pace_range",
      "manual_lap",
      "edit_resync",
    ],
  );
  assert.ok(FENIX5_VALIDATION_MATRIX.every((item) => item.status === "device_pending"));
});

test("time-based automatic workout translates without a press-lap flag", () => {
  const candidate = template("fenix5-time-auto");
  const translated = translateScheduledWorkout(scheduled(candidate), candidate.translationConfig);

  assert.match(translated.event.description, /Warm-up 1m/);
  assert.match(translated.event.description, /Timed work 1m30s 5:00-5:20\/km Pace/);
  assert.match(translated.event.description, /Recovery 45s/);
  assert.match(translated.event.description, /Cool-down 1m/);
  assert.doesNotMatch(translated.event.description, /Press lap/i);
});

test("distance-based automatic workout translates metric work and recovery distances", () => {
  const candidate = template("fenix5-distance-auto");
  const translated = translateScheduledWorkout(scheduled(candidate), candidate.translationConfig);

  assert.match(translated.event.description, /400m work 400mtr 5:00-5:20\/km Pace/);
  assert.match(translated.event.description, /200m recovery 200mtr/);
  assert.doesNotMatch(translated.event.description, /Press lap/i);
});

test("repeat template preserves warm-up, three repeats, recovery and cool-down", () => {
  const candidate = template("fenix5-repeat-pace");
  const translated = translateScheduledWorkout(scheduled(candidate), candidate.translationConfig);
  const description = translated.event.description;

  assert.ok(description.indexOf("Warm-up 2m") < description.indexOf("Main set 3x"));
  assert.match(description, /Main set 3x/);
  assert.match(description, /400m work 400mtr 5:00-5:20\/km Pace/);
  assert.match(description, /Recovery 45s/);
  assert.ok(description.indexOf("Main set 3x") < description.indexOf("Cool-down 2m"));
});

test("heart-rate validation uses an explicit LTHR anchor and never emits raw BPM as provider syntax", () => {
  const candidate = template("fenix5-hr-range");
  const translated = translateScheduledWorkout(scheduled(candidate), candidate.translationConfig);

  assert.match(translated.event.description, /HR range 3m 87\.9-93\.9% LTHR/);
  assert.doesNotMatch(translated.event.description, /145-155\s*bpm/i);
});

test("manual-Lap template emits Intervals Garmin press-lap semantics and load-only placeholder warnings", () => {
  const candidate = template("fenix5-manual-lap");
  const translated = translateScheduledWorkout(scheduled(candidate), candidate.translationConfig);

  assert.match(translated.event.description, /Press lap when ready Warm-up until ready 1m/i);
  assert.match(translated.event.description, /Timed work 1m 5:00-5:20\/km Pace/);
  assert.match(translated.event.description, /Press lap when ready Cool-down until done 1m/i);
  assert.equal(translated.warnings.length, 2);
  assert.ok(translated.warnings.every((warning) => warning.includes("Garmin advances it by Lap press")));
});

test("all reusable validation templates remain single-target-family safe for the Intervals adapter", () => {
  for (const candidate of templates) {
    assert.doesNotThrow(() =>
      translateScheduledWorkout(scheduled(candidate), candidate.translationConfig),
    );
  }
});

test("edit/resync preserves external_id while changing the translated workout content", () => {
  const base = template("fenix5-time-auto");
  const original = translateScheduledWorkout(scheduled(base), base.translationConfig);

  const editedTemplate: Fenix5ValidationTemplate = {
    ...base,
    preset: {
      ...base.preset,
      steps: base.preset.steps.map((node, index) => {
        if (index !== 1 || node.kind !== "step") return node;
        return {
          ...node,
          duration: { type: "time", seconds: 120 } as const,
        };
      }),
    },
  };
  const edited = translateScheduledWorkout(
    scheduled(editedTemplate, { version: 2, updatedAt: "2026-09-11T10:05:00.000Z" }),
    editedTemplate.translationConfig,
  );

  assert.equal(edited.event.external_id, original.event.external_id);
  assert.notEqual(edited.event.description, original.event.description);
  assert.match(edited.event.description, /Timed work 2m 5:00-5:20\/km Pace/);
});
