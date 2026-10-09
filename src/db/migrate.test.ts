import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from './migrate.js';
import { encrypt, decrypt } from '../lib/crypto.js';
it('restores a consistent WAL backup and preserves encrypted tokens, IDs and all historical job states', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'publisher-restore-test-'));
  const original = new Database(join(directory, 'original.db'));
  original.pragma('journal_mode=WAL');
  migrate(original);
  const token = encrypt('synthetic-restore-token');
  original
    .prepare(
      'INSERT INTO accounts(id,platform,external_id,name,access_token,token_expires_at,created_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run('preserve-id', 'instagram', 'external', 'Fixture', token, 123, 1);
  for (const status of [
    'pending',
    'publishing',
    'published',
    'failed',
    'cancelled',
    'reconciling',
  ])
    original
      .prepare(
        'INSERT INTO posts(id,account_id,media_urls,status,scheduled_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(status, 'preserve-id', '[]', status, 1, 1, 1);
  const before = original
    .prepare('SELECT id,account_id,status FROM posts ORDER BY id')
    .all();
  let restored: Database.Database | undefined;
  try {
    await original.backup(join(directory, 'restore.db'));
    restored = new Database(join(directory, 'restore.db'));
    migrate(restored);
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(restored.pragma('foreign_key_check')).toEqual([]);
    expect(
      restored
        .prepare('SELECT id,account_id,status FROM posts ORDER BY id')
        .all(),
    ).toEqual(before);
    expect(
      decrypt(
        (restored.prepare('SELECT access_token FROM accounts').get() as any)
          .access_token,
      ),
    ).toBe('synthetic-restore-token');
    expect(
      (restored.prepare('SELECT count(*) n FROM post_ownership').get() as any)
        .n,
    ).toBe(0);
  } finally {
    restored?.close();
    original.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
