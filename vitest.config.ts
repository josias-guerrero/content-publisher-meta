import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    env: {
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
      DATABASE_PATH: ":memory:",
      TOKEN_ENCRYPTION_KEY: "a".repeat(64),
      API_KEY: "test-service-key-".repeat(3),
      EVENT_SIGNING_SECRET: "test-event-key-".repeat(3),
      CONTEXT_SIGNING_SECRET: "test-context-key-".repeat(3),
      META_INSTAGRAM_APP_ID: "test-ig-app",
      META_INSTAGRAM_APP_SECRET: "test-ig-secret",
      META_FACEBOOK_APP_ID: "test-fb-app",
      META_FACEBOOK_APP_SECRET: "test-fb-secret",
      PUBLIC_BASE_URL: "https://publisher.example.test",
      MEDIA_ALLOWED_HOSTS: "media.example.test",
      VERIFIED_FORMATS:
        "instagram.photo,instagram.carousel,instagram.reel,instagram.story_image,instagram.story_video,facebook.photo,facebook.carousel,facebook.video,facebook.reel,facebook.story_image,facebook.story_video",
      WORKERS_ENABLED: "false",
    },
  },
});
