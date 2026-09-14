import { Pool } from "pg";

const globalStore = globalThis as typeof globalThis & {
  __paulRunningOAuthPool?: Pool;
  __paulRunningOAuthSchema?: Promise<void>;
};

function pool() {
  if (globalStore.__paulRunningOAuthPool) return globalStore.__paulRunningOAuthPool;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  globalStore.__paulRunningOAuthPool = new Pool({
    connectionString,
    max: 2,
    ssl: { rejectUnauthorized: false },
  });
  return globalStore.__paulRunningOAuthPool;
}

async function ensureSchema(database: Pool) {
  if (!globalStore.__paulRunningOAuthSchema) {
    globalStore.__paulRunningOAuthSchema = database.query(`
      create table if not exists oauth_authorization_code_uses (
        jti text primary key,
        expires_at timestamptz not null,
        consumed_at timestamptz not null default now()
      );
      create index if not exists oauth_authorization_code_uses_expiry_idx
        on oauth_authorization_code_uses (expires_at);
    `).then(() => undefined).catch((error) => {
      globalStore.__paulRunningOAuthSchema = undefined;
      throw error;
    });
  }
  return globalStore.__paulRunningOAuthSchema;
}

/** Atomically records a code JTI. A duplicate insert proves the code was replayed. */
export async function consumeOAuthAuthorizationCode(jti: string, expiresAt: number) {
  const database = pool();
  if (!database) return false;
  await ensureSchema(database);
  const result = await database.query(
    `insert into oauth_authorization_code_uses (jti, expires_at)
     values ($1, to_timestamp($2))
     on conflict (jti) do nothing
     returning jti`,
    [jti, expiresAt],
  );
  void database.query("delete from oauth_authorization_code_uses where expires_at < now() - interval '1 day'").catch(() => undefined);
  return result.rowCount === 1;
}
