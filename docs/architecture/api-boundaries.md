# API Boundaries

Status: Accepted for v1 design

This document defines the boundary between Paul's Running canonical domain APIs, external sync connectors, and future AI/MCP clients.

## Design principles

1. **Paul's Running is the system of record.** All planning mutations are committed locally before any provider sync is attempted.
2. **Stable local identity.** API resources use Paul's Running UUIDs. Provider IDs are integration metadata only.
3. **Immutable structured revisions.** Material changes to workouts and plans create a new version so previously scheduled content remains reproducible.
4. **Replaceable connectors.** Core APIs expose provider-neutral domain objects. Intervals.icu, Garmin or another service is implemented behind a connector contract.
5. **Safe AI writes.** ChatGPT/MCP clients use the same validated mutation layer as the web UI. They do not write directly to the database or provider APIs.
6. **Auditable mutations.** Every material write records actor, request ID and before/after state.
7. **Idempotent integration.** Provider-facing operations are queued with idempotency keys and retry semantics.

## Boundary overview

```text
Web UI ───────────────┐
ChatGPT / MCP ────────┼──► Domain API ─► canonical PostgreSQL state
Future mobile app ────┘        │
                               ├──► workout QA
                               ├──► audit event
                               └──► sync job queue
                                        │
                               Connector interface
                              ┌─────────┴─────────┐
                              ▼                   ▼
                         Intervals.icu        future Garmin
                              │
                              ▼
                           Garmin

Completed activity source ─► connector/import API ─► local activity UUID ─► analysis
```

## Resource model

Public/internal domain APIs expose these canonical resource families:

- `athletes`
- `capacity-revisions`
- `zone-sets`
- `workouts` and immutable `workout revisions`
- `training-plans` and immutable `plan revisions`
- `calendar-items`
- `activities`
- `equipment`
- integration status views backed by `external_references` and `sync_jobs`

Provider-specific payloads are never returned as the canonical representation. Where troubleshooting requires them, they are exposed only through an explicitly integration-scoped diagnostic surface.

## Versioning and concurrency

### Stable identity

A workout keeps one stable UUID for its lifetime:

```text
workout_id = 7be9...   current_version = 4
```

Each material edit creates an immutable revision:

```text
(workout_id, version=1)
(workout_id, version=2)
(workout_id, version=3)
(workout_id, version=4)
```

Calendar items reference the exact revision that was scheduled. Editing the canonical workout later cannot silently rewrite training history.

### Optimistic concurrency

Update requests carry the version the client believes is current.

```json
{
  "expectedVersion": 4,
  "change": {
    "name": "3 x 10 min threshold"
  }
}
```

If the server current version is not `4`, the mutation returns `409 Conflict` with the current version. This prevents the web UI and an AI client from overwriting each other's changes.

## Idempotency

All commands that can create durable state accept an `Idempotency-Key` header.

Examples:

- create workout
- apply training plan
- schedule standalone workout
- cancel/reschedule calendar item
- import an activity

The same key with the same request returns the original result. Reusing the same key with a materially different request returns a conflict.

Provider sync jobs use their own deterministic idempotency key based on provider, operation, local entity ID and entity version.

## Actor and audit model

Authentication determines the actor; callers cannot assert an arbitrary actor identity in request bodies.

Recognized actor classes:

- `user`
- `ai_client`
- `connector`
- `system`

A material mutation writes an `audit_event` containing:

- actor type and actor ID;
- request ID;
- action;
- entity type, ID and version;
- before/after state where appropriate;
- timestamp and supporting metadata.

This is the basis for future questions such as: "Why did this workout change?" or "Which changes did ChatGPT make?"

## Domain API surface

The exact transport can evolve, but v1 HTTP route semantics are reserved as follows.

### Athlete and capacities

```text
GET  /api/v1/athletes/{athleteId}
GET  /api/v1/athletes/{athleteId}/capacity-revisions
POST /api/v1/athletes/{athleteId}/capacity-revisions
GET  /api/v1/athletes/{athleteId}/zone-sets
POST /api/v1/athletes/{athleteId}/zone-sets
```

Capacity and zone updates append time-effective records rather than rewriting historical values.

### Workouts

```text
GET  /api/v1/workouts
POST /api/v1/workouts
GET  /api/v1/workouts/{workoutId}
GET  /api/v1/workouts/{workoutId}/revisions/{version}
POST /api/v1/workouts/{workoutId}/revisions
POST /api/v1/workouts/{workoutId}/archive
```

Creating a revision validates the workout tree and increments the canonical version atomically.

### Training plans

```text
GET  /api/v1/training-plans
POST /api/v1/training-plans
GET  /api/v1/training-plans/{planId}
GET  /api/v1/training-plans/{planId}/revisions/{version}
POST /api/v1/training-plans/{planId}/revisions
POST /api/v1/training-plans/{planId}/apply
POST /api/v1/training-plans/{planId}/archive
```

`apply` takes an explicit local start date and athlete timezone. It resolves `day_offset` and local workout time into concrete `calendar_items`.

Example command:

```json
{
  "planVersion": 3,
  "startDate": "2026-09-12",
  "timezone": "Europe/London"
}
```

The response returns the exact generated calendar items and timestamps before provider sync status is considered.

### Calendar

```text
GET  /api/v1/calendar-items?from={iso}&to={iso}
POST /api/v1/calendar-items
GET  /api/v1/calendar-items/{calendarItemId}
POST /api/v1/calendar-items/{calendarItemId}/reschedule
POST /api/v1/calendar-items/{calendarItemId}/cancel
POST /api/v1/calendar-items/{calendarItemId}/supersede
```

Calendar state is authoritative locally. Provider delivery state is returned as a secondary projection, for example:

