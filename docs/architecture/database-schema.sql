-- Paul's Running v1 canonical PostgreSQL schema
-- Design artifact for PAU-7. The application database is the system of record.
-- Provider-specific identifiers and state are isolated in integration tables.

create extension if not exists pgcrypto;

create type sport_type as enum ('running', 'cycling', 'walking', 'other');
create type calendar_item_status as enum ('planned', 'completed', 'skipped', 'canceled', 'superseded');
create type workout_step_kind as enum ('step', 'repeat');
create type workout_duration_type as enum ('time', 'distance', 'open');
create type workout_target_type as enum ('none', 'heart_rate', 'pace', 'cadence', 'power');
create type sync_operation as enum ('publish', 'update', 'cancel', 'import');
create type sync_state as enum ('queued', 'running', 'succeeded', 'retryable_failure', 'permanent_failure');
create type actor_type as enum ('user', 'ai_client', 'connector', 'system');

create table athletes (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  timezone text not null default 'Europe/London',
  height_cm numeric(6,2),
  weight_kg numeric(6,2),
  date_of_birth date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table capacity_revisions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id),
  effective_from timestamptz not null,
  effective_to timestamptz,
  max_hr_bpm integer,
  resting_hr_bpm integer,
  lt1_hr_bpm integer,
  lt2_hr_bpm integer,
  lt1_pace_sec_per_km integer,
  lt2_pace_sec_per_km integer,
  source text not null,
  source_notes text,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create index capacity_revisions_athlete_effective_idx
  on capacity_revisions (athlete_id, effective_from desc);

create table zone_sets (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id),
  sport sport_type not null,
  target_type workout_target_type not null,
  name text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  source text not null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create table zones (
  id uuid primary key default gen_random_uuid(),
  zone_set_id uuid not null references zone_sets(id) on delete cascade,
  zone_number integer not null,
  name text not null,
  lower_bound numeric,
  upper_bound numeric,
  unit text not null,
  unique (zone_set_id, zone_number),
  check (zone_number > 0),
  check (lower_bound is null or upper_bound is null or lower_bound <= upper_bound)
);

-- Stable workout identity. Content lives in immutable revisions.
create table workouts (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id),
  current_version integer not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_version > 0)
);

create table workout_revisions (
  workout_id uuid not null references workouts(id),
  version integer not null,
  name text not null,
  description text,
  sport sport_type not null default 'running',
  created_at timestamptz not null default now(),
  created_by_actor actor_type not null,
  primary key (workout_id, version),
  check (version > 0)
);

create table workout_steps (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null,
  workout_version integer not null,
  parent_step_id uuid references workout_steps(id),
  sequence integer not null,
  kind workout_step_kind not null default 'step',
  name text,
  duration_type workout_duration_type,
  duration_value numeric,
  duration_unit text,
  target_type workout_target_type not null default 'none',
  target_low numeric,
  target_high numeric,
  target_unit text,
  repeat_count integer,
  instruction text,
  foreign key (workout_id, workout_version)
    references workout_revisions(workout_id, version) on delete cascade,
  unique (workout_id, workout_version, parent_step_id, sequence),
  check (sequence >= 0),
  check (
    (kind = 'repeat' and repeat_count is not null and repeat_count > 0)
    or
    (kind = 'step' and repeat_count is null)
  ),
  check (
    (kind = 'repeat' and duration_type is null and duration_value is null)
    or
    (kind = 'step' and duration_type is not null)
  ),
  check (duration_type = 'open' or duration_value is null or duration_value > 0),
  check (target_low is null or target_high is null or target_low <= target_high)
);

-- Stable reusable plan identity. Plan composition is versioned immutably.
create table training_plans (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id),
  current_version integer not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_version > 0)
);

create table training_plan_revisions (
  plan_id uuid not null references training_plans(id),
  version integer not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  created_by_actor actor_type not null,
  primary key (plan_id, version),
  check (version > 0)
);

create table plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  plan_version integer not null,
  sequence integer not null,
  day_offset integer not null,
  local_start_time time,
  workout_id uuid not null,
  workout_version integer not null,
  foreign key (plan_id, plan_version)
    references training_plan_revisions(plan_id, version) on delete cascade,
  foreign key (workout_id, workout_version)
    references workout_revisions(workout_id, version),
  unique (plan_id, plan_version, sequence),
  check (sequence >= 0),
  check (day_offset >= 0)
);

create table calendar_items (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id),
  workout_id uuid not null,
  workout_version integer not null,
  source_plan_id uuid,
  source_plan_version integer,
  source_plan_item_id uuid,
  scheduled_start timestamptz not null,
  timezone text not null,
  status calendar_item_status not null default 'planned',
  supersedes_calendar_item_id uuid references calendar_items(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workout_id, workout_version)
    references workout_revisions(workout_id, version),
  foreign key (source_plan_id, source_plan_version)
    references training_plan_revisions(plan_id, version),
  foreign key (source_plan_item_id) references plan_items(id)
);

create index calendar_items_athlete_schedule_idx
  on calendar_items (athlete_id, scheduled_start);

create table activities (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id),
  calendar_item_id uuid references calendar_items(id),
  sport sport_type not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  distance_meters numeric,
  avg_hr_bpm integer,
  max_hr_bpm integer,
  avg_pace_sec_per_km integer,
  avg_cadence_spm numeric,
  elevation_gain_meters numeric,
  normalized_data jsonb not null default '{}'::jsonb,
  source_file_name text,
  source_file_sha256 text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (duration_seconds is null or duration_seconds >= 0),
  check (distance_meters is null or distance_meters >= 0)
);

create index activities_athlete_started_idx
  on activities (athlete_id, started_at desc);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id),
  kind text not null,
  brand text,
  model text not null,
  nickname text,
  first_used_at date,
  retired_at date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table activity_equipment (
  activity_id uuid not null references activities(id) on delete cascade,
  equipment_id uuid not null references equipment(id),
  primary key (activity_id, equipment_id)
);

-- Provider mappings are deliberately isolated from canonical domain tables.
create table external_references (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id),
  entity_type text not null,
  entity_id uuid not null,
  provider text not null,
  external_id text not null,
  external_url text,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, entity_type, external_id),
  unique (provider, entity_type, entity_id)
);

create table sync_jobs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id),
  provider text not null,
  entity_type text not null,
  entity_id uuid not null,
  entity_version integer,
  operation sync_operation not null,
  state sync_state not null default 'queued',
  idempotency_key text not null unique,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  last_error_code text,
  last_error_message text,
  request_payload jsonb,
  response_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (attempt_count >= 0)
);

create index sync_jobs_dispatch_idx
  on sync_jobs (state, next_attempt_at, created_at);

create table sync_cursors (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id),
  provider text not null,
  cursor_type text not null,
  cursor_value text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (athlete_id, provider, cursor_type)
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(id),
  actor_type actor_type not null,
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_version integer,
  request_id text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_events_entity_idx
  on audit_events (entity_type, entity_id, occurred_at desc);

-- Important invariants enforced in application/service code:
-- 1. workouts.current_version must reference an existing workout_revisions row.
-- 2. training_plans.current_version must reference an existing training_plan_revisions row.
-- 3. parent workout steps must belong to the same workout revision.
-- 4. repeat containers may contain child steps but may not carry their own duration/target execution semantics.
-- 5. mutations create a new immutable revision when structured content materially changes.
-- 6. canonical writes commit before sync_jobs are queued.
-- 7. provider deletion/failure never deletes canonical state.
