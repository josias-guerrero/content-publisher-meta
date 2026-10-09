# Changelog

## Unreleased — scoped Meta publisher and Tiko contract

Breaking security transition: API-key-only clients and anonymous login starts are rejected. Tiko must sign agency/client/user/session context and keep Idempotency-Key across scheduling retries. Manual account tokens and destructive account deletion routes are disabled. Lists retain envelopes but are scoped and bounded. Cancellation uses cancelled; ambiguous remote results use reconciling.

Additive schema v5 adds connections/grants/OAuth sessions, ownership/idempotency, outbox/deletion requests/audit, worker leases, remote results and sanitized error metadata. No startup dedupe or schema push. Explicit migration/backfill and coordinated Tiko deployment are mandatory. Existing IDs/history stay intact; unmapped jobs remain stored and are excluded from new processing until operator assignment. Workers and unverified formats default off.

OAuth uses one-use state plus browser/session binding and explicit page selection. Tokens use versioned AES with legacy reading and rotation tooling. Platform-specific publishing flows preserve multiple files and distinguish uploads/processing from published content. Signed callbacks register revocation/deletion; cleanup remains retention-gated and never deletes Meta content.

See docs/implementation-status.md for remaining live, privacy and operations acceptance gates. No production deployment or Meta approval is implied.

### Test readiness continuation

Migration 6 records exact deletion scope/cutoff and inspected reel covers. Media inspection now verifies actual local bytes with ffprobe, bounds temporary downloads, and detects changed content. Tiko protects legacy uploads while preserving scoped client/designer links. Coordinated erasure uses reviewable manifests, signed receipts and independent journals replayed before serving after restore. Added isolated restore/media/access tests, synthetic fixtures, staging preflight and a Spanish end-to-end test guide. External backup disposition, live Meta evidence and production promotion remain operator acceptance gates.

### Manual Coolify setup preparation

Added explicit fresh-install bootstrap with recovery guards, paired private staging env generation, consistent SQLite/media backup commands, independent journal replicas, backup verification and explicit Tiko membership CLI. Docker images include sqlite3 and runtime entrypoints. S3 transfers and schedules remain Coolify configuration; active media stays on persistent local storage.
