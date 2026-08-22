import type Database from 'better-sqlite3';
import { logger } from '../lib/logger.js';

const REPOINT_POSTS = `
  UPDATE posts
  SET account_id = (
    SELECT keeper.id FROM accounts keeper
    WHERE keeper.platform = (SELECT src.platform FROM accounts src WHERE src.id = posts.account_id)
      AND keeper.external_id = (SELECT src.external_id FROM accounts src WHERE src.id = posts.account_id)
    ORDER BY keeper.created_at DESC, keeper.rowid DESC
    LIMIT 1
  )
  WHERE account_id IN (
    SELECT dup.id FROM accounts dup
    WHERE EXISTS (
      SELECT 1 FROM accounts newer
      WHERE newer.platform = dup.platform
        AND newer.external_id = dup.external_id
        AND (newer.created_at > dup.created_at OR (newer.created_at = dup.created_at AND newer.rowid > dup.rowid))
    )
  )
`;

const DELETE_DUPLICATES = `
  DELETE FROM accounts
  WHERE EXISTS (
    SELECT 1 FROM accounts AS newer
    WHERE newer.platform = accounts.platform
      AND newer.external_id = accounts.external_id
      AND (newer.created_at > accounts.created_at OR (newer.created_at = accounts.created_at AND newer.rowid > accounts.rowid))
  )
`;

const CREATE_UNIQUE_INDEX = `
  CREATE UNIQUE INDEX IF NOT EXISTS accounts_platform_external_id_unique
  ON accounts (platform, external_id)
`;

export function dedupeAccounts(sqlite: Database.Database): void {
  const accountsTable = sqlite
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'`
    )
    .get();

  if (!accountsTable) return;

  const duplicates = sqlite
    .prepare<[], { platform: string; external_id: string; total: number }>(
      `SELECT platform, external_id, COUNT(*) AS total
       FROM accounts
       GROUP BY platform, external_id
       HAVING COUNT(*) > 1`
    )
    .all();

  if (!duplicates.length) {
    sqlite.exec(CREATE_UNIQUE_INDEX);
    return;
  }

  logger.warn(
    { duplicates: duplicates.map((d) => ({ platform: d.platform, external_id: d.external_id, found: d.total })) },
    'Found duplicated linked accounts, keeping the most recent one per account'
  );

  sqlite.transaction(() => {
    const repointed = sqlite.prepare(REPOINT_POSTS).run();
    const deleted = sqlite.prepare(DELETE_DUPLICATES).run();
    sqlite.exec(CREATE_UNIQUE_INDEX);
    logger.info({ posts_repointed: repointed.changes, accounts_removed: deleted.changes }, 'Deduplicated accounts');
  })();
}
