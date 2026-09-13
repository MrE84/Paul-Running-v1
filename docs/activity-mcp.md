# ChatGPT activity-analysis access

Paul’s Running provides two authenticated **read-only** machine-access paths for completed activity data.

## 1. Activity MCP — preferred connector path

Streamable HTTP MCP endpoint:

`https://paul-running-v1.vercel.app/api/activity-mcp`

Every POST request requires `Authorization: Bearer <token>`. The server reads `PAUL_RUNNING_MCP_TOKEN` when configured and otherwise falls back to `PAUL_RUNNING_API_TOKEN`, matching the established PAU-18 MCP transport pattern.

The endpoint exposes only:

- `list_activities`
- `get_activity_analysis`
- `get_activity_raw`
- `get_activity_sample`

It cannot create, revise, apply, publish or delete training objects.

## 2. Short-lived signed GET — connector-independent fallback

Where a ChatGPT surface cannot attach a custom MCP server, approved tooling can authenticate **GET activity reads only** with an ephemeral Ed25519 key.

The public-key registry is intentionally kept on the repository's `agent-auth` branch at:

`agent-read-keys.json`

Only public keys are stored there. The private signing key must remain inside the authorized client/session and must never be committed, sent to the server, pasted into a conversation, placed in a URL, or written to logs.

Each key is restricted to `activities:read`, has an issuance time and expiry time, and the server rejects key lifetimes longer than 36 hours. Individual request signatures expire after two minutes, with a small allowance for clock skew.

Signed requests use these query parameters:

- `_agentKey` — registered key ID
- `_agentTs` — Unix timestamp in seconds
- `_agentNonce` — high-entropy per-request nonce
- `_agentSig` — URL-safe base64 Ed25519 signature

The canonical signed message is:

```text
GET
<pathname>
<all query parameters except _agentSig, sorted by key then value>
```

After verification, the server removes the four transport-auth parameters and internally delegates to the existing bearer-protected training API. Existing browser-session and bearer-token authentication therefore remain authoritative and unchanged.

Signed authentication is accepted only for `/api/v1/activities` reads. It cannot authorize POST/PATCH requests or non-activity APIs.

### Point lookup

A signed-only compact point endpoint is available at:

`GET /api/v1/activities/{activityId}/sample?elapsedSeconds={seconds}`

It returns the nearest recorded sample with HR, pace, speed, elevation, cadence, distance, GPS, record index and all other available channels. This avoids transferring a whole FIT projection when the question concerns one instant.

## Activity data available

`GET /api/v1/activities/{id}/analysis` / `get_activity_analysis` returns the complete versioned analysis projection used by Activity Analysis, including:

- every elapsed-time sample;
- recorded distance samples;
- latitude/longitude samples;
- complete heart-rate trace;
- pace and speed trace;
- elevation/altitude trace;
- cadence;
- power, grade, device temperature and running-dynamics channels when recorded;
- laps, zones, quality flags, provenance and derived intelligence.

`GET /api/v1/activities/{id}/raw` / `get_activity_raw` returns the stored decoded FIT payload behind that projection.

## Production acceptance test — PAU-44

Use activity:

`i185832465` — Saturday 12 September 2026 at approximately 08:32 local time.

Acceptance requires an approved ChatGPT/service identity to:

1. retrieve `/analysis` successfully without HTTP 401;
2. confirm `streams.elapsed` contains sample-level data;
3. confirm `streams.channels.heart_rate` contains the complete HR trace;
4. confirm pace/speed, altitude/elevation, GPS and cadence are present where recorded;
5. retrieve `/raw` successfully;
6. query `/sample?elapsedSeconds=1123` (18:43) and report the matched HR, pace, elevation and cadence;
7. confirm the signed path cannot perform writes or access non-activity APIs.

PAU-44 is complete only after this production test is performed through the machine identity, not merely through unit tests or the browser UI.
