# Testing

`npm test`: Vitest, isolated SQLite in memory and temporary restore files, synthetic keys/tokens, no `.env` loading. Covers API authentication and tenancy, OAuth cookie/state replay, explicit asset selection, idempotency, cancellation, worker claims/recovery, platform format flows, callbacks, migration preservation, token lifecycle, SSRF address checks and outbox retry. Graph calls and remote media GET are mocked where a test would otherwise contact external services. Synthetic JPEG/H.264 files are generated and inspected with real local FFmpeg/ffprobe. Crypto tests include versioned/legacy decryption and key rotation.

`npm run typecheck`: production TypeScript and operational scripts. `node --test lib/publisher-review.test.js` in Tiko exercises membership denial, signed/deduplicated events, public privacy and expired media links. `node --check server.js` and extracted UI JavaScript syntax check cover parsing only, not a browser journey.

A real probe is separate: `tsx scripts/meta-evidence.ts --diagnostic ACCOUNT_ID` uses a preconfigured signed context from environment and records non-secret response metadata. It does not publish. A publish test requires `--publish PAYLOAD_FILE`, TEST_PUBLISH_ACK=I_AUTHORIZE_A_TEST_PUBLICATION and a designated test asset. It submits one intent, then the operator observes actual Meta content and captures evidence. Never run publish mode by default in CI.

Staging acceptance still required: actual Meta consent/partial consent, callback products, accounts on later pages, expiry and revocation, all formats/limits/covers, scheduled execution with real expiring media, response lost after remote success, process kill during upload, cross-agency UI/proxy access, Tiko offline outbox recovery and coordinated deletion/restore. Record actual app/permission/version/time/trace/resource data separately from test output. Browser and production restore acceptance have not been performed by these unit suites.

## Verification recorded for this change

- Publisher: 65 tests passed across 13 files.
- Production code and operational scripts: both TypeScript checks passed.
- Tiko: 12 module tests passed when executed directly with Node, covering publisher integration, protected media/share cookies, byte ranges, erasure receipts and restore replay; server and extracted browser JavaScript passed syntax checks.
- Synthetic SQLite WAL backup restored successfully with preserved IDs, six job states, relationships and token decryption. This is not a production restore certification.
- OpenAPI local references, actual registered routes and request example checked; local documentation links and git whitespace checks passed.
- Both repositories use `feat/meta-app-review` branches. No deployment or real Meta publication was performed.

Remaining acceptance requires actual test asset IDs and verified legacy agency/client mappings, as well as an approved retention policy. Those values cannot be inferred safely from names or existing global accounts.

Follow [guia-pruebas.md](guia-pruebas.md) for the ordered staging walkthrough, prerequisites, commands and expected results. `npm run fixtures:media -- NEW_DIRECTORY` creates synthetic upload assets. `npm run check:staging` is read-only and requires explicit staging configuration; it does not publish or certify external infrastructure.

Deployment preparation adds four Node tests in `ops/runtime.test.cjs` for fresh/resumable bootstrap, missing-journal failure, SQLite/media backup and damaged-backup detection. `npm test` runs those after Vitest. Docker image builds require an available Docker daemon.
