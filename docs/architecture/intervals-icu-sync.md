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

## Official MCP watch / migration policy

Intervals.icu maintainer David confirmed on 9 September 2026 that an official MCP server is being developed and is currently at the specification stage. This is tracked in PAU-46.

The planned official MCP does **not** change the v1 system-of-record decision. Paul’s Running keeps canonical storage, local IDs, workout QA, derived analytics and provider-neutral connector boundaries. The official MCP is treated as a future optional access/provider path until it proves parity with the existing adapter.

Before any bridge code is retired, PAU-46 must validate:

- complete activity time-series access for heart rate, pace/speed, GPS, elevation, cadence and available device streams;
- activity completeness/provenance semantics and stream resolution;
- historical activity, interval/lap, wellness and performance-curve access;
- planned-workout/calendar read-write behaviour and structured workout fidelity;
- authentication/scopes, write confirmation, token isolation, rate limits and auditability;
- reliable use from ChatGPT without exposing Intervals.icu credentials to the model.

Community reference implementation: `HduSy/intervals-mcp-server` (MIT). It is useful as a design reference and possible interim component, but its current `get_activity_streams` implementation only returns all values for streams of 10 samples or fewer; longer streams are reduced to the first five and last five samples in the MCP response. That is insufficient for Paul’s Running deep trace analysis unless adapted. Its Streamable HTTP transport also has no application-layer authentication in `server.ts`, so it must not be exposed publicly with stored Intervals.icu credentials without an authenticated gateway or equivalent control.

Official MCP/forum reference: https://forum.intervals.icu/t/request-for-official-mcp-support-for-ai-tools-chatgpt-claude/126164

Community MCP reference: https://github.com/HduSy/intervals-mcp-server

## Validation

`npm test` includes the integration suite. PAU-12 acceptance tests cover workout translation, HR safety, mixed-target rejection, API-key authentication, 429 handling, idempotent upsert, pre-HTTP failure, external-reference persistence, retry scheduling, completed-activity import/deduplication and idempotent cancellation.
