# Fenix 5 end-to-end structured workout validation

PAU-14 validates the real delivery chain:

Paul's Running -> PAU-11 QA -> PAU-13 rolling window -> Intervals.icu -> Garmin Connect -> Garmin Fenix 5.

## What is already proven automatically

The repository contains a reusable validation pack in `lib/integrations/fenix5-validation.ts`. Its templates are deliberately short so they can be executed on a watch without creating a meaningful training load.

The build gate verifies:

- time-based automatic steps translate with explicit durations and no `press lap` flag;
- distance-based automatic steps translate with metric distances and no `press lap` flag;
- one-level repeat blocks preserve work/recovery order;
- warm-up and cool-down remain first/last around a repeat set;
- recovery steps remain explicit;
- absolute pace ranges remain absolute pace ranges;
- canonical BPM targets are converted only through an explicit LTHR anchor;
- intentional open steps emit Intervals.icu `Press lap` semantics and a load-only placeholder duration;
- every validation template stays inside the current single-target-family safety rule;
- edits retain the same external ID while changing the translated content, enabling update rather than duplicate publish.

These tests validate Paul's Running and the Intervals.icu representation. They do **not** claim that Garmin Connect or the physical watch has been observed yet.

## Device validation matrix

| Case | Garmin Connect check | Fenix 5 check | Current status |
| --- | --- | --- | --- |
| Time automatic | Step shown as timed | Advances when timer expires without Lap | Device pending |
| Distance automatic | Step shown as distance-based | Advances at prescribed distance | Device pending |
| Repeat block | Three work/recovery repetitions visible | Executes three cycles in order | Device pending |
| Warm-up / cool-down | Surround repeat block in correct order | Starts warm-up and finishes cool-down | Device pending |
| Recovery | Separate recovery steps visible | Automatically transitions work -> recovery | Device pending |
| HR target range | HR target attached to active step | Target/range guidance appears during step | Device pending |
| Pace target range | Pace target attached to work step | Pace range/guidance appears during step | Device pending |
| Manual Lap | Step represented as Lap-controlled | Continues until Lap press, then advances | Device pending |
| Edit / resync | Existing scheduled workout updates, no duplicate | Only current revision is presented after sync | Device pending |

## Candidate reusable templates

The validation pack exposes five candidate templates:

1. `fenix5-time-auto` — 1:00 warm-up, 1:30 pace work, 0:45 recovery, 1:00 cool-down.
2. `fenix5-distance-auto` — 400 m pace work, 200 m recovery.
3. `fenix5-repeat-pace` — 2:00 warm-up, 3 x (400 m pace work + 0:45 recovery), 2:00 cool-down.
4. `fenix5-hr-range` — 1:00 warm-up, 3:00 HR-range work, 1:00 cool-down.
5. `fenix5-manual-lap` — Lap-controlled warm-up, 1:00 pace work, Lap-controlled cool-down.

They remain **candidates**, not `watch_verified`, until the Garmin Connect and Fenix 5 observations have been recorded.

## Manual device run procedure

1. Configure the Intervals.icu account's Garmin connection with planned-workout upload enabled.
2. Publish one validation workout inside the PAU-13 rolling window.
3. Confirm there is one corresponding workout/event in Intervals.icu.
4. Confirm Garmin Connect receives the structured workout and inspect each step before syncing the watch.
5. Sync the Fenix 5 through Garmin Connect/Garmin Express.
6. On the watch open the Run activity, then `Training > My Workouts` (or the scheduled training calendar entry), and inspect the step overview.
7. Execute only enough of the test workout to prove transition semantics. For pace/HR tests, the target display can be verified without treating the validation run as a training session.
8. Record any Garmin representation differences in this document and in PAU-14.
9. For edit/resync, edit the already-published workout, resync, and verify Garmin Connect/watch do not retain a duplicate obsolete revision.

## Evidence basis

Garmin's Fenix 5 documentation states that interval workouts can be based on time or distance and that downloaded workouts display each step and optional target. Garmin also documents HR and pace range alerts. Intervals.icu documents `Press lap` as a Garmin-specific flag: a nominal duration is retained for load calculation while Garmin can terminate the step on a Lap press.

The remaining acceptance criterion is therefore observational: verify the Intervals.icu-generated structured representation in Garmin Connect and on Paul's physical Fenix 5.