```json
{
  "id": "local-calendar-uuid",
  "status": "planned",
  "scheduledStart": "2026-09-16T18:00:00Z",
  "workout": {
    "id": "local-workout-uuid",
    "version": 2
  },
  "sync": {
    "provider": "intervals_icu",
    "state": "succeeded",
    "externalId": "i12345"
  }
}
```

A failed sync does not change `status: planned` into an error state. Canonical training status and integration delivery status are separate concerns.

### Activities

```text
GET  /api/v1/activities
GET  /api/v1/activities/{activityId}
POST /api/v1/activities/import
POST /api/v1/activities/{activityId}/link-calendar-item
```

Imports always allocate a local UUID before normalization/analysis. Deduplication may use provider references, source hashes and timestamps but never makes the provider ID the primary key.

### Equipment

```text
GET  /api/v1/equipment
POST /api/v1/equipment
POST /api/v1/activities/{activityId}/equipment
DELETE /api/v1/activities/{activityId}/equipment/{equipmentId}
```

### Integration status

```text
GET  /api/v1/integrations
GET  /api/v1/integrations/{provider}/sync-jobs
POST /api/v1/integrations/{provider}/retry/{syncJobId}
```

These routes expose delivery health and troubleshooting information. They do not provide a second path for editing canonical workouts or calendar state.

## Mutation pipeline

Every planning mutation follows this order:

```text
1. authenticate and authorize actor
2. validate request shape
3. load canonical entity/current version
4. enforce optimistic concurrency
5. run domain validation / workout QA
6. commit canonical transaction
7. write audit event
8. enqueue provider sync job if required
9. return canonical result + delivery state
```

Provider API calls are not executed inside the canonical database transaction.

## Workout QA boundary

PAU-11 will implement the full QA engine, but PAU-7 reserves its place in the write path.

Before a workout revision can be scheduled or synced, QA must be able to reject at least:

- accidental `open` steps where auto-advance is expected;
- zero/negative time or distance durations;
- invalid repeat counts;
- target lower bound above upper bound;
- incompatible target units;
- impossible or inconsistent pace/distance/time combinations;
- malformed nested repeat structures;
- plan items resolving to unintended dates/times.

The QA engine consumes the canonical workout model only. Provider connectors may add provider-specific compatibility checks afterwards.

## Connector contracts

Connectors sit behind internal interfaces; domain services must not import provider SDK types.

Conceptual contract:

```ts
interface TrainingSyncConnector {
  readonly provider: string;

  publish(input: CanonicalScheduledWorkout): Promise<ConnectorResult>;
  update(input: CanonicalScheduledWorkout, externalRef: ExternalReference): Promise<ConnectorResult>;
  cancel(input: CanonicalCalendarItem, externalRef: ExternalReference): Promise<ConnectorResult>;
}

interface ActivityImportConnector {
  readonly provider: string;

  listCompleted(cursor?: string): Promise<ImportPage>;
  fetchActivity(externalId: string): Promise<ExternalActivityEnvelope>;
}
```

`ConnectorResult` must distinguish:

- success;
- retryable failure;
- permanent failure.

Connector implementations own translation, authentication, rate limits, provider quirks and polling/webhook cursors. They do not own canonical training decisions.

## Intervals.icu boundary

The initial delivery adapter may use Intervals.icu to reach Garmin. The core system therefore treats this chain as:

```text
canonical calendar item
  -> sync job(provider=intervals_icu)
  -> Intervals connector translation
  -> external reference
  -> provider delivery
  -> Garmin sync outside the canonical boundary
```

The rolling Garmin delivery window is a connector/scheduling concern, not a limitation of the local calendar. Paul's Running retains the full future plan regardless of what has been projected to Garmin.

## Future ChatGPT/MCP boundary

Future MCP tools should be thin wrappers over domain commands/queries rather than direct database or provider access.

Examples:

```text
get_training_calendar(from, to)
get_workout(workout_id, version?)
create_workout(draft, idempotency_key)
revise_workout(workout_id, expected_version, change)
apply_training_plan(plan_id, plan_version, start_date)
reschedule_calendar_item(calendar_item_id, expected_version, new_start)
get_activity(activity_id)
get_sync_status(calendar_item_id)
```

Write tools must return validation findings and the canonical object they changed. They should not report success merely because a provider accepted a request.

## Error model

Domain APIs use a stable machine-readable envelope:

```json
{
  "error": {
    "code": "WORKOUT_QA_FAILED",
    "message": "Workout cannot be scheduled until validation errors are resolved.",
    "details": [
      {
        "path": "steps[2].durationType",
        "code": "OPEN_STEP_REQUIRES_MANUAL_ADVANCE"
      }
    ],
    "requestId": "req_..."
  }
}
```

Reserved categories:

- `VALIDATION_FAILED` -> 400
- `UNAUTHORIZED` -> 401
- `FORBIDDEN` -> 403
- `NOT_FOUND` -> 404
- `VERSION_CONFLICT` -> 409
- `IDEMPOTENCY_CONFLICT` -> 409
- `WORKOUT_QA_FAILED` -> 422
- `INTEGRATION_UNAVAILABLE` -> 503 for integration-only commands

A provider outage must not turn ordinary reads of canonical plans/calendar/history into `503` responses.

## Out of scope for PAU-7

This issue defines boundaries and durable identity. It does not implement:

- the production ORM/migrations;
- authentication provider;
- workout QA rules engine (PAU-11);
- Intervals.icu connector (PAU-12);
- rolling Garmin projection (PAU-13);
- Fenix validation (PAU-14);
- public AI/MCP tool exposure (PAU-15).

Those issues should implement against these boundaries rather than redesigning them.
