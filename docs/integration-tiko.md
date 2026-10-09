# Tiko integration contract v1

This is a breaking security transition: deploy publisher and Tiko together after backup and ownership mapping. Old anonymous `/auth/*/login` calls and API-key-only proxy requests no longer suffice. Old DTO fields/envelopes remain (`accounts`, `posts`); callers must now provide verified context and idempotency.

## Request authentication

Tiko derives `{agencyId,clientId,userId,sessionId,role,expiresAt}` from server-side memberships and session. `sessionId` is a hash of the session token; role is `user` or `admin`. `expiresAt` is at most 300 seconds in the future. JSON-encode then base64url-encode the payload. Send `X-Publisher-Context: payload.signature`, where signature is base64url HMAC-SHA256 over `METHOD + '\n' + exactPathAndQuery + '\n' + payload`, using CONTEXT_SIGNING_SECRET. Also send X-API-Key. Never expose these headers or secrets to browser JS. HTTPS is required between production services. Context is short-lived; it is not a browser identity credential.

The service is trusted to attest media ownership. Publisher independently restricts media hosts and validates transport/MIME/size. Tiko only resolves stored media IDs from the authorized client. `Idempotency-Key` is scoped to agency plus operation; hash includes client and normalized request fields. Keep it for the same intention after a lost response. Changing payload with the same key returns 409. Intent records currently have no automatic expiry; agree retention before cleanup.

## OAuth

POST `/auth/sessions` with `{ "platform":"instagram" }` → 201 `{id,authorizationUrl,expiresAt}`. Open that URL once. Browser gets HttpOnly/SameSite cookie tied to the attempt; Meta receives random state. Callback validates state and cookie before exchange. Backend polls GET `/auth/sessions/:id` → pending/succeeded/denied/failed/expired. `succeeded` means authorization discovered, not that assets have been selected. GET `/auth/sessions/:id/assets` returns safe asset metadata; POST `/auth/sessions/:id/complete` with `{assetIds:["external-id"]}` associates selected assets. Same selection is idempotent; different selection conflicts. No arbitrary return URLs or postMessage channel are used.

## Posts

POST `/posts` takes `{accountId,mediaUrls,caption?,type?,scheduledAt,thumbOffset?,coverUrl?}`. `type` is post/reels/story; omitted means post. `scheduledAt=Math.floor(tikoItem.at/1000)`. `thumbOffset` stays milliseconds. Media array order is preserved. Response 201 `{id}`; query GET `/posts/:id` for `status`, `remote_id`, `remote_kind`, `permalink`, `error_code`, `error_message`, `retryable`.

States: pending, publishing, published, failed, cancelled, reconciling. Never infer failure from a temporary network error or submit a new intent to resolve `reconciling`. DELETE only cancels, never removes Meta content. POST retry accepts only explicitly retryable failed work that never started publication. Lists default 20, maximum 100, offset >=0, ordered by created_at descending then ID. POST /accounts manual tokens is disabled; use OAuth.

Error example: `{"error":{"code":"IDEMPOTENCY_CONFLICT","message":"Key used for a different payload","retryable":false,"requestId":"uuid"}}`. Validation 400, authentication 401, admin role 403, inaccessible resource 404, state/idempotency 409, rate 429, dependency 502/503.

## Events

POST to EVENT_DESTINATION (Tiko `/api/integrations/publisher/events`). Exact UTF-8 JSON body: `{eventId,eventType,schemaVersion:1,occurredAt,agencyId,clientId,resource}`. Signature is base64url HMAC-SHA256(`timestamp + '.' + rawBody`, EVENT_SIGNING_SECRET); headers X-Publisher-Timestamp and X-Publisher-Signature. Tolerance ±300 seconds. Confirm only after persistence. Events: connection.updated, connection.disconnected, deletion.requested, deletion.completed, publication.updated. No secrets. Tiko stores events and fetches authoritative publication state to avoid stale deliveries overwriting new states.

Disconnect requires agency admin and affects every grant backed by that connection. It cancels pending jobs; already-running external mutations may still complete and must be reconciled. A new OAuth authorization is a separate connection; it never reactivates cancelled jobs. To restore scheduling access select the same external asset under the intended client.

Deletion events carry `resource: {id,status,postIds,scopeDigest,batchIndex,batchCount}`. The digest is SHA-256 of JSON encoding of sorted unique post IDs; batches contain at most 500 IDs. The consumer requires all batches and rejects conflicting scopes. Cleanup receipts are exported after journaled local erasure and signed using the shared event secret; see [deletion](data-deletion.md).

Private library access uses Tiko membership/session or temporary client/designer share cookies. `/publisher-media/:token` remains an expiring opaque capability for Meta, supports GET/HEAD and one byte range, and never permits arbitrary directory access.
