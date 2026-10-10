import { Pool, type QueryResultRow } from "pg";
import type { ActivityShoeOverride, ShoeKey } from "./shoe-rotation";

interface DocumentRow extends QueryResultRow {
  payload: ActivityShoeOverride;
}

const globalState = globalThis as typeof globalThis & {
  __paulRunningShoeOverridePool?: Pool;
  __paulRunningShoeOverrides?: Map<string, ActivityShoeOverride>;
};

function memoryOverrides(): Map<string, ActivityShoeOverride> {
  if (!globalState.__paulRunningShoeOverrides) globalState.__paulRunningShoeOverrides = new Map();
  return globalState.__paulRunningShoeOverrides;
}

function pool(): Pool | undefined {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return undefined;
  if (!globalState.__paulRunningShoeOverridePool) {
    globalState.__paulRunningShoeOverridePool = new Pool({
      connectionString,
      max: 2,
      ssl: { rejectUnauthorized: false },
    });
  }
  return globalState.__paulRunningShoeOverridePool;
}

async function ensureDocumentStore(db: Pool): Promise<void> {
  await db.query(`
    create table if not exists training_api_documents (
      kind text not null,
      entity_id text not null,
      athlete_id text,
      sort_key timestamptz,
      payload jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (kind, entity_id)
    )
  `);
}

export async function listShoeOverrides(athleteId: string): Promise<ActivityShoeOverride[]> {
  const db = pool();
  if (!db) {
    return [...memoryOverrides().values()]
      .filter((item) => item.athleteId === athleteId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  await ensureDocumentStore(db);
  const result = await db.query<DocumentRow>(
    `select payload from training_api_documents
     where kind = 'activity_shoe_override' and athlete_id = $1
     order by sort_key desc nulls last, entity_id asc`,
    [athleteId],
  );
  return result.rows.map((row) => row.payload);
}

export async function saveShoeOverride(
  athleteId: string,
  activityId: string,
  shoeKey: ShoeKey | null,
): Promise<ActivityShoeOverride> {
  const override: ActivityShoeOverride = {
    activityId,
    athleteId,
    shoeKey,
    updatedAt: new Date().toISOString(),
  };

  const db = pool();
  if (!db) {
    memoryOverrides().set(`${athleteId}:${activityId}`, override);
    return override;
  }

  await ensureDocumentStore(db);
  await db.query(
    `insert into training_api_documents(kind, entity_id, athlete_id, sort_key, payload)
     values ('activity_shoe_override', $1, $2, $3::timestamptz, $4::jsonb)
     on conflict (kind, entity_id) do update
     set athlete_id = excluded.athlete_id,
         sort_key = excluded.sort_key,
         payload = excluded.payload,
         updated_at = now()`,
    [activityId, athleteId, override.updatedAt, JSON.stringify(override)],
  );
  return override;
}
