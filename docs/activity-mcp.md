# ChatGPT activity-analysis access

Paul’s Running provides two authenticated **read-only** machine-access paths for completed activity data.

## 1. Activity MCP — preferred connector path

Streamable HTTP MCP endpoint:

`https://paul-running-v1.vercel.app/api/activity-mcp`

Every POST request requires `Authorization: Bearer <token>`. ChatGPT obtains a scoped token through the server's OAuth 2.1 authorization-code flow with S256 PKCE; it never receives or stores `PAUL_RUNNING_API_TOKEN`. The existing static `PAUL_RUNNING_MCP_TOKEN` bearer remains available for explicitly configured non-ChatGPT service clients.

OAuth discovery is published at:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`

The ChatGPT connection uses its stable Client ID Metadata Document and exact stable redirect URI. The Codex plugin client uses OpenAI's separate stable Client ID Metadata Document and an RFC 8252 loopback callback restricted to `localhost` or `127.0.0.1`. Both paths require issuer identification, the `activities:read` scope and S256 PKCE, and receive one-hour access tokens with renewable 30-day refresh tokens. Authorization codes expire after five minutes and their identifiers are atomically consumed in PostgreSQL to prevent replay. The consent page accepts either the existing secure activity browser session or a direct owner-token check; the owner token is submitted only to Paul's Running and is never returned to ChatGPT or Codex.

The endpoint exposes only:

- `list_activities`
- `get_activity_analysis`
- `get_activity_raw`
- `get_activity_sample`

It cannot create, revise, apply, publish or delete training objects.

## 2. Short-lived signed GET — non-ChatGPT service fallback

Approved non-ChatGPT tooling can authenticate **GET activity reads only** with an ephemeral Ed25519 key. This is not the ChatGPT connection mechanism: ChatGPT does not receive custom private keys or API keys.

The public-key registry is intentionally kept on the repository's `agent-auth` branch at:

`agent-read-keys.json`

Only public keys are stored there. The private signing key must remain inside the authorized client/session and must never be committed, sent to the server, pasted into a conversation, placed in a URL, or written to logs.

Each key is restricted to `activities:read`, has an issuance time and expiry time, and the server rejects key lifetimes longer than 36 hours. Individual request signatures expire after two minutes, with a small allowance for clock skew.

Signed requests use these query parameters:

- `_agentKey` — registered key ID
- `_agentTs` — Unix timestamp in seconds
- `_agentNonce` — high-entropy per-request nonce
- `_agentSig` — URL-safe base64 Ed25519 signature

The canonical signed message is deliberately language-neutral:

```text
GET
<exact pathname>
<_agentTs>
<_agentNonce>
```

This binds the request to one exact activity API path and a short validity window without depending on language-specific query-string collation. Query options such as `elapsedSeconds`, `limit` and `recompute` remain subject to the server's existing validation and bounds; changing them cannot expand the signed identity beyond the exact activity path.

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

## Connect in ChatGPT

1. Enable Developer mode under **Settings → Security and login**.
2. Open **Plugins**, select **+**, and create a connection to `https://paul-running-v1.vercel.app/api/activity-mcp`.
3. Approve the read-only `activities:read` consent screen. If a secure Activity Analysis browser session is already active, no API token re-entry is required.
4. Start a new conversation with Paul’s Running enabled and run the production acceptance test above.
