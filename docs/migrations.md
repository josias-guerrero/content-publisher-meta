# Migration and recovery

Docker no longer performs deduplication or `drizzle-kit push` on startup. Run `npm run db:migrate` as an explicit maintenance step; it opens SQLite, makes a consistent `.pre-v6-<timestamp>.bak` via SQLite backup API, checks backup integrity, and applies an idempotent additive transaction. Versions 5 and 6 are recorded in publisher_migrations. Fresh databases are supported. Duplicate legacy asset rows are not merged or discarded.

New tables: connections, grants, oauth_sessions, post_ownership, idempotency, outbox, deletion_requests, deletion_targets, deletion_scopes, audit. Migration 6 adds exact deletion scope/cutoff tracking and cover_metadata. New post fields: remote_id/kind/permalink, media_metadata, lease_until/owner, attempts, error_code, retryable, publish_started_at. No IDs, statuses, account ciphertext or existing relations are rewritten by migration. No historical jobs are queued. Old cascade declarations may remain in legacy SQLite schema, but application routes no longer delete accounts.

Before rollout:

1. Stop both schedulers and backup both DBs/uploads/config securely; verify isolated restoration. Staging must have independent volumes/credentials and WORKERS_ENABLED=false.
2. Inventory accounts, posts by status, external IDs and every Tiko publisher_post_id. Verify row counts and decrypt sample tokens in isolation without outputting them.
3. Run the additive migration against the copy. Compare exact IDs/relationships/statuses and PRAGMA integrity_check/foreign_key_check.
4. Operator writes an explicit mapping JSON (no tokens) with entries `{accountId,agencyId,clientId,appId,subjectId,postIds,scopes}`. `tsx scripts/backfill.ts mapping.json` verifies current Meta identity read-only. `--apply` adds grants and ownership after successful verification; it never changes job status or infers mappings. Duplicate/already-mapped accounts require manual reconciliation.
5. Populate Tiko publisher_memberships and publisher_links explicitly against those verified assignments. Preserve its original item IDs.
6. Confirm no unmapped pending jobs before enabling workers. The new worker excludes unmapped jobs; it does not cancel them. This means a coordinated pause/backfill is mandatory to avoid delaying scheduled work.
7. Run acceptance tests, promote both binaries, configure verified formats, then enable workers.

Rollback: stop workers, keep the new database and outbox safe, and diagnose. The old binary is unsafe against new statuses and scoped credentials even though columns are additive; do not run it against the migrated database. Restore a tested matching binary/database pair only after reconciling publications made since backup and replaying the current independent deletion journals before accepting traffic. Never blindly requeue old pending rows. Removing compatibility or physically deduplicating assets is a separate reviewed migration.
