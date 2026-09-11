# Training Calendar Model

Status: Implemented for PAU-9 domain layer

## Purpose

The calendar is the canonical schedule for Paul's Running. It must preserve what was planned, what actually happened, and exactly how a reusable plan became dated training.

## Plan application

A reusable plan revision contains relative `dayOffset` values and optional local start times. It does not contain real calendar dates.

Applying a plan requires:

- athlete ID;
- immutable plan revision;
- anchor `startDate`;
- IANA timezone;
- referenced immutable workout revisions;
- a local start time on each item or an explicit application default.

The application produces one `plan_application` record plus concrete calendar items.

Example:

```text
Plan v4
Day offset 0  09:00  Parkrun validation
Day offset 2  17:30  Race-kit rehearsal
Day offset 8  09:00  Half marathon

Apply start date: 2026-09-12
Timezone: Europe/London

=> 2026-09-12 09:00 Europe/London
=> 2026-09-14 17:30 Europe/London
=> 2026-09-20 09:00 Europe/London
```

The local date/time is preserved separately from the UTC `scheduledStart` used for ordering, APIs and connector delivery.

## Why local date/time and UTC are both stored

`scheduledStart` answers: **what instant is this?**

`scheduledLocalDate`, `scheduledLocalTime` and `timezone` answer: **what did the athlete intend to see on their calendar?**

Keeping both prevents a later timezone conversion or daylight-saving change from obscuring the original scheduling intent.

## Timezone rules

Timezone conversion uses IANA timezone names such as `Europe/London`.

The domain utility explicitly detects daylight-saving edge cases:

- nonexistent local times are rejected;
- ambiguous local times are rejected by default;
- callers may deliberately choose the earlier or later occurrence.

This makes DST behavior deterministic and testable instead of relying on host-machine timezone settings.

## Provenance

Every plan-generated calendar item retains:

- `planApplicationId`;
- source plan ID;
- source plan version;
- source plan item ID;
- workout ID;
- workout version.

Changing a plan later therefore cannot rewrite the meaning of an already-scheduled historical item.

## Planned versus completed

The canonical calendar item remains the planned record. A completed `activity` can link to it through `calendarItemId`.

The calendar projection returns:

- scheduled entries with no activity as their current planned/skipped/canceled/superseded state;
- scheduled entries with a linked activity as completed while retaining the original planned item;
- completed activities with no matching plan as `unplanned_completed` entries.

This avoids overwriting planned data with actual data and enables planned-versus-actual analysis later.

## Change handling

Material workout edits create a new workout revision. Material plan edits create a new plan revision. Existing calendar items keep their original revision references.

If an already-scheduled item is intentionally replaced, the original should be marked `superseded` and the new calendar item should point back with `supersedesCalendarItemId`.

## Implementation

- `lib/calendar/timezone.ts` — local date/time parsing, date arithmetic and deterministic timezone conversion.
- `lib/calendar/contracts.ts` — plan application and calendar projection types.
- `lib/calendar/apply-plan.ts` — conversion of relative plan items into concrete calendar records.
- `lib/calendar/view.ts` — planned/completed calendar projection.
- `lib/calendar/calendar.test.ts` — acceptance tests including the Cheltenham final-week date mapping and UK DST boundaries.
- `docs/architecture/migrations/0002_training_calendar.sql` — persistence changes for plan applications and local scheduling intent.

## Acceptance mapping

| PAU-9 criterion | Implementation |
|---|---|
| Planned vs completed sessions | `buildCalendarView` preserves planned records and overlays linked activities |
| Relative days become explicit dates | `applyTrainingPlan` + `addLocalDays` |
| Start time independent of application date | plan item `localStartTime` is combined with derived date only during application |
| Explicit/testable timezone | IANA timezone conversion with DST rejection/disambiguation tests |
| Version/provenance retained | plan application ID + plan revision/item + workout revision on every generated calendar item |
