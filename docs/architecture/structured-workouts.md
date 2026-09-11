# Structured Workout Builder

Status: Implemented for PAU-10

The structured workout builder produces the same canonical `WorkoutRevision` representation used by the calendar, QA, sync and future AI/API layers. There is no provider-specific workout model in the core application.

## Executable step semantics

Every executable step has an explicit phase:

- `warmup`
- `active`
- `recovery`
- `cooldown`

Repeat containers remain phase-neutral and contain ordered child steps.

## Duration semantics

The builder supports exactly three duration modes:

- `time` stored canonically in seconds;
- `distance` stored canonically in meters;
- `open` for an intentionally selected manual-Lap step.

`open` is never used as a fallback for an unknown duration. It must be selected explicitly by the builder caller. PAU-11 is responsible for rejecting accidental or unsafe open-step use before sync.

## Target semantics

Canonical target types and units are:

| Target | Canonical unit |
| --- | --- |
| none | none |
| pace | sec_per_km |
| heart rate | bpm |
| cadence | spm |
| power | watts |

Target ranges are stored as lower and upper bounds. A single-value target is represented by identical lower and upper values.

## Repeat blocks

Repeat blocks can contain executable steps or nested repeat blocks. Sequences are generated independently at each tree level. A typical interval block is therefore represented as one repeat container with an active child followed by a recovery child.

## Workout summary

The summary engine recursively expands repeat counts for calculation purposes without flattening the canonical workout tree.

It reports:

- executable step count;
- repeat block count;
- open/manual-Lap step count;
- known duration and distance from directly specified or exactly derivable values;
- total duration when every segment can be determined;
- total distance when every segment can be determined;
- bounded totals when pace ranges allow a minimum/maximum calculation.

A distance step with a pace target can therefore derive duration. A time step with a pace target can derive distance. HR, cadence and power targets do not imply pace and cannot be used to invent the missing dimension.

An open/manual-Lap step deliberately makes the complete duration/distance indeterminate while preserving the known totals from other steps.

## Supported workout families

The domain API includes composable presets for:

- easy runs;
- long runs;
- threshold sessions;
- distance- or time-recovery interval sessions;
- easy running plus strides.

These are convenience constructors only. They all emit the same builder nodes and canonical workout representation, so custom sessions are not limited to the presets.

## Provider boundary

No Garmin or Intervals.icu fields exist in the workout builder. PAU-12 will translate canonical duration, phase, repeat and target semantics into provider-specific payloads only after PAU-11 QA succeeds.
