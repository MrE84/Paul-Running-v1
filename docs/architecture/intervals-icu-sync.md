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

## Community MCP survey

Three community Intervals.icu MCP implementations are tracked as references while the official server is not yet public.

### `hhopke/intervals-icu-mcp` — preferred community reference

MIT licensed and materially closer to Paul’s Running requirements than the other reviewed projects. It currently advertises 62 tools covering activities, raw activity analysis, athlete profile, wellness, calendar/events, curves, workout library, gear, sport settings and custom items.

Most importantly, `icu_get_activity_streams` returns the actual per-sample arrays rather than preview snippets. It explicitly supports second-by-second power, HR, cadence, speed, altitude, GPS, temperature and grade streams, and distinguishes Intervals.icu `heartrate` from `raw_heartrate` / `fixed_heartrate`. `raw_heartrate` is especially relevant for detecting genuine peaks that may have been corrected against the configured max HR.

It also has stronger server-side destructive-operation gating through `INTERVALS_ICU_DELETE_MODE` and validates whether a workout description actually parsed into structured, device-syncable steps.

It is still **not** a drop-in replacement for Paul’s Running. Its remote HTTP/SSE mode has no built-in application-layer authentication and its ChatGPT setup documentation explicitly requires a protected tunnel or authenticated reverse proxy. It also does not provide Paul’s Running canonical IDs, durable local system of record, workout QA, idempotent publication/audit pipeline or raw FIT archive.

### `HduSy/intervals-mcp-server` — TypeScript reference

MIT licensed, published through npm and useful for endpoint/completeness/provenance handling. However, its current `get_activity_streams` tool reduces streams longer than 10 values to the first five and last five values in the MCP response. That is insufficient for full-trace coaching analysis unless adapted. Its Streamable HTTP transport also has no application-layer authentication.

### `mvilanova/intervals-mcp-server` — reference only

Python implementation with activity, stream, event, wellness, curve, custom-item and gear tools. Its stream tool has the same first-five/last-five truncation behaviour as HduSy for long arrays. Its ChatGPT instructions use SSE through a public tunnel and explicitly allow no authentication unless the tunnel is separately protected.

This project is GPL-3.0 licensed. Do not copy its source into Paul’s Running without an explicit licensing decision; use it as a behavioural/API reference only.

### Current evaluation order

1. Test `hhopke/intervals-icu-mcp` first as the strongest interim direct-Intervals MCP candidate/reference.
2. Keep HduSy as a clean TypeScript/MIT reference for completeness and API handling.
3. Keep mvilanova as reference-only due to GPL-3.0 plus the same stream/security limitations.
4. Re-evaluate all community code when the official Intervals.icu MCP becomes available.

Regardless of the MCP client/provider chosen, Paul’s Running remains canonical and retains its OAuth/auth gateway, full FIT/raw storage, QA, idempotency, audit trail and provider-neutral boundaries.

Official MCP/forum reference: https://forum.intervals.icu/t/request-for-official-mcp-support-for-ai-tools-chatgpt-claude/126164

Community references:

- https://github.com/hhopke/intervals-icu-mcp
- https://github.com/HduSy/intervals-mcp-server
- https://github.com/mvilanova/intervals-mcp-server

## Validation

`npm test` includes the integration suite. PAU-12 acceptance tests cover workout translation, HR safety, mixed-target rejection, API-key authentication, 429 handling, idempotent upsert, pre-HTTP failure, external-reference persistence, retry scheduling, completed-activity import/deduplication and idempotent cancellation.
