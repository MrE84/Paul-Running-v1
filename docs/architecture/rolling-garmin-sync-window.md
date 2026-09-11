# Rolling Garmin sync window

Paul's Running keeps the complete training plan as canonical data. Garmin delivery is treated as a separate rolling, near-term projection rather than as the training-plan store.

## Policy

`RollingSyncWindowService` scans every canonical scheduled workout on each evaluation. The default policy is seven days ahead with a 24-hour grace period behind the current time. Seven days reflects observed bridge/watch behaviour and is deliberately configurable; it is not treated as a guaranteed Garmin contract.

Changing the provider horizon changes only delivery eligibility. It never deletes or truncates workouts in Paul's Running.

## Delivery states

Each calendar workout receives a provider-facing presentation state independent of its canonical calendar status:

- `planned`: retained in Paul's Running but currently outside the delivery window, or otherwise not eligible for publication.
- `queued`: inside the rolling window and waiting for or undergoing a sync attempt.
- `sent`: the current source snapshot has a successful sync job and external provider reference.
- `failed`: the current source snapshot has a retryable or permanent sync failure.

A retryable failure remains visibly failed until `nextAttemptAt`; when due, a later scan is allowed to retry it. A permanent failure is not automatically retried for the same source snapshot. Editing the calendar item creates a new idempotency fingerprint, so the edited source can be evaluated again.

## Source-of-truth boundary

The service never changes `CalendarItem.status` to represent delivery. Planned/completed/skipped/canceled/superseded remain canonical training states. Provider delivery state comes from `sync_jobs` and `external_references`.

This separation prevents an external provider or Garmin limitation from making future workouts disappear from the athlete's actual plan.

## Re-evaluation

A scheduler can call `syncEligible()` repeatedly. Every call scans the full set supplied to it and only sends workouts whose scheduled start falls inside the current window. Workouts beyond the horizon stay `planned`; once time advances and they enter the window they become `queued` and are eligible to publish.

Already-current `sent` workouts are not duplicated. If the source calendar item changes after delivery, the previous provider reference is considered stale and the item becomes `queued` for update.

## Tests

Acceptance coverage verifies:

- the full plan remains visible while only near-term workouts are queued;
- only eligible workouts are attempted;
- future workouts become eligible as time advances;
- sent workouts are not duplicated;
- edited sent workouts are updated;
- retryable failures respect `nextAttemptAt`;
- permanent failures remain visible and do not loop;
- edited source snapshots are released from an earlier permanent failure;
- canonical calendar status is not mutated by delivery state.
