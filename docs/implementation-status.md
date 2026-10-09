# Implementation status against the plan

This file records engineering work, not completion of App Review. No production data, remote publications, credentials, Coolify settings or live Meta app permissions were changed. Existing local graph artifacts and the input plan were present before this work and are not deployment artifacts.

| Plan | Implemented in code/docs | Remaining acceptance or scope |
|---|---|---|
| CP01 | strict configuration, explicit public routes, signed context, canonical callbacks, proxy allowlist, sanitized logs, request IDs, timeouts, readiness, aggregate metrics | configure actual proxy CIDRs and runtime-only secrets in Coolify |
| CP02 | additive explicit migration, separate connections/assets/grants, scoped ownership, backfill tool, no startup dedupe/schema push | production inventory, approved assignments and tested restore; new scheduler excludes unmapped work until backfill |
| CP03/04 | random hashed one-use state/ticket, browser/session binding, canonical callbacks, permission checks, cursor paging, explicit idempotent asset selection | actual Meta products/config_id behavior and permission endpoints need live verification |
| CP05 | versioned AES plus legacy support, rotation tool, token types, expiry/revocation states, safe HTTP classification, no indefinite Facebook refresh | operational key custody/rotation rehearsal and provider-specific live expiry tests |
| CP06/07 | scoped DTOs, idempotent create, bounded lists, atomic cancel/claim, leases, uncertain result state, final IDs, read-only async video reconciliation, outbox | uncertain mutations without a final ID require operator reconciliation; no blind retry endpoint; load/kill tests in staging |
| CP08 | signed callbacks with cutoff/replay protection, exact scoped manifests, signed Tiko receipts, resumable originals/derivative cleanup, independent signed journals replayed before startup | approve retention/shared exclusions, attest actual external backup/Drive disposition, and rehearse independent-volume recovery in staging |
| CP09 | separate Instagram and Facebook photo/carousel/video/reel/story adapters; ordered media, real ffprobe duration/dimensions/codecs, bounded downloads, cover/original hashes, MIME/size/SSRF controls | formats default disabled; verify current provider constraints and every format on designated live test assets |
| CP10/12 | isolated tests, scoped API contracts, safe diagnostic and explicit live-test script, permission/evidence matrix | no real calls, reviewer credentials, screencast, panel verification or approval supplied |
| TK01–04 | explicit membership/link tables, signed proxy, OAuth ticket and selection, persistent intent keys, cancellation errors propagated | operator assignments and actual browser E2E with both services |
| TK05–08 | signed persisted event receiver, scoped reconciliation, capability checks, additional states, account connection actions | full staging UX and all formats/remote permalink behavior |
| TK09–12 | public privacy/deletion routes and links, Docker exclusions, expiring publisher media with byte ranges, protected legacy uploads and scoped share cookies, coordinated journaled erasure | approve privacy facts/retention, assign memberships, purge legacy caches, and run browser/restore acceptance |

External acceptance gates cannot be replaced with mocked tests. The implementation must not be promoted or submitted as fully complete until remaining entries are closed. No publication history is requeued by migration; do not enable production workers before explicit ownership assignments and reconciliation.

## Local verification

65 publisher tests and 12 Tiko module tests passed, including actual synthetic-media probing, signed cleanup receipts, restored deletion replay, protected share access and media byte ranges. TypeScript checks include operational scripts. OpenAPI references/routes/example, documentation links, syntax and whitespace checks passed. Work is isolated on `feat/meta-app-review` in both repositories; no deployment was attempted. The remaining gates above still apply.

The next step is the [Spanish staging test guide](guia-pruebas.md). No independent-volume deployment, real provider backup cleanup, complete browser journey or Meta acceptance has been certified by these local tests.
