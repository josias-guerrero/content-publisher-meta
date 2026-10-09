import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sqlite } from "../../db/index.js";
import { config } from "../../config.js";
import { emit } from "../../jobs/events.js";
import { AppError } from "../../lib/errors.js";
import { equal, signature } from "../../security/context.js";
import { ledger } from "../../security/deletion-ledger.js";
import { stopConnection } from "../connections/connections.routes.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const scopeDigest = (posts: string[]) =>
  hash(JSON.stringify([...new Set(posts)].sort()));
function journal() {
  if (config.DELETION_LEDGER_PATH && config.DELETION_LEDGER_SECRET)
    return ledger(config.DELETION_LEDGER_PATH, config.DELETION_LEDGER_SECRET);
  if (config.NODE_ENV === "production")
    throw new Error("Independent deletion ledger required");
  return undefined;
}
function matched(
  provider: string,
  appId: string,
  userHash: string,
  cutoff: number,
) {
  return (
    sqlite
      .prepare(
        "SELECT * FROM connections WHERE provider=? AND app_id=? AND created_at<=?",
      )
      .all(provider, appId, cutoff) as any[]
  ).filter((c) => hash(`${provider}:${appId}:${c.subject_id}`) === userHash);
}
export function deletionScope(id: string) {
  const request = sqlite
    .prepare("SELECT * FROM deletion_requests WHERE id=?")
    .get(id) as any;
  if (!request)
    throw new AppError(404, "REQUEST_NOT_FOUND", "Deletion request not found");
  const connections = sqlite
    .prepare(
      "SELECT c.* FROM connections c JOIN deletion_targets t ON t.connection_id=c.id WHERE t.request_id=?",
    )
    .all(id) as any[];
  // Also handle requests accepted before migration 6.
  const additional = matched(
    request.provider,
    request.app_id,
    request.user_hash,
    request.cutoff,
  );
  for (const c of additional)
    if (!connections.some((x) => x.id === c.id)) connections.push(c);
  const scopes = sqlite
    .prepare("SELECT * FROM deletion_scopes WHERE request_id=?")
    .all(id) as any[];
  return { request, connections, scopes };
}
function applyRequest(record: any) {
  sqlite.transaction(() => {
    const connections = matched(
      record.provider,
      record.appId,
      record.userHash,
      record.cutoff,
    );
    for (const id of record.connections)
      if (!connections.some((c) => c.id === id)) {
        const c = sqlite
          .prepare("SELECT * FROM connections WHERE id=?")
          .get(id);
        if (c) connections.push(c);
      }
    for (const c of connections) stopConnection(c.id, "revoked");
    if (record.kind === "revoke") return;
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO deletion_requests(id,code,provider,app_id,subject_hash,user_hash,cutoff,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        record.id,
        record.code,
        record.provider,
        record.appId,
        record.requestHash,
        record.userHash,
        record.cutoff,
        record.time,
        record.time,
      );
    for (const c of connections)
      sqlite
        .prepare("INSERT OR IGNORE INTO deletion_targets VALUES(?,?)")
        .run(record.id, c.id);
    for (const s of record.scopes) {
      const inserted = sqlite
        .prepare("INSERT OR IGNORE INTO deletion_scopes VALUES(?,?,?,?)")
        .run(record.id, s.agencyId, s.clientId, JSON.stringify(s.postIds));
      if (inserted.changes) {
        const batchCount = Math.max(1, Math.ceil(s.postIds.length / 500));
        for (let batchIndex = 0; batchIndex < batchCount; batchIndex++)
          emit(
            "deletion.requested",
            { agencyId: s.agencyId, clientId: s.clientId },
            {
              id: record.id,
              status: "pending",
              postIds: s.postIds.slice(
                batchIndex * 500,
                (batchIndex + 1) * 500,
              ),
              scopeDigest: scopeDigest(s.postIds),
              batchIndex,
              batchCount,
            },
          );
      }
    }
  })();
}
export function registerRemoval(
  provider: string,
  appId: string,
  subject: string,
  cutoff: number,
  deletion: boolean,
) {
  replayDeletions();
  const userHash = hash(`${provider}:${appId}:${subject}`),
    requestHash = hash(`${userHash}:${cutoff}`);
  if (deletion) {
    const row = sqlite
      .prepare(
        "SELECT id,code FROM deletion_requests WHERE provider=? AND app_id=? AND subject_hash=?",
      )
      .get(provider, appId, requestHash) as any;
    if (row) return row;
  }
  const connections = matched(provider, appId, userHash, cutoff),
    scopes = new Map<string, any>();
  for (const c of connections) {
    const grants = sqlite
      .prepare("SELECT * FROM grants WHERE connection_id=?")
      .all(c.id) as any[];
    for (const g of grants) {
      const key = JSON.stringify([g.agency_id, g.client_id]),
        scope = scopes.get(key) || {
          agencyId: g.agency_id,
          clientId: g.client_id,
          postIds: [],
        };
      scope.postIds.push(
        ...(
          sqlite
            .prepare("SELECT post_id FROM post_ownership WHERE grant_id=?")
            .all(g.id) as any[]
        ).map((p) => p.post_id),
      );
      scopes.set(key, scope);
    }
  }
  const record = {
    kind: deletion ? "request" : "revoke",
    id: randomUUID(),
    code: randomBytes(32).toString("base64url"),
    provider,
    appId,
    userHash,
    requestHash,
    cutoff,
    time: Math.floor(Date.now() / 1000),
    connections: connections.map((c) => c.id),
    scopes: [...scopes.values()],
  };
  journal()?.append(record); // fsync before acknowledgement or any destructive mutation
  applyRequest(record);
  return { id: record.id, code: record.code };
}
function scrub(id: string, restoring = false) {
  return sqlite.transaction(() => {
    const { connections, scopes } = deletionScope(id);
    for (const c of connections) {
      const grants = sqlite
        .prepare("SELECT * FROM grants WHERE connection_id=?")
        .all(c.id) as any[];
      for (const g of grants) {
        // An old backup may contain a job that was already reconciled before erasure.
        sqlite
          .prepare(
            "UPDATE posts SET caption=NULL,media_urls='[]',media_metadata=NULL,cover_metadata=NULL,cover_url=NULL,thumb_offset=NULL,container_id=NULL,remote_id=NULL,permalink=NULL,error_message=NULL,meta_error=NULL,error_code='DATA_DELETED',status=CASE WHEN status IN ('pending','publishing','reconciling') THEN 'cancelled' ELSE status END WHERE id IN (SELECT post_id FROM post_ownership WHERE grant_id=?)",
          )
          .run(g.id);
        sqlite
          .prepare("UPDATE grants SET token='',capabilities='{}' WHERE id=?")
          .run(g.id);
        const others = sqlite
          .prepare(
            "SELECT 1 FROM grants WHERE account_id=? AND connection_id NOT IN (SELECT connection_id FROM deletion_targets WHERE request_id=?)",
          )
          .get(g.account_id, id);
        if (!others)
          sqlite
            .prepare(
              "UPDATE accounts SET external_id='deleted:'||id,name=NULL,access_token='',token_expires_at=0 WHERE id=?",
            )
            .run(g.account_id);
      }
      sqlite
        .prepare(
          "UPDATE connections SET token='',subject_id='',scopes='[]',status='revoked',updated_at=? WHERE id=?",
        )
        .run(Math.floor(Date.now() / 1000), c.id);
      sqlite
        .prepare(
          "UPDATE oauth_sessions SET assets=NULL,selected=NULL,session_hash='',browser_hash=NULL WHERE connection_id=?",
        )
        .run(c.id);
    }
    // Historical deliveries can contain a permalink to erased content.
    for (const s of scopes) {
      const ids = new Set(JSON.parse(s.post_ids));
      for (const event of sqlite
        .prepare(
          "SELECT id,payload FROM outbox WHERE event_type='publication.updated'",
        )
        .all() as any[]) {
        const body = JSON.parse(event.payload);
        if (ids.has(body.resource?.id))
          sqlite.prepare("DELETE FROM outbox WHERE id=?").run(event.id);
      }
      if (!restoring)
        emit(
          "deletion.completed",
          { agencyId: s.agency_id, clientId: s.client_id },
          { id, status: "completed" },
        );
    }
    sqlite
      .prepare(
        "UPDATE deletion_requests SET status='completed',updated_at=? WHERE id=?",
      )
      .run(Math.floor(Date.now() / 1000), id);
    return { id, status: "completed" };
  })();
}
export function processDeletion(
  id: string,
  receipts: { body: string; signature: string }[],
  backupEvidence: string,
) {
  const { request, connections, scopes } = deletionScope(id);
  if (request.status === "completed") return { id, status: "completed" };
  if (!backupEvidence?.trim() || !Array.isArray(receipts))
    throw new AppError(
      409,
      "RETENTION_APPROVAL_REQUIRED",
      "Signed Tiko receipts and publisher backup disposition evidence are required",
    );
  if (connections.length && !scopes.length)
    throw new AppError(
      409,
      "LEGACY_DELETION_SCOPE",
      "Reconstruct and approve the legacy deletion scope before erasure",
    );
  for (const s of scopes) {
    const valid = receipts.some((receipt) => {
      if (
        !config.EVENT_SIGNING_SECRET ||
        !equal(
          signature(receipt.body, config.EVENT_SIGNING_SECRET),
          receipt.signature,
        )
      )
        return false;
      const r = JSON.parse(receipt.body);
      return (
        r.kind === "tiko.deletion.completed" &&
        r.requestId === id &&
        r.agencyId === s.agency_id &&
        r.clientId === s.client_id &&
        r.scopeDigest === scopeDigest(JSON.parse(s.post_ids)) &&
        typeof r.backupEvidence === "string" &&
        r.backupEvidence.trim()
      );
    });
    if (!valid)
      throw new AppError(
        409,
        "TIKO_RECEIPT_REQUIRED",
        "A signed cleanup receipt is required for every affected agency and client",
      );
  }
  for (const c of connections)
    if (
      sqlite
        .prepare(
          "SELECT 1 FROM posts p JOIN post_ownership o ON o.post_id=p.id JOIN grants g ON g.id=o.grant_id WHERE g.connection_id=? AND p.status IN ('publishing','reconciling')",
        )
        .get(c.id)
    )
      throw new AppError(
        409,
        "PUBLICATION_IN_FLIGHT",
        "Resolve in-flight publications before cleanup",
      );
  journal()?.append({
    kind: "completed",
    id,
    backupEvidence,
    receiptHashes: receipts.map((r) => hash(r.body)),
    time: Math.floor(Date.now() / 1000),
  });
  return scrub(id);
}
export function replayDeletions() {
  for (const record of journal()?.read() || []) {
    if (record.kind === "request" || record.kind === "revoke")
      applyRequest(record);
    else if (record.kind === "completed") scrub(record.id, true);
    else throw new Error("Unknown deletion ledger entry");
  }
}
