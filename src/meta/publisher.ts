import { AppError } from "../lib/errors.js";
import { randomUUID } from "node:crypto";
import { sqlite } from "../db/index.js";
import { decrypt } from "../lib/crypto.js";
import * as graph from "./graph-api.js";
import {
  inspectMedia,
  inspectMediaList,
  validateFormat,
  type Media,
} from "./media.js";
import { postEvent } from "../jobs/events.js";
import { stopConnection } from "../modules/connections/connections.routes.js";
const now = () => Math.floor(Date.now() / 1000);
export function recoverLeases() {
  sqlite.transaction(() => {
    const rows = sqlite
      .prepare(
        "SELECT id FROM posts WHERE status='publishing' AND (lease_until IS NULL OR lease_until<?)",
      )
      .all(now()) as any[];
    for (const p of rows) {
      // An interrupted remote mutation is never blindly replayed, including old pre-lease jobs.
      sqlite
        .prepare(
          "UPDATE posts SET status='reconciling',error_code='WORKER_INTERRUPTED',lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='publishing'",
        )
        .run(now(), p.id);
      postEvent(p.id);
    }
  })();
}
export async function publishPost(postId: string): Promise<void> {
  const worker = randomUUID();
  const post = sqlite
    .prepare(
      "UPDATE posts SET status='publishing',lease_owner=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND status='pending' AND scheduled_at<=? RETURNING *",
    )
    .get(worker, now() + 300, now(), postId, now()) as any;
  if (!post) return;
  let remoteMutation = false,
    connectionId: string | undefined;
  const update = (fields: Record<string, any>) => {
    fields.updated_at = now();
    const result = sqlite
      .prepare(
        `UPDATE posts SET ${Object.keys(fields)
          .map((k) => `${k}=?`)
          .join(",")} WHERE id=? AND lease_owner=? AND status='publishing'`,
      )
      .run(...Object.values(fields), postId, worker);
    if (!result.changes) throw new Error("Worker lease lost");
  };
  let g: any;
  const check = () => {
    const valid = sqlite
      .prepare("SELECT c.status,c.expires_at FROM connections c WHERE c.id=?")
      .get(connectionId) as any;
    if (
      !valid ||
      valid.status !== "active" ||
      (valid.expires_at && valid.expires_at <= now())
    )
      throw new Error("Connection unavailable");
    update({ lease_until: now() + 300 });
  };
  const mutation = async <T>(fn: () => Promise<T>) => {
    check();
    remoteMutation = true;
    return fn();
  };
  const finish = (id: string, kind: string) => {
    if (!id) throw new Error("Missing remote publication ID");
    sqlite.transaction(() => {
      update({
        status: "published",
        remote_id: id,
        remote_kind: kind,
        error_code: null,
        error_message: null,
        lease_until: null,
        lease_owner: null,
      });
      postEvent(postId);
    })();
  };
  try {
    g = sqlite
      .prepare(
        "SELECT g.*,c.expires_at,c.status FROM post_ownership o JOIN grants g ON g.id=o.grant_id JOIN connections c ON c.id=g.connection_id WHERE o.post_id=?",
      )
      .get(postId) as any;
    if (!g)
      throw new Error(
        "Legacy ownership requires explicit backfill before publication",
      );
    connectionId = g.connection_id;
    check();
    const account = sqlite
      .prepare("SELECT * FROM accounts WHERE id=?")
      .get(post.account_id) as any;
    const token = decrypt(g.token),
      urls = JSON.parse(post.media_urls) as string[];
    const media: Media[] = await inspectMediaList(urls, check);
    if (post.media_metadata) {
      const scheduled = JSON.parse(post.media_metadata) as Media[];
      if (scheduled.some((m, i) => m.sha256 && m.sha256 !== media[i]?.sha256))
        throw new AppError(
          400,
          "MEDIA_CHANGED",
          "Media changed after scheduling",
        );
    }
    if (post.cover_url) {
      check();
      const cover = await inspectMedia(post.cover_url);
      if (
        post.cover_metadata &&
        JSON.parse(post.cover_metadata).sha256 !== cover.sha256
      )
        throw new AppError(
          400,
          "MEDIA_CHANGED",
          "Cover changed after scheduling",
        );
      if (
        cover.mimeType !== "image/jpeg" ||
        cover.size > 8 * 1024 * 1024 ||
        cover.width < 320 ||
        cover.height < 320
      )
        throw new Error("Invalid reel cover");
    }
    const kind = post.type ?? "post";
    validateFormat(
      account.platform,
      kind,
      media,
      JSON.parse(g.capabilities),
      post.cover_url ?? undefined,
      post.thumb_offset ?? undefined,
    );
    const video = (m: Media) => m.mimeType.startsWith("video/");
    if (account.platform === "instagram") {
      let container = post.container_id;
      if (!container) {
        let children: string[] | undefined;
        if (media.length > 1) {
          children =
            post.remote_kind === "carousel_children" && post.remote_id
              ? JSON.parse(post.remote_id)
              : [];
          for (let i = children!.length; i < media.length; i++) {
            const m = media[i];
            const child = await mutation(() =>
              graph.createMediaContainer(account.external_id, token, {
                imageUrl: video(m) ? undefined : m.url,
                videoUrl: video(m) ? m.url : undefined,
                mediaType: video(m) ? "VIDEO" : undefined,
                isCarouselItem: true,
              }),
            );
            if (!child.containerId)
              throw new Error("Missing child container ID");
            children!.push(child.containerId);
            update({
              remote_kind: "carousel_children",
              remote_id: JSON.stringify(children),
            });
            remoteMutation = false;
          }
          for (const child of children!) {
            const state = await graph.getContainerStatus(child, token);
            if (state.statusCode === "IN_PROGRESS") {
              if (now() - post.scheduled_at > 24 * 3600)
                throw new Error("Carousel processing expired");
              update({
                status: "pending",
                lease_owner: null,
                lease_until: null,
              });
              return;
            }
            if (state.statusCode !== "FINISHED")
              throw new Error("Carousel child processing failed");
          }
        }
        const first = media[0];
        const result = await mutation(() =>
          graph.createMediaContainer(account.external_id, token, {
            imageUrl: children || video(first) ? undefined : first.url,
            videoUrl: children || !video(first) ? undefined : first.url,
            children,
            mediaType: children
              ? "CAROUSEL"
              : kind === "story"
                ? "STORIES"
                : kind === "reels"
                  ? "REELS"
                  : undefined,
            caption: kind === "story" ? undefined : (post.caption ?? undefined),
            thumbOffset: post.thumb_offset ?? undefined,
            coverUrl: post.cover_url ?? undefined,
          }),
        );
        container = result.containerId;
        if (!container) throw new Error("Missing container ID");
        update({ container_id: container });
        remoteMutation = false;
      }
      const state = await graph.getContainerStatus(container, token);
      if (state.statusCode === "IN_PROGRESS") {
        if (now() - post.scheduled_at > 24 * 3600)
          throw new Error("Container processing expired");
        update({ status: "pending", lease_owner: null, lease_until: null });
        return;
      }
      if (state.statusCode !== "FINISHED")
        throw new Error("Container is not publishable");
      update({ publish_started_at: now() });
      const result = await mutation(() =>
        graph.publishContainer(account.external_id, token, container),
      );
      finish(result.postId, "instagram_media");
    } else {
      const send = (edge: string, params: Record<string, string>) =>
        mutation(() =>
          graph.facebookRequest(account.external_id, token, edge, params),
        );
      if (kind === "reels" || (kind === "story" && video(media[0]))) {
        const edge = kind === "reels" ? "video_reels" : "video_stories";
        const start = await send(edge, { upload_phase: "start" });
        update({
          container_id: String(start.video_id),
          remote_kind: "video_upload",
        });
        await mutation(() =>
          graph.uploadFacebookVideo(start.upload_url, token, media[0].url),
        );
        update({ publish_started_at: now() });
        const result = await send(edge, {
          upload_phase: "finish",
          video_id: String(start.video_id),
          ...(kind === "reels"
            ? { video_state: "PUBLISHED", description: post.caption || "" }
            : {}),
        });
        if (result.success !== true)
          throw new Error("Video finish not confirmed");
        // Finish accepts asynchronous processing; status must be reconciled before calling it published.
        update({
          status: "reconciling",
          remote_id: String(start.video_id),
          remote_kind: edge,
          error_code: "REMOTE_PROCESSING",
          lease_owner: null,
          lease_until: null,
        });
      } else if (kind === "story") {
        const photo = await send("photos", {
          url: media[0].url,
          published: "false",
        });
        update({ container_id: photo.id });
        update({ publish_started_at: now() });
        const story = await send("photo_stories", { photo_id: photo.id });
        finish(story.post_id, "facebook_story");
      } else if (media.length > 1) {
        const ids: string[] = [];
        for (const m of media) {
          const photo = await send("photos", {
            url: m.url,
            published: "false",
          });
          ids.push(photo.id);
          update({
            remote_kind: "unpublished_photos",
            remote_id: JSON.stringify(ids),
          });
        }
        update({ publish_started_at: now() });
        const result = await send("feed", {
          message: post.caption || "",
          attached_media: JSON.stringify(ids.map((id) => ({ media_fbid: id }))),
        });
        finish(result.id, "facebook_post");
      } else if (video(media[0])) {
        update({ publish_started_at: now() });
        const result = await send("videos", {
          file_url: media[0].url,
          description: post.caption || "",
        });
        update({
          status: "reconciling",
          remote_id: result.id,
          remote_kind: "facebook_video",
          error_code: "REMOTE_PROCESSING",
          lease_owner: null,
          lease_until: null,
        });
      } else {
        update({ publish_started_at: now() });
        const result = await send("photos", {
          url: media[0].url,
          caption: post.caption || "",
        });
        finish(result.post_id, "facebook_post");
      }
    }
    const published = sqlite
      .prepare("SELECT remote_id FROM posts WHERE id=? AND status='published'")
      .get(postId) as any;
    if (published) {
      try {
        const permalink = await graph.mediaPermalink(
          account.platform,
          published.remote_id,
          token,
        );
        if (permalink)
          sqlite
            .prepare("UPDATE posts SET permalink=? WHERE id=?")
            .run(permalink, postId);
      } catch {
        /* A permalink lookup cannot invalidate a confirmed publication. */
      }
    }
    postEvent(postId);
  } catch (error) {
    const local = error instanceof AppError ? error : undefined;
    const meta = error instanceof graph.MetaApiError ? error : undefined;
    if (connectionId && meta && ["AUTH", "PERMISSION"].includes(meta.type))
      stopConnection(connectionId, "reauth_required");
    const status =
      remoteMutation || post.publish_started_at ? "reconciling" : "failed";
    sqlite.transaction(() => {
      sqlite
        .prepare(
          "UPDATE posts SET status=?,error_code=?,error_message=?,meta_error=?,retryable=?,lease_until=NULL,lease_owner=NULL,updated_at=? WHERE id=? AND lease_owner=? AND status='publishing'",
        )
        .run(
          status,
          meta ? `META_${meta.type}` : local?.code || "PUBLICATION_FAILED",
          meta?.message ||
            local?.message ||
            "Publication could not be completed; operator reconciliation may be required",
          meta
            ? JSON.stringify({
                status: meta.status,
                code: meta.code,
                subcode: meta.subcode,
                traceId: meta.traceId,
                type: meta.type,
                retryable: meta.retryable,
              })
            : null,
          status === "failed" && (meta?.retryable || local?.retryable) ? 1 : 0,
          now(),
          postId,
          worker,
        );
      postEvent(postId);
    })();
  }
}
export async function reconcileVideos() {
  const rows = sqlite
    .prepare(
      "SELECT p.*,g.token,c.status connection_status FROM posts p JOIN post_ownership o ON o.post_id=p.id JOIN grants g ON g.id=o.grant_id JOIN connections c ON c.id=g.connection_id WHERE p.status='reconciling' AND p.error_code='REMOTE_PROCESSING' AND c.status='active' LIMIT 20",
    )
    .all() as any[];
  for (const p of rows) {
    try {
      const result = await graph.facebookVideoStatus(
        p.remote_id,
        decrypt(p.token),
      );
      if (result.status?.publishing_phase?.status === "complete")
        sqlite.transaction(() => {
          sqlite
            .prepare(
              "UPDATE posts SET status='published',error_code=NULL,error_message=NULL,updated_at=? WHERE id=? AND status='reconciling'",
            )
            .run(now(), p.id);
          postEvent(p.id);
        })();
    } catch {
      /* Read-only reconciliation retries on the next tick. */
    }
  }
}
