import { beforeEach, describe, it, expect, vi } from "vitest";
import { clear, fixture, job, inContext } from "../test-helpers.js";
import { sqlite } from "../db/index.js";
import { publishPost, recoverLeases } from "./publisher.js";
import * as graph from "./graph-api.js";
import { inspectMediaList } from "./media.js";
import { AppError } from "../lib/errors.js";
import { cancelPost } from "../modules/posts/posts.service.js";
vi.mock("./media.js", async (original) => {
  const media = (url: string) => ({
    url,
    mimeType: url.includes("video") ? "video/mp4" : "image/jpeg",
    size: 1000,
    width: 1080,
    height: 1080,
    duration: url.includes("video") ? 5 : 0,
    frameRate: 30,
    videoCodec: url.includes("video") ? "h264" : "mjpeg",
    bitrate: 10000,
    sha256: "fixture",
  });
  return {
    ...(await original<any>()),
    inspectMedia: vi.fn(async (url: string) => media(url)),
    inspectMediaList: vi.fn(async (urls: string[]) => urls.map(media)),
  };
});

vi.mock("./graph-api.js", async (original) => ({
  ...(await original<any>()),
  createMediaContainer: vi.fn(),
  getContainerStatus: vi.fn(),
  publishContainer: vi.fn(),
  facebookRequest: vi.fn(),
  uploadFacebookVideo: vi.fn(),
  mediaPermalink: vi.fn(),
}));
describe("durable worker", () => {
  beforeEach(() => {
    clear();
    vi.clearAllMocks();
    vi.mocked(graph.createMediaContainer).mockResolvedValue({
      containerId: "container",
    });
    vi.mocked(graph.getContainerStatus).mockResolvedValue({
      statusCode: "FINISHED",
    });
    vi.mocked(graph.publishContainer).mockResolvedValue({ postId: "remote" });
  });
  it("only one concurrent worker publishes and persists the final ID", async () => {
    const id = job(fixture());
    await Promise.all([publishPost(id), publishPost(id)]);
    expect(graph.publishContainer).toHaveBeenCalledTimes(1);
    expect(
      sqlite.prepare("SELECT status,remote_id FROM posts WHERE id=?").get(id),
    ).toEqual({ status: "published", remote_id: "remote" });
  });
  it("rejects media and cover changes before any remote mutation", async () => {
    for (const cover of [false, true]) {
      const id = job(
        fixture(),
        cover ? ["https://media.example.test/video.mp4"] : undefined,
        cover ? "reels" : "post",
      );
      if (cover)
        sqlite
          .prepare("UPDATE posts SET cover_url=?,cover_metadata=? WHERE id=?")
          .run(
            "https://media.example.test/cover.jpg",
            JSON.stringify({ sha256: "old" }),
            id,
          );
      else
        sqlite
          .prepare("UPDATE posts SET media_metadata=? WHERE id=?")
          .run(JSON.stringify([{ sha256: "old" }]), id);
      await publishPost(id);
      expect(
        sqlite
          .prepare("SELECT status,error_code,retryable FROM posts WHERE id=?")
          .get(id),
      ).toEqual({
        status: "failed",
        error_code: "MEDIA_CHANGED",
        retryable: 0,
      });
    }
    expect(graph.createMediaContainer).not.toHaveBeenCalled();
  });
  it("keeps pre-mutation inspection contention safely retryable", async () => {
    const id = job(fixture());
    vi.mocked(inspectMediaList).mockRejectedValueOnce(
      new AppError(429, "MEDIA_INSPECTION_BUSY", "Busy", true),
    );
    await publishPost(id);
    expect(
      sqlite
        .prepare("SELECT status,error_code,retryable FROM posts WHERE id=?")
        .get(id),
    ).toEqual({
      status: "failed",
      error_code: "MEDIA_INSPECTION_BUSY",
      retryable: 1,
    });
    expect(graph.createMediaContainer).not.toHaveBeenCalled();
  });
  it("never publishes cancelled work", async () => {
    const id = job(fixture());
    await inContext(() => cancelPost(id));
    await publishPost(id);
    expect(graph.publishContainer).not.toHaveBeenCalled();
  });
  it("quarantines uncertain timeout and expired lease instead of republishing", async () => {
    const id = job(fixture());
    vi.mocked(graph.publishContainer).mockRejectedValue(
      new graph.MetaApiError(
        0,
        "NETWORK",
        "Timeout",
        503,
        undefined,
        undefined,
        true,
      ),
    );
    await publishPost(id);
    expect(
      (sqlite.prepare("SELECT status FROM posts WHERE id=?").get(id) as any)
        .status,
    ).toBe("reconciling");
    await publishPost(id);
    expect(graph.publishContainer).toHaveBeenCalledTimes(1);
    sqlite
      .prepare("UPDATE posts SET status='publishing',lease_until=0 WHERE id=?")
      .run(id);
    recoverLeases();
    expect(
      (sqlite.prepare("SELECT status FROM posts WHERE id=?").get(id) as any)
        .status,
    ).toBe("reconciling");
  });
  it.each([
    ["post", "a.jpg", undefined],
    ["reels", "video.mp4", "REELS"],
    ["story", "a.jpg", "STORIES"],
    ["story", "video.mp4", "STORIES"],
  ])("Instagram %s %s preserves the format", async (type, file, mediaType) => {
    const id = job(fixture(), ["https://media.example.test/" + file], type);
    await publishPost(id);
    expect(graph.createMediaContainer).toHaveBeenCalledWith(
      "external-1",
      "fake-token",
      expect.objectContaining({ mediaType }),
    );
    expect(
      (sqlite.prepare("SELECT status FROM posts WHERE id=?").get(id) as any)
        .status,
    ).toBe("published");
  });
  it("creates ordered Instagram children and parent", async () => {
    let i = 0;
    vi.mocked(graph.createMediaContainer).mockImplementation(async () => ({
      containerId: "c" + ++i,
    }));
    const id = job(fixture(), [
      "https://media.example.test/a.jpg",
      "https://media.example.test/b.jpg",
    ]);
    await publishPost(id);
    expect(graph.createMediaContainer).toHaveBeenLastCalledWith(
      "external-1",
      "fake-token",
      expect.objectContaining({
        mediaType: "CAROUSEL",
        children: ["c1", "c2"],
      }),
    );
  });
  it.each([
    ["post", ["a.jpg"]],
    ["post", ["a.jpg", "b.jpg"]],
    ["post", ["video.mp4"]],
    ["reels", ["video.mp4"]],
    ["story", ["a.jpg"]],
    ["story", ["video.mp4"]],
  ])("Facebook %s %s uses its dedicated flow", async (type, files) => {
    vi.mocked(graph.facebookRequest).mockImplementation(
      async (_id, _token, edge, params) =>
        edge === "photos"
          ? { id: "photo", post_id: "post" }
          : edge === "feed"
            ? { id: "feed" }
            : edge === "photo_stories"
              ? { post_id: "story" }
              : params.upload_phase === "start"
                ? {
                    video_id: "video",
                    upload_url: "https://rupload.facebook.com/video",
                  }
                : params.upload_phase === "finish"
                  ? { success: true }
                  : { id: "video" },
    );
    const id = job(
      fixture("facebook"),
      files.map((f) => "https://media.example.test/" + f),
      type,
    );
    await publishPost(id);
    const status = (
      sqlite.prepare("SELECT status FROM posts WHERE id=?").get(id) as any
    ).status;
    expect(status).toBe(
      files[0].includes("video") ? "reconciling" : "published",
    );
    if (type === "reels")
      expect(graph.facebookRequest).toHaveBeenCalledWith(
        "external-1",
        "fake-token",
        "video_reels",
        expect.anything(),
      );
    if (type === "story")
      expect(graph.facebookRequest).toHaveBeenCalledWith(
        "external-1",
        "fake-token",
        files[0].includes("video") ? "video_stories" : "photo_stories",
        expect.anything(),
      );
  });
});
