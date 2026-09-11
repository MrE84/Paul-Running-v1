-- PAU-16: durable serverless persistence for the training API repository ports.
--
-- The canonical PAU-7 relational schema remains authoritative. These document tables are
-- a durable repository adapter for the current TypeScript domain objects, allowing the
-- PAU-15 API contract to survive deployments and concurrent Vercel function instances
-- without coupling HTTP handlers to a particular normalized persistence mapping.

create table if not exists training_api_documents (
  kind text not null,
  entity_id text not null,
  athlete_id uuid,
  sort_key timestamptz,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, entity_id)
);

create index if not exists training_api_documents_athlete_kind_idx
  on training_api_documents (athlete_id, kind, sort_key desc nulls last);

create index if not exists training_api_documents_payload_gin_idx
  on training_api_documents using gin (payload jsonb_path_ops);

create table if not exists training_api_idempotency (
  key text primary key,
  fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

comment on table training_api_documents is
  'Durable repository backing for PAU-15 TrainingApiStore and IntegrationStateStore domain objects.';

comment on table training_api_idempotency is
  'Cross-instance idempotency records. Writes are serialized with pg_advisory_xact_lock before this table is consulted.';
