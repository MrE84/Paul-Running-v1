# Production workout publishing

PAU-17 turns the existing Intervals.icu connector and rolling Garmin delivery window into a production-callable operation.

## Flow

`POST /api/v1/calendar-items/{id}/publish` uses the canonical workout revision already stored by Paul's Running. The route is protected by the PAU-15 Bearer token and requires an `Idempotency-Key` header. Provider credentials are never accepted from the request.

At runtime the server reads `INTERVALS_ICU_API_KEY` and optional `INTERVALS_ICU_ATHLETE_ID` from Vercel environment variables. If the provider key is absent, publishing fails closed with `INTERVALS_ICU_AUTH_NOT_CONFIGURED`.

The publisher reconstructs the canonical scheduled workout, loads the athlete's active capacity and zone sets, derives an Intervals.icu heart-rate anchor from LT2 when available (falling back to max HR), runs the existing workout QA/translation path, and evaluates the PAU-13 rolling delivery window before making a provider request.

A source-specific PostgreSQL idempotency lock serializes concurrent publish requests for the same calendar item, workout version and calendar revision. The existing Intervals.icu upsert key remains `paul-running:<calendar-item-id>`, so a repeated current source cannot create a duplicate provider event. Sync jobs and external references are persisted through the same durable integration-state store used by the training API.

## First live validation

`advancedLunchWalkPreset()` defines the known-good Advanced Lunch Break Walk as five automatic two-minute steps (10 minutes total) with no physiological target. It is intentionally simple for the first production delivery test through Intervals.icu -> Garmin Connect -> Fenix 5.

## Remaining client bridge

This endpoint completes Paul's Running -> Intervals.icu/Garmin publishing. A ChatGPT/MCP client still needs an authenticated callable bridge to the PAU-15 API before ChatGPT can invoke the endpoint directly without a separate HTTP-capable connector.
