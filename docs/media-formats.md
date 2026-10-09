# Media formats and bounded inspection

The publisher downloads each asset into a private temporary file, pins a validated public DNS address, rejects redirects/private destinations, bounds bytes/time, checks magic bytes against MIME and runs local-only ffprobe. It records dimensions, duration, video/audio codecs, frame rate, bitrate and SHA-256. Originals and reel covers are checked again before remote mutation; changed content fails with MEDIA_CHANGED. The controlled serving host must keep URLs immutable until Meta finishes fetching. Download validation cannot prevent an operator overwriting the file after inspection.

One inspection runs per process; concurrent requests receive retryable MEDIA_INSPECTION_BUSY and must reuse their intent key. Downloads have a 60-second bound, DNS 10 seconds and ffprobe 15 seconds. Carrusels are inspected sequentially to bound temporary disk use. A response must have accurate Content-Length and uncompressed JPEG/PNG/MP4/QuickTime bytes. ffprobe is installed in the runtime Docker image.


| Product | VERIFIED_FORMATS value | Local constraints | Publication flow |
|---|---|---|---|
| Instagram photo | instagram.photo | one JPEG <=8 MB | container, status, publish |
| Instagram carousel | instagram.carousel | 2–10 ordered images/videos | child containers, parent, publish |
| Instagram reel | instagram.reel | one MP4/QuickTime | REELS; optional JPEG cover or thumb offset |
| Instagram story image | instagram.story_image | one JPEG, BUSINESS account | STORIES |
| Instagram story video | instagram.story_video | one video, BUSINESS account | STORIES |
| Facebook photo | facebook.photo | one image | photos; persist post_id |
| Facebook multiple photos | facebook.carousel | 2–10 images only | unpublished photos, ordered feed |
| Facebook video | facebook.video | one video | videos, async status reconciliation |
| Facebook reel | facebook.reel | one video | video_reels start/upload/finish/status |
| Facebook story image | facebook.story_image | one image | unpublished photo, photo_stories |
| Facebook story video | facebook.story_video | one video | video_stories start/upload/finish/status |

The service's conservative limits are implementation limits, not universal Meta maxima: 10 items; MEDIA_MAX_BYTES defaults to 256 MiB (configurable up to 1 GiB); images <=8 MiB and >=320 pixels per side; Instagram feed images 4:5–1.91:1; video H.264/HEVC with optional AAC, 23–60 FPS, dimensions 320–1920 per side, <=25 Mbps, at most two audio channels at 44.1/48 kHz. Video duration is 3–60 seconds for stories, 3–90 for Facebook reels and 3–900 otherwise. Normalize nonzero video rotation before upload. thumbOffset must fall inside the video. Precise version-specific duration, dimensions, aspect ratio, codec, rate and eligibility constraints must be verified with the linked official product documentation and test assets before setting the corresponding VERIFIED_FORMATS value. Music/stickers/location/first-comment native editor features are not implemented. Instagram single video `post` is rejected: the caller must explicitly choose `reels`. Covers/thumbnail offsets are rejected outside Instagram reels; requesting both is an error.

Example photo (use a verified account UUID and Idempotency-Key):

```json
{"accountId":"11111111-1111-4111-8111-111111111111","mediaUrls":["https://media.example.test/photo.jpg"],"caption":"Prueba autorizada","type":"post","scheduledAt":1800000000}
```

Reel: replace type with `reels` and URL with a video; optionally add `thumbOffset:1000`. Carousel: append additional URLs in intended order; keep type post. Story: type story and exactly one URL. Facebook uses the same DTO with a Facebook account and no cover fields. Success is 201 `{id}`; await `published` for final result, not merely container readiness. Disabled formats return 409 FORMAT_NOT_VERIFIED; incompatible arrays return 400 MEDIA_COUNT/FORMAT_INVALID.

Do not mark a format validated based on mocked tests. See [Meta endpoints](meta-endpoints.md) and [evidence checklist](app-review.md).

Inspection reference: [ffprobe](https://ffmpeg.org/ffprobe.html) and [FFmpeg protocol restrictions](https://ffmpeg.org/ffmpeg-protocols.html). These local checks do not certify account eligibility or Meta acceptance.
