import { mkdtemp, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { probeFile, type Probe } from "./media-probe.js";
import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
export type Media = {
  url: string;
  mimeType: string;
  size: number;
  sha256: string;
} & Probe;
let inspecting = false;
export function publicAddress(ip: string) {
  if (isIP(ip) === 6) {
    const groups = ip.split(":");
    const first = parseInt(groups[0], 16),
      second = parseInt(groups[1] || "0", 16);
    return (
      first >= 0x2000 &&
      first < 0x3fff &&
      first !== 0x2002 &&
      !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8))
    );
  }
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return !(
    [0, 10, 127].includes(a) ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}
export function mediaUrl(value: string) {
  const url = new URL(value);
  const allowed = config.MEDIA_ALLOWED_HOSTS.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !allowed.includes(url.hostname) ||
    isIP(url.hostname)
  )
    throw new AppError(
      400,
      "MEDIA_URL_INVALID",
      "Media must use an approved public HTTPS host",
    );
  return url;
}
/** One bounded temporary download per process; no redirects, no ffprobe network access. */
export async function inspectMedia(value: string): Promise<Media> {
  if (inspecting)
    throw new AppError(
      429,
      "MEDIA_INSPECTION_BUSY",
      "Retry the same intent after the current media inspection",
      true,
    );
  inspecting = true;
  let directory: string | undefined;
  try {
    const url = mediaUrl(value);
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(
          () =>
            reject(
              new AppError(502, "MEDIA_UNAVAILABLE", "Media DNS timeout", true),
            ),
          10000,
        );
      }),
    ]).finally(() => clearTimeout(dnsTimer));
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new AppError(
        400,
        "MEDIA_URL_INVALID",
        "Private media host rejected",
      );
    const address = addresses[0];
    directory = await mkdtemp(join(tmpdir(), "publisher-media-"));
    const file = join(directory, "source.media");
    const hash = createHash("sha256");
    let bytes = 0;
    const mimeType = await new Promise<string>((resolve, reject) => {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 60000);
      const req = https.request(
        url,
        {
          method: "GET",
          signal: controller.signal,
          headers: { "accept-encoding": "identity" },
          lookup: ((_host: any, opts: any, cb: any) =>
            opts.all
              ? cb(null, [address])
              : cb(null, address.address, address.family)) as any,
        },
        (res) => {
          const mime = String(res.headers["content-type"] || "")
              .split(";")[0]
              .toLowerCase(),
            length = Number(res.headers["content-length"]);
          if (
            res.statusCode !== 200 ||
            ![
              "image/jpeg",
              "image/png",
              "video/mp4",
              "video/quicktime",
            ].includes(mime) ||
            !Number.isSafeInteger(length) ||
            length <= 0 ||
            length > config.MEDIA_MAX_BYTES ||
            (res.headers["content-encoding"] &&
              res.headers["content-encoding"] !== "identity")
          ) {
            res.destroy();
            clearTimeout(deadline);
            reject(
              new AppError(
                400,
                "MEDIA_INVALID",
                "Media inaccessible, unsupported, oversized or missing length",
              ),
            );
            return;
          }
          const bounded = new Transform({
            transform(chunk, _encoding, cb) {
              bytes += chunk.length;
              if (bytes > config.MEDIA_MAX_BYTES || bytes > length) {
                cb(
                  new AppError(
                    400,
                    "MEDIA_TOO_LARGE",
                    "Media exceeded declared size",
                  ),
                );
                return;
              }
              hash.update(chunk);
              cb(null, chunk);
            },
          });
          pipeline(
            res,
            bounded,
            createWriteStream(file, { flags: "wx", mode: 0o600 }),
            { signal: controller.signal },
          )
            .then(() => {
              if (bytes !== length)
                throw new AppError(
                  400,
                  "MEDIA_TRUNCATED",
                  "Incomplete media download",
                );
              resolve(mime);
            })
            .catch(reject)
            .finally(() => clearTimeout(deadline));
        },
      );
      req.on("error", () => {
        clearTimeout(deadline);
        reject(
          new AppError(
            502,
            "MEDIA_UNAVAILABLE",
            "Media download failed or exceeded 60 seconds",
            true,
          ),
        );
      });
      req.end();
    });
    const metadata = await probeFile(file, mimeType);
    return {
      url: value,
      mimeType,
      size: (await stat(file)).size,
      sha256: hash.digest("hex"),
      ...metadata,
    };
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      inspecting = false;
    }
  }
}
export async function inspectMediaList(urls: string[], heartbeat?: () => void) {
  const result: Media[] = [];
  for (const url of urls) {
    heartbeat?.();
    result.push(await inspectMedia(url));
  }
  return result;
}
export function formatKey(platform: string, type: string, media: Media[]) {
  return `${platform}.${type === "reels" ? "reel" : type === "story" ? (media[0].mimeType.startsWith("video/") ? "story_video" : "story_image") : media.length > 1 ? "carousel" : media[0].mimeType.startsWith("video/") ? "video" : "photo"}`;
}
export function validateFormat(
  platform: string,
  type: string,
  media: Media[],
  capabilities: any,
  cover?: string,
  thumb?: number,
) {
  if (!media.length || media.length > 10)
    throw new AppError(
      400,
      "MEDIA_COUNT",
      "Between one and ten media required",
    );
  if (type !== "post" && media.length !== 1)
    throw new AppError(
      400,
      "MEDIA_COUNT",
      "Reels and stories require one media",
    );
  if (type === "reels" && !media[0].mimeType.startsWith("video/"))
    throw new AppError(400, "FORMAT_INVALID", "Reels require video");
  if (
    platform === "facebook" &&
    media.length > 1 &&
    media.some((m) => !m.mimeType.startsWith("image/"))
  )
    throw new AppError(
      400,
      "FORMAT_INVALID",
      "Facebook multiple photos require images only",
    );
  if (
    platform === "instagram" &&
    type === "post" &&
    media.length === 1 &&
    media[0].mimeType.startsWith("video/")
  )
    throw new AppError(
      400,
      "FORMAT_UNSUPPORTED",
      "Use reels explicitly for a single Instagram video",
    );
  if (
    platform === "instagram" &&
    type === "story" &&
    capabilities.accountType !== "BUSINESS"
  )
    throw new AppError(
      400,
      "ACCOUNT_INELIGIBLE",
      "Instagram stories require a business account",
    );
  if (
    platform === "instagram" &&
    media.some(
      (m) =>
        m.mimeType.startsWith("image/") &&
        (m.mimeType !== "image/jpeg" || m.size > 8 * 1024 * 1024),
    )
  )
    throw new AppError(
      400,
      "MEDIA_INVALID",
      "Instagram images must be JPEG up to 8 MB",
    );
  if (
    (cover || thumb !== undefined) &&
    (type !== "reels" || platform !== "instagram")
  )
    throw new AppError(
      400,
      "COVER_UNSUPPORTED",
      "Cover and thumbOffset are supported for Instagram reels only",
    );
  if (cover && thumb !== undefined)
    throw new AppError(400, "COVER_CONFLICT", "Choose coverUrl or thumbOffset");
  for (const m of media) {
    if (
      !Number.isInteger(m.width) ||
      !Number.isInteger(m.height) ||
      m.width < 320 ||
      m.height < 320
    )
      throw new AppError(
        400,
        "MEDIA_DIMENSIONS",
        "Minimum dimensions are 320 × 320",
      );
    if (m.mimeType.startsWith("image/")) {
      if (!["mjpeg", "png"].includes(m.videoCodec) || m.size > 8 * 1024 * 1024)
        throw new AppError(
          400,
          "MEDIA_IMAGE_INVALID",
          "Images must be JPEG or PNG up to 8 MB",
        );
      const ratio = m.width / m.height;
      if (
        type === "post" &&
        platform === "instagram" &&
        (ratio < 0.8 || ratio > 1.91)
      )
        throw new AppError(
          400,
          "MEDIA_ASPECT_RATIO",
          "Instagram feed images require aspect ratio 4:5–1.91:1",
        );
    } else {
      if (
        !["h264", "hevc"].includes(m.videoCodec) ||
        (m.audioCodec && m.audioCodec !== "aac")
      )
        throw new AppError(
          400,
          "MEDIA_CODEC",
          "Use H.264/HEVC video and optional AAC audio",
        );
      if (
        !Number.isFinite(m.frameRate) ||
        m.frameRate < 23 ||
        m.frameRate > 60 ||
        m.width > 1920 ||
        m.height > 1920
      )
        throw new AppError(
          400,
          "MEDIA_VIDEO_DIMENSIONS",
          "Video requires 23–60 FPS and dimensions no greater than 1920",
        );
      const maxDuration =
        type === "story"
          ? 60
          : type === "reels" && platform === "facebook"
            ? 90
            : 900;
      if (
        !Number.isFinite(m.duration) ||
        m.duration < 3 ||
        m.duration > maxDuration
      )
        throw new AppError(
          400,
          "MEDIA_DURATION",
          `Video duration must be between 3 and ${maxDuration} seconds`,
        );
      if (
        m.bitrate > 25_000_000 ||
        (m.audioChannels && m.audioChannels > 2) ||
        (m.sampleRate && ![44100, 48000].includes(m.sampleRate))
      )
        throw new AppError(
          400,
          "MEDIA_ENCODING",
          "Unsupported bitrate, audio channels or sample rate",
        );
    }
  }
  if (thumb !== undefined && thumb >= media[0].duration * 1000)
    throw new AppError(
      400,
      "THUMB_OFFSET_INVALID",
      "Thumbnail offset must be inside the video",
    );
  const key = formatKey(platform, type, media);
  if (!config.VERIFIED_FORMATS.split(",").includes(key))
    throw new AppError(
      409,
      "FORMAT_NOT_VERIFIED",
      "Format is awaiting verification on a designated test account",
    );
  return key;
}
export function capabilities(platform: string, info: any) {
  return {
    formats: config.VERIFIED_FORMATS.split(",").filter(
      (x) =>
        x.startsWith(`${platform}.`) &&
        (!x.includes("story") ||
          platform !== "instagram" ||
          info.accountType === "BUSINESS"),
    ),
    maxMedia: 10,
    requiresPublicHttps: true,
    diagnosticPublishes: false,
  };
}
