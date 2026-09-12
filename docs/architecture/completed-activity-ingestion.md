# Completed activity ingestion

PAU-21 operationalizes the inbound half of the Garmin bridge while preserving Paul’s Running as the system of record.

## Runtime flow

1. Garmin records the activity and uploads it to Garmin Connect.
2. Garmin Connect synchronizes the completed activity to Intervals.icu.
3. Paul’s Running calls the existing Intervals.icu activity connector over a bounded recent date window.
4. Provider activity IDs are checked against durable `ExternalReference` records before any new local activity is created.
5. For a new activity, Paul’s Running fetches the Intervals.icu activity detail and original activity file.
6. FIT payloads are decoded with the existing FIT Activity Explorer core; gzip-wrapped FIT files are supported.
7. Summary metrics plus the complete normalized FIT message tree are persisted in PostgreSQL as the canonical `Activity` record.
8. Provider references and import sync jobs are persisted separately so retries and repeated imports remain idempotent.
9. Activity Analysis can load those canonical records and render them with the same summary, chart, route, lap, record and raw-data engine used for local FIT files.

## Production API

`POST /api/v1/activities/import`

- requires normal Paul’s Running bearer authentication;
- requires an `Idempotency-Key` header;
- accepts `{ "maxPages": 1 }` through `{ "maxPages": 3 }`;
- fails closed when `INTERVALS_ICU_API_KEY` is absent;
- serializes import runs for the primary athlete;
- returns counts for imported, already-imported and failed provider activities.

`GET /api/v1/activities?limit=N` remains the canonical activity read path.

## Activity Analysis UI

The Activity Explorer now supports two independent sources:

- **Canonical Garmin activities**: enter `PAUL_RUNNING_API_TOKEN`, then use **Sync latest** or **Load stored**. The bearer token stays only in page memory.
- **Manual FIT files**: continue to decode entirely in the browser; these files are not uploaded.

Both sources converge on the same FIT Explorer analysis model.

## Deliberate non-goals

- Intervals.icu is not the coaching source of truth.
- No Tredict dependency is introduced.
- No public unauthenticated activity endpoint is introduced.
- This change does not add another database or runtime service.
- Background cron polling is not required for the first production cut; import is demand-driven so a newly completed activity can be pulled immediately before analysis without exposing another credential or public trigger.
