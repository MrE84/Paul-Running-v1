# Safe Training API (PAU-15)

The v1 training API is the provider-neutral boundary for ChatGPT, future MCP tools and other approved clients. It wraps the same canonical workout, plan, calendar, QA and sync-status concepts used elsewhere in Paul's Running.

## Safety model

- All remote requests require `Authorization: Bearer <PAUL_RUNNING_API_TOKEN>`.
- If `PAUL_RUNNING_API_TOKEN` is absent, the API fails closed with `503 API_AUTH_NOT_CONFIGURED`.
- Durable write commands require `Idempotency-Key`.
- API callers are attributed as `ai_client`; the optional `X-Client-Id` identifies the client in audit events.
- Workout writes run canonical QA before persistence.
- Workout edits require `expectedVersion` and return `409 VERSION_CONFLICT` for stale clients.
- Material changes create immutable workout/plan revisions; calendar items retain exact revision references.
- Canonical training state and provider delivery state remain separate.
- Provider IDs are never canonical workout or plan IDs.

## Routes

```text
GET  /api/v1/capabilities
GET  /api/v1/profile
GET  /api/v1/zones
GET  /api/v1/athletes/{athleteId}
GET  /api/v1/athletes/{athleteId}/zone-sets
GET  /api/v1/calendar-items?from={iso}&to={iso}
GET  /api/v1/activities?limit=20
GET  /api/v1/workouts
POST /api/v1/workouts
GET  /api/v1/workouts/{workoutId}
PATCH /api/v1/workouts/{workoutId}
GET  /api/v1/workouts/{workoutId}/qa
GET  /api/v1/training-plans
POST /api/v1/training-plans
GET  /api/v1/training-plans/{planId}
POST /api/v1/training-plans/{planId}/apply
GET  /api/v1/calendar-items/{calendarItemId}/sync-status
```

All list routes accept `athleteId` as a query parameter; otherwise the configured primary athlete is used.

## Write examples

Create a workout:

```json
{
  "name": "3 x 8 min threshold",
  "sport": "running",
  "steps": [
    {
      "id": "warmup",
      "kind": "step",
      "sequence": 0,
      "durationType": "time",
      "durationValue": 600,
      "durationUnit": "seconds",
      "targetType": "none"
    }
  ]
}
```

Required headers:

```text
Authorization: Bearer <token>
Idempotency-Key: client-generated-stable-key
X-Client-Id: chatgpt
X-Request-Id: optional trace id
```

Patch a workout:

```json
{
  "expectedVersion": 2,
  "change": {
    "name": "3 x 10 min threshold"
  }
}
```

Apply a plan:

```json
{
  "planVersion": 1,
  "startDate": "2026-09-12",
  "timezone": "Europe/London"
}
```

## Error envelope

```json
{
  "error": {
    "code": "WORKOUT_QA_FAILED",
    "message": "Workout failed QA and was not persisted.",
    "details": [],
    "requestId": "req_..."
  }
}
```

Stable categories include `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_FAILED`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_KEY_REQUIRED`, `WORKOUT_QA_FAILED` and `API_AUTH_NOT_CONFIGURED`.

## MCP boundary

MCP tools should be thin wrappers around these domain queries/commands. They must not write directly to database tables or call Intervals.icu/Garmin as an alternative mutation path. This keeps future tools such as `get_training_calendar`, `create_workout`, `revise_workout`, `apply_training_plan` and `get_sync_status` aligned with web/API behaviour.

## Persistence note

`TrainingApiStore` is the persistence port. `InMemoryTrainingApiStore` is intentionally a reference/test implementation and is what the current server runtime uses until the production PostgreSQL adapter is wired. The HTTP surface reports `storageMode: memory_reference` in `/api/v1/capabilities` so a client cannot mistake reference persistence for durable storage. The canonical PostgreSQL schema remains the target production store and can implement this port without changing the API or MCP surface.
