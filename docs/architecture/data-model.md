# Canonical Data Model

Status: Accepted for v1 design

This document defines the v1 domain model. The physical database is PostgreSQL, but the domain boundaries are intentionally provider-neutral. Paul's Running owns canonical identity and state; external services are projections/import sources only.

## Core entities

### Athlete

`athletes` stores identity and stable profile attributes such as timezone and physical profile. Training capacities that change over time are revisioned separately.

### Capacity revision

`capacity_revisions` stores time-effective values such as max HR, resting HR, LT1/LT2 HR and threshold paces. Historical activity analysis can therefore use the values that were valid at the time rather than silently rewriting history when fitness changes.

### Zone set and zones

A `zone_set` is a time-effective zone definition for a sport and target type. Individual `zones` store ordered lower/upper bounds and units. A future lactate retest creates a new zone set without destroying the old one.

### Workout, workout revision and workout steps

`workouts` provides the stable canonical workout UUID and points to the current version.

`workout_revisions` contains immutable versioned workout content. A material edit creates version 2, 3, and so on rather than overwriting the previous structure.

`workout_steps` belong to a specific workout revision and form an ordered tree. A step can be a normal execution step or a repeat container with child steps. Duration and target semantics are explicit rather than encoded in free text.

Supported v1 duration types:

- `time`
- `distance`
- `open`

Supported v1 target types:

- `none`
- `heart_rate`
- `pace`
- `cadence`
- `power`

`open` remains a legitimate duration type because some workouts intentionally require a manual Lap press. PAU-11's QA engine must reject accidental use where automatic advancement was intended.

This revision model is important for Garmin-safe change control: a calendar item can always reconstruct exactly which workout steps were scheduled even after the canonical workout later changes.

### Training plan, plan revision and plan item

`training_plans` provides the stable reusable plan UUID and current version.

`training_plan_revisions` holds immutable plan composition. `plan_items` belong to a specific plan revision and reference an exact workout revision using relative `day_offset` plus optional local start time.

Applying a plan to a start date creates concrete calendar items. This deliberately separates reusable plan arithmetic from real calendar dates and prevents the application-date mistake previously encountered in external planning tools.

### Calendar item

`calendar_items` are concrete scheduled sessions with explicit timestamps and timezone. Each points to an exact `(workout_id, workout_version)` and may retain the plan revision/item that created it.

Local training state is authoritative. Typical states are:

- `planned`
- `completed`
- `skipped`
- `canceled`
- `superseded`

Integration delivery state is deliberately separate. A failed provider sync does not mean the local workout stopped existing.

### Activity

An `activity` is a completed training event. It always receives a Paul's Running UUID. It may be linked back to a calendar item, but imported activities are valid even if no planned item exists.

Normalized summary metrics are stored in first-class columns. Provider-specific or not-yet-normalized data can be retained in JSON. Original FIT/source-file metadata and hashes are retained so analysis can be rerun as parsers improve.

### Equipment

`equipment` represents shoes, watches, sensors or other gear. `activity_equipment` provides the many-to-many link from completed activities.

### External reference

`external_references` maps a local entity to a provider-specific identifier. It is deliberately separate from the domain tables.

Example:

```text
calendar_item UUID -> provider=intervals_icu -> external_id=i123456
```

The provider ID can disappear or be replaced without changing the local UUID.

### Sync job

`sync_jobs` is the durable integration queue and delivery audit trail. It records provider, entity, entity version, operation, state, attempt count, idempotency key and errors.

The canonical entity is committed before a sync job is queued. This prevents an external service becoming the system of record by accident.

### Sync cursor

`sync_cursors` holds provider-specific webhook/polling continuation state. It is integration state, not training state.

### Audit event

`audit_events` records meaningful changes made by a person, AI client, connector or system process. It is required for safe AI write access and for explaining why a plan/workout changed.

## Relationship overview

```text
Athlete
  |-- CapacityRevision
  |-- ZoneSet -- Zone
  |
  |-- Workout -- WorkoutRevision -- WorkoutStep
  |
  |-- TrainingPlan -- TrainingPlanRevision -- PlanItem
  |                                      |       |
  |                                      |       +--> exact WorkoutRevision
  |                                      |
  |-- CalendarItem ----------------------+--> exact WorkoutRevision
  |       |
  |       +-- Activity -- ActivityEquipment -- Equipment
  |
  +-- ExternalReference
  +-- SyncJob
  +-- SyncCursor
  +-- AuditEvent
```

## Stable identity and versioning

- UUIDs are generated by Paul's Running.
- Provider IDs never become primary domain IDs.
- Workouts and plans have stable UUIDs plus integer revisions starting at 1.
- Structured revisions are immutable snapshots.
- Mutation APIs use optimistic concurrency through an expected version.
- Calendar items store the exact workout version scheduled at that time.
- Material changes to an already-synced workout create a new revision and a new sync operation rather than silently mutating historical provider state.
- Completed activities always receive a local activity UUID before linking, normalization or analysis.

## Time handling

- Database timestamps are stored as UTC `timestamptz`.
- Athlete timezone is stored as an IANA timezone, initially `Europe/London`.
- Calendar display and local planned time are derived from the athlete timezone.
- Relative plan items use `day_offset` and optional local time.
- Applying a plan is the operation that resolves those relative values into concrete timestamps.
- The API returns explicit timezone context so external clients do not need to infer whether a displayed time was UTC or UK local time.

## Canonical write invariant

Planning writes follow this order:

1. authenticate/authorize the actor;
2. validate canonical input and expected version;
3. run domain/workout QA;
4. commit local canonical state;
5. write an audit event;
6. enqueue provider sync;
7. return canonical state plus integration-delivery status.

Provider failure never rolls back or deletes canonical state.

## Provider independence

No core table contains `intervals_*`, `garmin_*` or other provider-specific columns. Provider mappings, payload fragments, cursors and delivery errors live in integration tables only.

The domain therefore remains valid if Intervals.icu is replaced by direct Garmin integration or another delivery bridge.

## Physical schema and code contracts

The design is captured in:

- `docs/architecture/database-schema.sql` — proposed PostgreSQL DDL;
- `docs/architecture/api-boundaries.md` — public/internal API and connector boundaries;
- `lib/domain/contracts.ts` — provider-neutral TypeScript contracts used as the implementation seam for later issues.
