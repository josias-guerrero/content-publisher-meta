import type Database from "better-sqlite3";
/** Explicit additive migration. Never assigns owners, deduplicates or requeues historical posts. */
export function migrate(sqlite: Database.Database) {
  sqlite.transaction(() => {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, platform TEXT NOT NULL, external_id TEXT NOT NULL, name TEXT, access_token TEXT NOT NULL, token_expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), caption TEXT, media_urls TEXT NOT NULL, type TEXT, thumb_offset INTEGER, cover_url TEXT, scheduled_at INTEGER NOT NULL, status TEXT NOT NULL, container_id TEXT, error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`);
    const additions: Record<string, Record<string, string>> = {
      accounts: { name: "TEXT" },
      posts: {
        type: "TEXT",
        thumb_offset: "INTEGER",
        cover_url: "TEXT",
        remote_id: "TEXT",
        remote_kind: "TEXT",
        permalink: "TEXT",
        media_metadata: "TEXT",
        cover_metadata: "TEXT",
        lease_until: "INTEGER",
        lease_owner: "TEXT",
        attempts: "INTEGER NOT NULL DEFAULT 0",
        error_code: "TEXT",
        retryable: "INTEGER NOT NULL DEFAULT 0",
        publish_started_at: "INTEGER",
        meta_error: "TEXT",
      },
    };
    for (const [table, cols] of Object.entries(additions)) {
      const present = new Set(
        (
          sqlite.prepare(`PRAGMA table_info(${table})`).all() as {
            name: string;
          }[]
        ).map((c) => c.name),
      );
      for (const [col, type] of Object.entries(cols))
        if (!present.has(col))
          sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
    sqlite.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY, agency_id TEXT NOT NULL, provider TEXT NOT NULL, login_mode TEXT NOT NULL,
      app_id TEXT NOT NULL, subject_id TEXT NOT NULL, scopes TEXT NOT NULL, token TEXT NOT NULL,
      token_type TEXT NOT NULL, expires_at INTEGER, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS grants (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), connection_id TEXT NOT NULL REFERENCES connections(id),
      agency_id TEXT NOT NULL, client_id TEXT NOT NULL, token TEXT NOT NULL, token_type TEXT NOT NULL, capabilities TEXT NOT NULL DEFAULT '{}',
      UNIQUE(account_id, connection_id, agency_id, client_id));
    CREATE TABLE IF NOT EXISTS oauth_sessions (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, agency_id TEXT NOT NULL, client_id TEXT NOT NULL, user_id TEXT NOT NULL,
      session_hash TEXT NOT NULL, state_hash TEXT UNIQUE NOT NULL, ticket_hash TEXT UNIQUE NOT NULL, browser_hash TEXT,
      expires_at INTEGER NOT NULL, consumed_at INTEGER, status TEXT NOT NULL DEFAULT 'pending', connection_id TEXT, assets TEXT, selected TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS post_ownership (
      post_id TEXT PRIMARY KEY REFERENCES posts(id), agency_id TEXT NOT NULL, client_id TEXT NOT NULL, grant_id TEXT NOT NULL REFERENCES grants(id));
    CREATE TABLE IF NOT EXISTS idempotency (
      agency_id TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL, payload_hash TEXT NOT NULL, resource_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(agency_id, operation, key));
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL, delivered_at INTEGER, lease_until INTEGER);
    CREATE TABLE IF NOT EXISTS deletion_requests (
      id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, provider TEXT NOT NULL, app_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(provider,app_id,subject_hash));
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL, agency_id TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS publisher_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO publisher_migrations VALUES (5, unixepoch());
    CREATE INDEX IF NOT EXISTS posts_queue ON posts(status,scheduled_at);
    CREATE INDEX IF NOT EXISTS grants_scope ON grants(agency_id,client_id,account_id);
    `);
    const deletionColumns = new Set(
      (
        sqlite.prepare("PRAGMA table_info(deletion_requests)").all() as {
          name: string;
        }[]
      ).map((c) => c.name),
    );
    for (const [name, type] of Object.entries({
      user_hash: "TEXT",
      cutoff: "INTEGER",
    }))
      if (!deletionColumns.has(name))
        sqlite.exec(`ALTER TABLE deletion_requests ADD COLUMN ${name} ${type}`);
    sqlite.exec(`UPDATE deletion_requests SET user_hash=subject_hash,cutoff=created_at WHERE user_hash IS NULL;
      CREATE TABLE IF NOT EXISTS deletion_targets(request_id TEXT NOT NULL,connection_id TEXT NOT NULL,PRIMARY KEY(request_id,connection_id));
      CREATE TABLE IF NOT EXISTS deletion_scopes(request_id TEXT NOT NULL,agency_id TEXT NOT NULL,client_id TEXT NOT NULL,post_ids TEXT NOT NULL,PRIMARY KEY(request_id,agency_id,client_id));
      INSERT OR IGNORE INTO publisher_migrations VALUES(6,unixepoch());`);
  })();
}
