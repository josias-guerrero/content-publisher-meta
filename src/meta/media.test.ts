import { afterEach, it, expect, vi } from "vitest";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { lookup } from "node:dns/promises";
import { inspectMedia, validateFormat } from "./media.js";
import { probeFile } from "./media-probe.js";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("./media-probe.js", async (original) => ({
  ...(await original<any>()),
  probeFile: vi.fn(async () => ({
    width: 1080,
    height: 1920,
    duration: 5,
    videoCodec: "h264",
    frameRate: 30,
    bitrate: 100000,
  })),
}));
afterEach(() => vi.restoreAllMocks());
function download(status = 200, length = 4) {
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ] as any);
  return vi.spyOn(https, "request").mockImplementation(((
    url: any,
    opts: any,
    cb: any,
  ) => {
    expect(url.hostname).toBe("media.example.test");
    expect(opts.method).toBe("GET");
    const pinned = vi.fn();
    opts.lookup(url.hostname, { all: true }, pinned);
    expect(pinned).toHaveBeenCalledWith(null, [
      { address: "8.8.8.8", family: 4 },
    ]);
    const req = new EventEmitter() as any;
    req.end = () =>
      queueMicrotask(() => {
        const response = Readable.from([Buffer.from("test")]) as any;
        response.statusCode = status;
        response.headers = {
          "content-type": "video/mp4",
          "content-length": String(length),
        };
        cb(response);
      });
    return req;
  }) as any);
}
it("pins DNS, bounds download, hashes bytes and probes a local file", async () => {
  download();
  const m = await inspectMedia("https://media.example.test/no-extension");
  expect(m).toMatchObject({ size: 4, videoCodec: "h264", width: 1080 });
  expect(m.sha256).toHaveLength(64);
  expect(probeFile).toHaveBeenCalled();
});
it("rejects redirects without following them", async () => {
  const request = download(302);
  await expect(
    inspectMedia("https://media.example.test/video"),
  ).rejects.toMatchObject({ code: "MEDIA_INVALID" });
  expect(request).toHaveBeenCalledTimes(1);
});
it("rejects a response exceeding its declared size", async () => {
  download(200, 3);
  await expect(
    inspectMedia("https://media.example.test/video"),
  ).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });
});
it("rejects private DNS before opening a socket", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "127.0.0.1", family: 4 },
  ] as any);
  const request = vi.spyOn(https, "request");
  await expect(
    inspectMedia("https://media.example.test/video"),
  ).rejects.toMatchObject({ code: "MEDIA_URL_INVALID" });
  expect(request).not.toHaveBeenCalled();
});
it("enforces duration, codec, aspect ratio and thumbnail position", () => {
  const video = {
    url: "https://media.example.test/video",
    mimeType: "video/mp4",
    size: 100,
    width: 1080,
    height: 1920,
    duration: 5,
    videoCodec: "h264",
    frameRate: 30,
    bitrate: 1000,
    sha256: "test",
  };
  expect(validateFormat("instagram", "reels", [video], {})).toBe(
    "instagram.reel",
  );
  for (const delta of [
    { duration: 901 },
    { videoCodec: "vp9" },
    { frameRate: 120 },
    { width: 4096 },
  ])
    expect(() =>
      validateFormat("instagram", "reels", [{ ...video, ...delta }], {}),
    ).toThrow();
  expect(() =>
    validateFormat("instagram", "reels", [video], {}, undefined, 5000),
  ).toThrow();
  expect(() =>
    validateFormat(
      "instagram",
      "post",
      [{ ...video, mimeType: "image/jpeg", videoCodec: "mjpeg", duration: 0 }],
      {},
    ),
  ).toThrow();
});
