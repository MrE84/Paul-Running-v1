# PAU-16 durable concurrency validation

PAU-16 uses Neon PostgreSQL as the durable repository behind the PAU-15 training API.

The production runtime uses `SerializedPostgresTrainingStore`, which adds PostgreSQL advisory locks around workout and training-plan optimistic writes. This ensures competing Vercel instances serialize writes for the same entity before the underlying transactional version check is evaluated.

`lib/training-api/postgres-store.integration.test.ts` runs against `DATABASE_URL` when it is available in Vercel. It creates an isolated temporary schema, validates persistence across two independently constructed store instances, verifies cross-instance idempotency locking, verifies that exactly one competing version update succeeds, and drops the temporary schema afterward.

Local/offline test runs without `DATABASE_URL` skip only this database integration test; the rest of the training API suite continues to run normally.
