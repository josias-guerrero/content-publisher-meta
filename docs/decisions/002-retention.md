# ADR 002 — No retroactive cleanup without an approved retention policy

Status: intentionally pending operator/legal/product decisions, as required by the implementation plan.

Callback receipt revokes access and cancels pending work. Destructive cleanup is a separate explicit operation requiring signed per-scope Tiko receipts and explicit evidence of backup disposition. No automatic cron purges historical data or deletes remote publications.

`process-deletion` retains minimal terminal IDs, scoped hashes and status tombstones so old intentions do not requeue. These are still potentially personal data. Their purpose, retention and backup handling must be accepted before enabling cleanup. A completed request means the operator attested coordinated scope, not that this repository independently proved external erasure.

Enforcement now uses independent signed journals, written before erasure and replayed before traffic after a database/uploads restore. Local active-file cleanup is implemented and tested; external backup disposition and journal custody remain operator responsibilities.
