import { beforeEach, describe, it, expect, vi } from "vitest";
import { buildApp } from "../../server.js";
import { clear, fixture, headers } from "../../test-helpers.js";
import { sqlite } from "../../db/index.js";
vi.mock("../../meta/media.js", async (original) => {
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

describe("post contract", () => {
  beforeEach(clear);
  it("persists idempotent intent and rejects changed payload", async () => {
    const a = buildApp(),
      f = fixture(),
      payload = {
        accountId: f.account,
        mediaUrls: ["https://media.example.test/a.jpg"],
        scheduledAt: Math.floor(Date.now() / 1000) + 60,
      };
    const h = { ...headers("POST", "/posts"), "idempotency-key": "intent-1" };
    const one = await a.inject({
      method: "POST",
      url: "/posts",
      headers: h,
      payload,
    });
    expect(one.statusCode).toBe(201);
    const two = await a.inject({
      method: "POST",
      url: "/posts",
      headers: h,
      payload,
    });
    expect(two.json()).toEqual(one.json());
    const conflict = await a.inject({
      method: "POST",
      url: "/posts",
      headers: h,
      payload: { ...payload, caption: "changed" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(
      (sqlite.prepare("SELECT count(*) n FROM posts").get() as any).n,
    ).toBe(1);
    await a.close();
  });
  it("denies cross agency/client and atomically cancels", async () => {
    const a = buildApp(),
      f = fixture(),
      payload = {
        accountId: f.account,
        mediaUrls: ["https://media.example.test/a.jpg"],
        scheduledAt: Math.floor(Date.now() / 1000) + 60,
      };
    const made = await a.inject({
      method: "POST",
      url: "/posts",
      headers: { ...headers("POST", "/posts"), "idempotency-key": "intent" },
      payload,
    });
    const path = "/posts/" + made.json().id;
    for (const scope of [{ agencyId: "agency-b" }, { clientId: "client-b" }])
      expect(
        (await a.inject({ url: path, headers: headers("GET", path, scope) }))
          .statusCode,
      ).toBe(404);
    expect(
      (
        await a.inject({
          method: "DELETE",
          url: path,
          headers: headers("DELETE", path),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (sqlite.prepare("SELECT status FROM posts").get() as any).status,
    ).toBe("cancelled");
    sqlite.prepare("UPDATE posts SET status='publishing'").run();
    expect(
      (
        await a.inject({
          method: "DELETE",
          url: path,
          headers: headers("DELETE", path),
        })
      ).statusCode,
    ).toBe(409);
    await a.close();
  });
  it("validates bounded pagination and explicit types", async () => {
    const a = buildApp();
    for (const url of [
      "/posts?limit=101",
      "/posts?offset=-1",
      "/posts?status=nonsense",
    ])
      expect(
        (await a.inject({ url, headers: headers("GET", url) })).statusCode,
      ).toBe(400);
    await a.close();
  });
});
