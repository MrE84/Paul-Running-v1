---
name: training-access
description: Use Paul’s Running training MCP connection to read the athlete’s canonical training data and, when explicitly requested, create validated workouts and plans, schedule calendar items, or publish eligible workouts through Intervals.icu for Garmin delivery.
---

# Paul’s Running training access

Use the configured Paul’s Running training MCP server for canonical training-calendar workflows.

## Supported scope

- Read the athlete profile, zones, workouts, plans, calendar and delivery status.
- Create QA-gated structured workouts and training plans.
- Apply exact plan revisions to local dates and times.
- Publish eligible calendar items through Intervals.icu for Garmin delivery.
- Revise workouts with optimistic version checking.

## Safety and workflow

1. Treat Paul’s Running as the canonical system of record.
2. Read the relevant calendar range before scheduling so conflicts are visible.
3. Use the athlete’s stated timezone; default to `Europe/London` only when that is already established in context.
4. Create the workout, create a plan referencing its exact revision, and apply that plan to produce a canonical calendar item.
5. Publish only when the user explicitly asks to send, sync or deliver the workout.
6. After publishing, call the sync-status tool and report the durable delivery state and external reference when available.
7. Preserve idempotency by reusing identical inputs for retries; do not create duplicates to recover from an uncertain result.
8. Never ask the user to paste API keys, bearer tokens or OAuth credentials into the conversation. Authentication belongs in the MCP connection flow.
9. Never claim Garmin delivery merely because the calendar item exists; distinguish canonical `planned` state from provider delivery state.

## Write boundaries

- Do not create, revise, schedule or publish anything unless the user requested that mutation.
- Do not bypass workout QA, optimistic concurrency, the rolling delivery window or confirmation requirements.
- Do not expose arbitrary network, database, filesystem or credential operations.
