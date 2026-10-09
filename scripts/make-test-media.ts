import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
const run = promisify(execFile),
  directory = process.argv[2];
if (!directory)
  throw new Error("Usage: tsx scripts/make-test-media.ts NEW_EMPTY_DIRECTORY");
const target = resolve(directory);
await mkdir(target, { recursive: false, mode: 0o700 });
for (const [name, color] of [
  ["photo-a.jpg", "blue"],
  ["photo-b.jpg", "orange"],
])
  await run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=1080x1080`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      join(target, name!),
    ],
    { timeout: 30000 },
  );
await run(
  "ffmpeg",
  [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=720x1280:r=30",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    "5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-threads",
    "1",
    join(target, "reel-5s.mp4"),
  ],
  { timeout: 60000 },
);
console.log(
  `Synthetic media created in ${target}. Upload only to the designated staging client; this script does not contact Meta.`,
);
