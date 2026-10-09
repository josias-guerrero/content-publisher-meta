import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open } from "node:fs/promises";
import { AppError } from "../lib/errors.js";
const execute = promisify(execFile);
export type Probe = {
  width: number;
  height: number;
  duration: number;
  videoCodec: string;
  audioCodec?: string;
  frameRate: number;
  bitrate: number;
  audioChannels?: number;
  sampleRate?: number;
};
export function parseProbe(data: any, image: boolean): Probe {
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.filter(
    (s: any) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  const audio = streams.filter((s: any) => s.codec_type === "audio");
  if (
    video.length !== 1 ||
    audio.length > 1 ||
    streams.some((s: any) => !["video", "audio"].includes(s.codec_type))
  )
    throw new AppError(
      400,
      "MEDIA_STREAMS_INVALID",
      "One visual stream and at most one audio stream required",
    );
  const v = video[0],
    rotation = Number(
      v.tags?.rotate ??
        v.side_data_list?.find((s: any) => s.rotation !== undefined)
          ?.rotation ??
        0,
    );
  // Explicit orientation avoids guessing how Meta will interpret display transforms.
  if (rotation % 360 !== 0)
    throw new AppError(
      400,
      "MEDIA_ROTATION_UNSUPPORTED",
      "Normalize orientation before uploading",
    );
  const [n, d] = String(v.avg_frame_rate || "0/1")
    .split("/")
    .map(Number);
  const result = {
    width: Number(v.width),
    height: Number(v.height),
    duration: image ? 0 : Number(v.duration ?? data.format?.duration),
    videoCodec: String(v.codec_name),
    audioCodec: audio[0]?.codec_name,
    frameRate: d ? n / d : 0,
    bitrate: Number(v.bit_rate ?? data.format?.bit_rate ?? 0),
    audioChannels: audio[0] ? Number(audio[0].channels) : undefined,
    sampleRate: audio[0] ? Number(audio[0].sample_rate) : undefined,
  };
  if (
    !Number.isInteger(result.width) ||
    !Number.isInteger(result.height) ||
    result.width < 1 ||
    result.height < 1 ||
    result.width > 8192 ||
    result.height > 8192 ||
    !Number.isFinite(result.duration) ||
    (!image && result.duration <= 0)
  )
    throw new AppError(
      400,
      "MEDIA_METADATA_INVALID",
      "Invalid dimensions or duration",
    );
  if (image && audio.length)
    throw new AppError(
      400,
      "MEDIA_STREAMS_INVALID",
      "Images cannot contain audio",
    );
  return result;
}
export async function probeFile(file: string, mime: string): Promise<Probe> {
  const fd = await open(file, "r");
  const bytes = Buffer.alloc(16);
  try {
    await fd.read(bytes, 0, 16, 0);
  } finally {
    await fd.close();
  }
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const mov = bytes.subarray(4, 8).toString() === "ftyp";
  if (!(
    (mime === "image/jpeg" && jpeg) ||
    (mime === "image/png" && png) ||
    (["video/mp4", "video/quicktime"].includes(mime) && mov)
  ))
    throw new AppError(
      400,
      "MEDIA_MIME_MISMATCH",
      "File contents do not match the declared MIME type",
    );
  try {
    const { stdout } = await execute(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-f",
        jpeg ? "jpeg_pipe" : png ? "png_pipe" : "mov",
        ...(mov ? ["-enable_drefs", "0", "-use_absolute_path", "0"] : []),
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        file,
      ],
      { timeout: 15000, maxBuffer: 512 * 1024, windowsHide: true },
    );
    return parseProbe(JSON.parse(stdout), jpeg || png);
  } catch (e: any) {
    if (e instanceof AppError) throw e;
    if (e.code === "ENOENT")
      throw new AppError(
        503,
        "MEDIA_PROBE_UNAVAILABLE",
        "ffprobe must be installed",
        true,
      );
    throw new AppError(
      400,
      "MEDIA_DECODE_FAILED",
      "Media could not be inspected within resource limits",
    );
  }
}
