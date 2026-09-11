-- PAU-9: training calendar persistence refinements.
-- Adds the plan-application event and preserves the user's intended local date/time
-- alongside the canonical UTC scheduled instant.

create table plan_applications (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id),
  plan_id uuid not null,
  plan_version integer not null,
  start_date date not null,
  timezone text not null,
  applied_at timestamptz not null default now(),
  applied_by_actor actor_type not null,
  foreign key (plan_id, plan_version)
    references training_plan_revisions(plan_id, version),
  unique (id, plan_id, plan_version)
);

create index plan_applications_athlete_applied_idx
  on plan_applications (athlete_id, applied_at desc);

-- Give PostgreSQL a composite candidate key so a calendar item's plan-item reference
-- can be proven to belong to the same immutable plan revision recorded on that item.
alter table plan_items
  add constraint plan_items_provenance_key
  unique (id, plan_id, plan_version);

alter table calendar_items
  add column plan_application_id uuid references plan_applications(id),
  add column scheduled_local_date date,
  add column scheduled_local_time time;

create index calendar_items_plan_application_idx
  on calendar_items (plan_application_id);

-- A plan-generated calendar item must preserve the exact application that created it.
-- Manually-created calendar items may legitimately have no plan application.
alter table calendar_items
  add constraint calendar_item_plan_application_presence check (
    (source_plan_id is null and source_plan_version is null and source_plan_item_id is null and plan_application_id is null)
    or
    (source_plan_id is not null and source_plan_version is not null and source_plan_item_id is not null and plan_application_id is not null)
  ),
  add constraint calendar_item_source_plan_item_consistency
    foreign key (source_plan_item_id, source_plan_id, source_plan_version)
    references plan_items(id, plan_id, plan_version),
  add constraint calendar_item_plan_application_consistency
    foreign key (plan_application_id, source_plan_id, source_plan_version)
    references plan_applications(id, plan_id, plan_version);

-- New writes should always provide local date/time as well as scheduled_start.
-- These remain nullable in this migration so an eventual existing deployment can backfill safely
-- before a later migration makes them NOT NULL.
comment on column calendar_items.scheduled_start is
  'Canonical UTC instant for ordering, sync and API transport.';
comment on column calendar_items.scheduled_local_date is
  'Local calendar date chosen by plan application or manual scheduling.';
comment on column calendar_items.scheduled_local_time is
  'Local wall-clock start time, stored independently from the plan anchor date.';
comment on column calendar_items.timezone is
  'IANA timezone used to derive scheduled_start from local date/time.';
