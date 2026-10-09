import { randomUUID, createHash } from "node:crypto";
import { sqlite } from "../../db/index.js";
import type { CreatePostInput } from "./posts.schema.js";
import { context } from "../../security/context.js";
import { activeGrant, postAccess } from "../../security/access.js";
import {
  inspectMedia,
  inspectMediaList,
  validateFormat,
} from "../../meta/media.js";
import { AppError } from "../../lib/errors.js";
import { postEvent } from "../../jobs/events.js";
const now = () => Math.floor(Date.now() / 1000);
const dto = (p: any) => {
  if (!p) return null;
  const {
    lease_owner,
    lease_until,
    media_metadata,
    cover_metadata,
    meta_error,
    ...rest
  } = p;
  return {
    ...rest,
    media_urls: JSON.parse(p.media_urls),
    retryable: !!p.retryable,
  };
};
export async function createPost(data: CreatePostInput, key?: string) {
  const c = context();
  if (!key || key.length > 128 || !/^[\w.-]+$/.test(key))
    throw new AppError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key required (1–128 letters, digits, dot, dash or underscore)",
    );
  const normalized = { ...data, type: data.type ?? "post" };
  const payloadHash = createHash("sha256")
    .update(
      JSON.stringify([
        c.clientId,
        normalized.accountId,
        normalized.caption ?? null,
        normalized.mediaUrls,
        normalized.type,
        normalized.thumbOffset ?? null,
        normalized.coverUrl ?? null,
        normalized.scheduledAt,
      ]),
    )
    .digest("hex");
  const existing = () => {
    const row = sqlite
      .prepare(
        "SELECT * FROM idempotency WHERE agency_id=? AND operation='create-post' AND key=?",
      )
      .get(c.agencyId, key) as any;
    if (row && row.payload_hash !== payloadHash)
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Key used for a different payload",
      );
    return row;
  };
  const previous = existing();
  if (previous) {
    postAccess(previous.resource_id);
    return { id: previous.resource_id };
  }
  if (data.scheduledAt <= now() || data.scheduledAt > now() + 365 * 86400)
    throw new AppError(
      400,
      "INVALID_SCHEDULE",
      "scheduledAt must be future epoch seconds, at most one year",
    );
  const grant = activeGrant(data.accountId),
    account = sqlite
      .prepare("SELECT * FROM accounts WHERE id=?")
      .get(data.accountId) as any;
  const media = await inspectMediaList(data.mediaUrls);
  let cover: Awaited<ReturnType<typeof inspectMedia>> | undefined;
  if (data.coverUrl) {
    cover = await inspectMedia(data.coverUrl);
    if (
      cover.mimeType !== "image/jpeg" ||
      cover.size > 8 * 1024 * 1024 ||
      cover.width < 320 ||
      cover.height < 320
    )
      throw new AppError(400, "COVER_INVALID", "Cover must be JPEG");
  }
  validateFormat(
    account.platform,
    normalized.type,
    media,
    JSON.parse(grant.capabilities),
    data.coverUrl,
    data.thumbOffset,
  );
  return sqlite.transaction(() => {
    const raced = existing();
    if (raced) return { id: raced.resource_id };
    activeGrant(data.accountId);
    const id = randomUUID(),
      time = now();
    sqlite
      .prepare(
        "INSERT INTO posts(id,account_id,caption,media_urls,media_metadata,cover_metadata,type,thumb_offset,cover_url,scheduled_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        data.accountId,
        data.caption ?? null,
        JSON.stringify(data.mediaUrls),
        JSON.stringify(media),
        cover ? JSON.stringify(cover) : null,
        normalized.type,
        data.thumbOffset ?? null,
        data.coverUrl ?? null,
        data.scheduledAt,
        "pending",
        time,
        time,
      );
    sqlite
      .prepare("INSERT INTO post_ownership VALUES(?,?,?,?)")
      .run(id, c.agencyId, c.clientId, grant.id);
    sqlite
      .prepare("INSERT INTO idempotency VALUES(?,?,?,?,?,?)")
      .run(c.agencyId, "create-post", key, payloadHash, id, time);
    postEvent(id);
    return { id };
  })();
}
export async function listPosts({
  status,
  limit = 20,
  offset = 0,
}: {
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const c = context();
  return sqlite
    .prepare(
      `SELECT p.* FROM posts p JOIN post_ownership o ON p.id=o.post_id WHERE o.agency_id=? AND o.client_id=? ${status ? "AND p.status=?" : ""} ORDER BY p.created_at DESC,p.id LIMIT ? OFFSET ?`,
    )
    .all(
      ...[c.agencyId, c.clientId, ...(status ? [status] : []), limit, offset],
    )
    .map(dto);
}
export async function getPost(id: string) {
  postAccess(id);
  return dto(sqlite.prepare("SELECT * FROM posts WHERE id=?").get(id));
}
export async function cancelPost(id: string) {
  postAccess(id);
  sqlite.transaction(() => {
    const result = sqlite
      .prepare(
        "UPDATE posts SET status='cancelled',updated_at=? WHERE id=? AND status='pending'",
      )
      .run(now(), id);
    if (!result.changes) {
      const p = sqlite
        .prepare("SELECT status FROM posts WHERE id=?")
        .get(id) as any;
      if (p?.status === "cancelled") return;
      throw new AppError(
        409,
        "POST_STATE_CONFLICT",
        "Publication has already started or is terminal",
      );
    }
    postEvent(id);
  })();
}
export async function retryPost(id: string) {
  postAccess(id);
  sqlite.transaction(() => {
    const p = sqlite.prepare("SELECT * FROM posts WHERE id=?").get(id) as any;
    activeGrant(p.account_id);
    const result = sqlite
      .prepare(
        "UPDATE posts SET status='pending',updated_at=?,error_code=NULL,error_message=NULL WHERE id=? AND status='failed' AND retryable=1 AND publish_started_at IS NULL",
      )
      .run(now(), id);
    if (!result.changes)
      throw new AppError(
        409,
        "RETRY_UNSAFE",
        "Only reconciled retryable failures may be retried",
      );
    postEvent(id);
  })();
  return { id };
}
