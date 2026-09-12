# ChatGPT / MCP bridge

Paul’s Running exposes a constrained Streamable HTTP MCP endpoint at `/api/mcp`.

## Authentication

The MCP endpoint requires `Authorization: Bearer <token>`. The server reads `PAUL_RUNNING_MCP_TOKEN` when configured and otherwise reuses `PAUL_RUNNING_API_TOKEN`. The token is transport configuration only: it is never part of a model-visible tool schema, tool argument, tool response, or audit payload.

For production, prefer a dedicated `PAUL_RUNNING_MCP_TOKEN` so MCP access can be rotated independently from the REST API token.

## Tool surface

Read tools:

- `get_profile`
- `get_zones`
- `list_calendar`
- `get_sync_status`
- `list_workouts`
- `get_workout`
- `list_training_plans`
- `get_training_plan`

Write tools:

- `create_workout`
- `revise_workout`
- `create_training_plan`
- `apply_training_plan`
- `publish_calendar_item`
- `create_advanced_lunch_break_walk`

The bridge deliberately exposes no arbitrary HTTP fetch, SQL, shell, filesystem, environment-variable, or provider-credential operations.

## Safety and idempotency

Every write call is attributed to the constrained `chatgpt-mcp` actor. The bridge derives a deterministic idempotency key from the tool name and canonical arguments, so repeating an identical write call returns the durable prior result instead of creating a duplicate workout or plan. Existing optimistic concurrency, workout QA, rolling delivery-window logic, Intervals.icu upsert identity, audit events, sync jobs, and external-reference persistence remain authoritative behind the bridge.

`publish_calendar_item` only calls the existing PAU-17 publisher and therefore cannot bypass workout QA or the rolling Garmin delivery window.

## Protocol support

The endpoint supports the MCP handshake flow through `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, and `ping`, plus stateless `server/discover` for the 2026-07-28 protocol generation. It returns JSON responses over HTTP POST and does not require server-side session affinity.

## ChatGPT connection

Configure the remote MCP server URL as:

`https://paul-running-v1.vercel.app/api/mcp`

Configure its bearer credential outside the conversation/model context. The same secret must match `PAUL_RUNNING_MCP_TOKEN` (or `PAUL_RUNNING_API_TOKEN` when using the fallback). Do not paste the token into a chat message.

Recommended permissions are read access to profile/zones/calendar/workouts/plans plus the named training writes above. No generic network or database permission is required.

## First live validation

1. Call `get_profile` and `list_calendar`.
2. Call `create_advanced_lunch_break_walk`.
3. Create a one-item training plan for that workout revision.
4. Apply it at a date/time inside the current rolling delivery window.
5. Call `publish_calendar_item`.
6. Call `get_sync_status` and require `state: sent` plus an Intervals.icu external reference.
7. Repeat the exact publish call and confirm no second provider event is created.
8. Confirm the workout appears in Garmin Connect / Fenix 5.
