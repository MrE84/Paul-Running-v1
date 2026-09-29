---
name: activity-access
description: Use Paul’s Running activity MCP connection to read and analyse completed running activities, including sample-level telemetry and FIT-derived analysis. Use only for read-only activity access; do not create, edit, schedule, or delete workouts or athlete data.
---

# Paul’s Running activity access

Use the configured Paul’s Running MCP server for completed running activities only.

## Allowed scope

- Read completed running activities.
- Retrieve full sample-level activity telemetry when exposed by the server.
- Retrieve FIT-derived activity analysis when exposed by the server.
- Summarise, compare, and analyse returned activity data.

## Restrictions

- Treat this connection as read-only.
- Do not create, update, delete, schedule, or sync workouts.
- Do not modify athlete profile, thresholds, zones, plans, credentials, or settings.
- Do not expand beyond activity access unless the plugin is explicitly updated later.
- Never invent telemetry or analysis fields that were not returned by the MCP server.

## Workflow

1. Identify the completed activity the user wants to inspect.
2. Use the MCP tools exposed by Paul’s Running to retrieve that activity and the requested telemetry or analysis.
3. Prefer sample-level data when the user asks about traces, intervals, peaks, time-above-threshold, rolling bests, or exact segment analysis.
4. State clearly when a requested metric is unavailable from the returned activity payload.
5. Keep all operations read-only.
