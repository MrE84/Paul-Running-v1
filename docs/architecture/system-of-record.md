# System of Record

Status: Accepted for v1

## Decision

Paul's Running is the authoritative system of record for athlete data, zones, plans, workouts, scheduled training, completed activities, equipment and sync state.

External services such as Intervals.icu and Garmin are integration endpoints. They receive copies of local state or provide imported activity data, but their identifiers and representations never replace Paul's Running IDs or become the authoritative model.

## Why this matters

The platform must remain usable if an integration changes, becomes unavailable or is replaced. The user-facing calendar and training history therefore cannot depend on an external provider's database or seven-day delivery window.

## Identity rules

- Every domain entity gets a Paul's Running UUID when first created.
- A local UUID never changes because a provider changes.
- Provider identifiers are stored only in `external_references`.
- Imported activities receive a local activity UUID before any analysis or linking occurs.
- Plans and workouts are versioned locally. External copies are disposable projections of a specific local version.

## Write path

1. A user or approved AI client requests a change.
2. Paul's Running validates the request and writes canonical state locally.
3. The QA layer validates workout structure, dates, targets and sync safety.
4. A sync job is queued with an idempotency key.
5. A connector translates the canonical model into the provider-specific representation.
6. Provider identifiers and sync results are recorded against the local entity.

A provider failure never rolls back or deletes canonical local state.

## Read path

ChatGPT, the web app and future MCP tools read Paul's Running APIs. They do not query Intervals.icu or Garmin directly for canonical planning state.

Completed activity imports follow the opposite direction: provider event -> connector -> local activity UUID -> raw/source data retained -> normalized activity -> analysis.

## Connector boundary

Connectors are replaceable adapters. The core domain must not contain Intervals.icu-specific field names or assumptions.

The connector contract is expected to support:

- publish/update/cancel a scheduled structured workout;
- resolve an external reference for a local entity;
- ingest completed activity summaries and source files;
- consume provider webhooks or polling cursors;
- report success, retryable failure and permanent failure.

The initial implementation may use Intervals.icu, but a future direct Garmin connector or another bridge must be able to implement the same contract without changing the core data model.

## Deletion policy

Training entities should normally be archived or canceled rather than hard-deleted after they have been scheduled or synced. This preserves auditability and makes plan revisions explainable to AI clients.
