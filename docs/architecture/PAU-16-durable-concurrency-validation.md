# PAU-16 durable concurrency hardening

PAU-16 uses Neon PostgreSQL as the durable repository behind the training API.

## Concurrency model

The production runtime uses `SerializedPostgresTrainingStore`, a thin wrapper around `PostgresTrainingStore`.

Workout and training-plan writes acquire an entity-scoped `pg_advisory_xact_lock` through the base store's existing `withIdempotencyLock()` transaction. The lock, optimistic version check, revision write and canonical-entity write therefore run on the same `PoolClient` and the same PostgreSQL transaction. No session-scoped advisory lock is used, so the design is compatible with Neon/PgBouncer transaction pooling.

The training API's idempotency path also holds the durable idempotency lock across the lookup, domain mutation and idempotency-record write. Concurrent requests with the same actor/action/idempotency key therefore execute the command once and return the same persisted response.

Repository version conflicts are translated to the API's structured `409 VERSION_CONFLICT` error rather than leaking as an unclassified server failure.

## Database-backed validation

`lib/training-api/postgres-store.integration.test.ts` uses `DATABASE_URL_UNPOOLED` only for the test harness so it can create an isolated temporary schema without relying on PgBouncer startup-parameter support. Production runtime traffic continues to use the normal `DATABASE_URL` pooled connection.

The test creates two independent store/service instances and proves:

1. state is visible across instances;
2. two simultaneous identical API commands create exactly one workout and return the same durable response;
3. two simultaneous edits from the same expected workout version produce exactly one successful revision and one structured version conflict;
4. the persisted workout ends at exactly one new version.

The temporary schema is dropped after the test.
