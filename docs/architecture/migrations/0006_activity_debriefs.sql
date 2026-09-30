-- PAU-82: post-run debriefs.
--
-- Debriefs are stored as JSON documents in training_api_documents, like the other domain
-- objects, so no new table is needed and no existing data is touched:
--   kind = 'activity_debrief'           entity_id = <activity id>
--   kind = 'activity_debrief_revision'  entity_id = <activity id>@<version>
-- See docs/architecture/activity-debriefs.md.
--
-- The only schema change is a partial index for listing recent debriefs. The store also
-- creates it lazily on first use (PostgresTrainingStore.ensureSchema), so running this by
-- hand is optional. It is additive and safe to roll back with:
--   drop index if exists training_api_documents_debrief_idx;

create index if not exists training_api_documents_debrief_idx
  on training_api_documents (athlete_id, sort_key desc nulls last)
  where kind = 'activity_debrief';
