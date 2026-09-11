# Intervals.icu sync adapter

PAU-12 implements Intervals.icu as a replaceable transport layer. Paul’s Running remains the canonical source of truth for workouts, calendar state and completed activities.

## Planned workout flow

1. A canonical scheduled workout is translated to an Intervals.icu calendar event.
2. The PAU-11 QA engine validates the canonical workout, calendar timing, provider delivery profile and translated projection before any HTTP request is made.
3. The adapter upserts the event using a stable `external_id` derived from the Paul’s Running calendar item, making create/update idempotent.
4. The returned Intervals.icu event ID is stored as an `ExternalReference`; sync attempts are stored separately as `SyncJob` records.
5. Retryable failures retain provider metadata and, for HTTP 429, `Retry-After` is converted into `nextAttemptAt`.

## Completed activity flow

Completed activities are listed in bounded date windows, mapped into provider-neutral activity envelopes, fetched in detail when required, handed to an `ActivityImportSink`, and deduplicated by Intervals.icu external activity ID.

## Provider isolation

The adapter implements the domain `TrainingSyncConnector` and `ActivityImportConnector` interfaces. Intervals.icu-specific HTTP payloads, authentication and workout-description syntax remain inside `lib/integrations/intervals-icu`, so a future direct Garmin or alternative-provider connector can replace it without changing the canonical training model.

## Authentication and limits

The client supports personal API-key Basic authentication and OAuth bearer tokens. Rate-limit headers are captured when present. HTTP 429 responses are classified as retryable and preserve the server `Retry-After` delay.

## Structured workout translation

Intervals.icu parses structured workout steps from calendar-event descriptions. The translator emits explicit metric durations/distances and absolute pace targets. Absolute heart-rate targets require an explicit HR anchor so BPM values are not silently changed during percentage-based Intervals.icu translation. Unsafe mixed target families are rejected rather than approximated.

## Validation

`npm test` includes the integration suite. PAU-12 acceptance tests cover workout translation, HR safety, mixed-target rejection, API-key authentication, 429 handling, idempotent upsert, pre-HTTP failure, external-reference persistence, retry scheduling, completed-activity import/deduplication and idempotent cancellation.
