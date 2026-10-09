import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeFile, parseProbe } from "./media-probe.js";
it("inspects actual synthetic JPEG and H.264 files, rejects a disguised text file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "media-probe-test-"));
  try {
    const image = join(dir, "photo.jpg"),
      video = join(dir, "clip.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x320",
      "-frames:v",
      "1",
      image,
    ]);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x320:r=30",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
    expect(await probeFile(image, "image/jpeg")).toMatchObject({
      width: 320,
      height: 320,
      videoCodec: "mjpeg",
    });
    expect(await probeFile(video, "video/mp4")).toMatchObject({
      duration: 3,
      videoCodec: "h264",
      frameRate: 30,
    });
    writeFileSync(join(dir, "fake.jpg"), "not an image");
    await expect(
      probeFile(join(dir, "fake.jpg"), "image/jpeg"),
    ).rejects.toMatchObject({ code: "MEDIA_MIME_MISMATCH" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("rejects missing metadata and non-normalized video orientation", () => {
  expect(() => parseProbe({ streams: [] }, false)).toThrow();
  expect(() =>
    parseProbe(
      {
        streams: [
          {
            codec_type: "video",
            width: 1080,
            height: 1920,
            duration: "5",
            tags: { rotate: "90" },
          },
        ],
      },
      false,
    ),
  ).toThrow();
});
