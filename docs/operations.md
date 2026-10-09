# Operations and configuration

All variables below are runtime-only; none require build availability. Never include `.env`, DBs, tokens or backup files in image contexts. Coolify secrets previously available during build must be changed by the operator after confirming app-specific needs. No live infrastructure setting was changed in this implementation.

| Variable | Required/default | Secret | Purpose / fictional example / rotation |
|---|---|---|---|
| NODE_ENV | development; production in Docker | no | production enables strict validation |
| HOST / PORT | 127.0.0.1 / 3000 | no | bind 0.0.0.0 in container |
| DATABASE_PATH | ./data/publisher.db | no | persistent SQLite location |
| API_KEY | all private requests; production >=32 chars | yes | service credential; coordinated Tiko rotation |
| CONTEXT_SIGNING_SECRET | signed routes; production >=32 | yes | context HMAC; rotate both services in maintenance |
| TOKEN_ENCRYPTION_KEY | 64 hex | yes | AES key; use protected runtime secret, never example live material |
| TOKEN_ENCRYPTION_KEY_ID | v1 | no | encryption key version; see rotation runbook |
| TOKEN_PREVIOUS_KEYS | {} | yes | old version/hex-key map, including legacy when rotating old ciphertext |
| PUBLIC_BASE_URL | http://localhost:3000; HTTPS production | no | canonical origin, e.g. https://publisher.example.test |
| TRUST_PROXY | empty | no | explicit Coolify proxy IP/CIDRs; never indiscriminate trust |
| META_INSTAGRAM_APP_ID / SECRET | required | ID public / secret private | intended Instagram app; secret rotation in panel/runtime |
| META_FACEBOOK_APP_ID / SECRET | optional until Facebook used | ID public / secret private | intended Facebook app; same rotation discipline |
| META_GRAPH_API_VERSION | v21.0 | no | verify support before changing; staged contract tests |
| META_HTTP_TIMEOUT_MS | 15000, range 1000–60000 | no | per HTTP call |
| MEDIA_MAX_BYTES | 268435456 (256 MiB), hard max 1 GiB | no | bounded temporary download before ffprobe |
| DELETION_LEDGER_PATH / SECRET | required in production; secret >=32 | path no / secret yes | independent persistent deletion journal and HMAC key; never roll it back with SQLite |
| STAGING_ONLY | false | no | true only in isolated staging for the read-only preflight script |
| MEDIA_ALLOWED_HOSTS | empty | no | exact controlled hostnames, e.g. media.example.test |
| VERIFIED_FORMATS | empty | no | comma-separated keys from media-formats.md, only after live evidence |
| WORKERS_ENABLED | false | no | true only after backfill/staging gates |
| EVENT_DESTINATION | optional HTTPS | no | e.g. https://tiko.example.test/api/integrations/publisher/events |
| EVENT_SIGNING_SECRET | required in production or with destination, >=32 | yes | event HMAC, shared with Tiko |
| LOG_LEVEL | info | no | pino severity; no secret-bearing query/headers/bodies |

Publisher production location from the plan: https://publisher.tikocloud.com, port 3000, /app/data persistent volume. Tiko: https://tikocloud.com, port 3005, independent data/uploads volumes. Actual region, backup destination and restoration history are not certified. Avoid sharing production volumes with previews.

GET /health is public liveness. GET /ready checks schema version and requires service/context headers. GET /metrics is protected and returns aggregate queue states and pending outbox count. Request IDs are generated internally, returned in X-Request-Id/errors. Logger strips request query, headers and bodies. SIGTERM stops schedules, closes listener and drains the current scheduler tick before closing SQLite; configure container grace time above job HTTP bounds.

Backup using SQLite backup API while live, or checkpoint and copy consistently after stopping all writers. Test restore into an isolated directory with workers off, compare counts/IDs/relationships, decrypt only in memory, and check integrity/foreign keys. Preserve AES versions separately. Upload copies and deletion tombstones must be included in a coherent recovery plan. A successful in-memory migration test is not a production restore test.

Deploy from a review branch only. Both main branches auto-deploy; this work does not push, merge or deploy. Smoke-test health, authenticated scope isolation, pending queue and event receipt before enabling workers. Alert on reconciling jobs, expired leases, reauth_required connections, sustained outbox backlog and rate limiting. Investigate uncertain IDs in Meta before any explicit retry. No arbitrary post reset endpoint is exposed.

Before any recovery, retain current independent erasure journals and keys; startup replays them before accepting traffic. Missing/corrupt journals prevent startup. Initialize them only for genuinely new installations. See [deletion and restore](data-deletion.md) and the [Spanish staging guide](guia-pruebas.md).
