import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import * as schema from './schema.js';
import { dedupeAccounts } from './dedupe.js';

// Init SQLite DB with Write-Ahead Logging (WAL) for better concurrency
const sqlite = new Database(config.DATABASE_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

dedupeAccounts(sqlite);

export const db = drizzle(sqlite, { schema });
