# Training Calendar control surface

PAU-19 adds a thin browser client over the existing Paul’s Running training API. It does not add a new service, database or provider.

## Runtime path

`Browser -> /api/v1 -> Paul’s Running service/store -> QA -> production publisher -> Intervals.icu -> Garmin`

The PostgreSQL database remains canonical. Intervals.icu remains a replaceable delivery adapter.

## Authentication

The page is publicly routable, but protected training reads/writes only begin after the athlete enters the existing `PAUL_RUNNING_API_TOKEN` into a password field. The token is held only in React component memory and is sent only as the same-origin `Authorization: Bearer` header. It is not embedded in HTML, committed to source, written to localStorage/sessionStorage, or included in URL/query parameters.

Reloading or leaving the page clears the token.

## Race-week action

The race-week control creates three canonical workouts and one versioned plan, then applies it from Monday 14 September 2026 in `Europe/London`:

- Monday 14 Sep 17:30 — 11 km technical/race-kit rehearsal;
- Saturday 19 Sep 17:00 — optional pre-race shakeout;
- Sunday 20 Sep 09:00 — 21.1 km route-aware 1:50 race.

Wednesday 16 September is deliberately omitted per the athlete’s latest instruction. The action uses stable idempotency keys, so repeating the identical operation reuses the durable prior results rather than creating duplicate canonical entities.

All workout steps are time- or distance-terminated. The race uses 21 one-kilometre route-aware pace steps plus a final 100 m step; the midpoint pace arithmetic totals exactly 6,600 seconds (1:50:00). Easy/recovery portions of the rehearsal and shakeout are intentionally untargeted so the current Intervals.icu adapter does not need a mixed HR/pace target family or an unavailable HR anchor.

After applying the plan, the control asks the existing PAU-17 publisher to evaluate each calendar item. Items outside the rolling Garmin delivery window remain canonical and visible with a planned state rather than being forced through the provider.

## Lunch-walk live test

The known-good five-by-two-minute Advanced Lunch Break Walk remains available as a one-item plan. Because the original 15:00 validation slot has passed, the page requires an explicit future local date/time before creating and publishing the test.
