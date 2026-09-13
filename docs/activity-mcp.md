# ChatGPT activity-analysis MCP

Paul’s Running exposes a dedicated **read-only** Streamable HTTP MCP endpoint for approved AI/service clients:

`https://paul-running-v1.vercel.app/api/activity-mcp`

The endpoint is deliberately separate from the training-write MCP surface. It can read completed activity data but cannot create, revise, apply, publish or delete training objects.

## Authentication

Every POST request requires:

```text
Authorization: Bearer <token>
```

The server reads `PAUL_RUNNING_MCP_TOKEN` when configured and otherwise falls back to `PAUL_RUNNING_API_TOKEN`, matching the established PAU-18 MCP transport pattern.

The credential must be configured in the ChatGPT/custom-MCP connector or other approved service configuration. It must **not** be pasted into a conversation, committed to the repository, returned by a tool, placed in a URL/query string, or written to logs.

## Read-only tools

### `list_activities`

Lists recent activity summaries/readiness records for the primary athlete.

### `get_activity_analysis`

Returns the complete versioned analysis projection used by Activity Analysis, including:

- every elapsed-time sample;
- recorded distance samples;
- latitude/longitude samples;
- heart-rate trace;
- pace and speed trace;
- elevation/altitude trace;
- cadence;
- power, grade, device temperature and running-dynamics channels when recorded;
- laps, zones, quality flags, provenance and derived intelligence.

This is the primary tool for sample-by-sample analysis.

### `get_activity_raw`

Returns the stored decoded FIT payload behind the projection, plus basic activity identity/source metadata.

### `get_activity_sample`

Accepts an activity ID and elapsed seconds and returns the nearest stored sample, with explicit convenience fields for:

- HR (bpm)
- pace (seconds/km)
- speed (m/s)
- elevation (m)
- cadence (spm)
- distance (m)
- GPS latitude/longitude
- all other available channels at that sample

It also returns the actual matched elapsed time and delta from the requested time.

## ChatGPT connector configuration

Configure a remote MCP connection with:

```text
URL: https://paul-running-v1.vercel.app/api/activity-mcp
Authentication: Bearer token
Credential: PAUL_RUNNING_MCP_TOKEN
```

The bearer credential belongs in the connector’s secure credential configuration, outside model-visible tool arguments and conversation history.

## Production acceptance test — PAU-44

Use activity:

`i185832465` — Saturday 12 September 2026 at approximately 08:32 local time.

Acceptance requires the connected service identity to:

1. call `get_activity_analysis` successfully without HTTP 401;
2. confirm `streams.elapsed` contains sample-level data;
3. confirm `streams.channels.heart_rate` contains the complete HR trace;
4. confirm pace/speed, altitude/elevation, GPS and cadence are present where recorded;
5. call `get_activity_raw` successfully;
6. call `get_activity_sample` with `elapsedSeconds: 1123` (18:43) and report the matched HR, pace, elevation and cadence;
7. confirm no write tools are exposed by this endpoint.

PAU-44 is complete only after this production test is performed through the connected ChatGPT/service identity, not merely through unit tests or the browser UI.
