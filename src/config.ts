import { dirname, resolve } from "node:path";
import { z } from "zod";
import dotenv from "dotenv";

if (process.env.NODE_ENV !== "test") dotenv.config({ quiet: true });

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    CONTEXT_SIGNING_SECRET: z.string().min(32).optional(),
    EVENT_SIGNING_SECRET: z.string().min(32).optional(),
    EVENT_DESTINATION: z.string().url().optional(),
    DELETION_LEDGER_PATH: z.string().min(1).optional(),
    DELETION_LEDGER_SECRET: z.string().min(32).optional(),
    TRUST_PROXY: z.string().default(""),
    WORKERS_ENABLED: z.enum(["true", "false"]).default("false"),
    VERIFIED_FORMATS: z.string().default(""),
    MEDIA_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(1073741824)
      .default(268435456),
    MEDIA_ALLOWED_HOSTS: z.string().default(""),
    META_HTTP_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(15000),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().default(3000),
    API_KEY: z.string().optional(),
    DATABASE_PATH: z.string().default("./data/publisher.db"),
    TOKEN_ENCRYPTION_KEY_ID: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,32}$/)
      .default("v1"),
    TOKEN_PREVIOUS_KEYS: z
      .string()
      .default("{}")
      .refine((value) => {
        try {
          const keys = JSON.parse(value);
          return (
            keys &&
            typeof keys === "object" &&
            !Array.isArray(keys) &&
            Object.entries(keys).every(
              ([id, key]) =>
                /^[a-zA-Z0-9_-]{1,32}$/.test(id) &&
                typeof key === "string" &&
                /^[a-fA-F0-9]{64}$/.test(key),
            )
          );
        } catch {
          return false;
        }
      }, "Expected key ID to hex key mapping"),
    TOKEN_ENCRYPTION_KEY: z
      .string()
      .regex(
        /^[a-fA-F0-9]{64}$/,
        "TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters",
      ),
    META_INSTAGRAM_APP_ID: z.string().min(1),
    META_INSTAGRAM_APP_SECRET: z.string().min(1),
    META_FACEBOOK_APP_ID: z.string().optional(),
    META_FACEBOOK_APP_SECRET: z.string().optional(),
    META_GRAPH_API_VERSION: z
      .string()
      .regex(/^v[0-9]+\.0$/)
      .default("v21.0"),
    PUBLIC_BASE_URL: z
      .string()
      .url()
      .default("http://localhost:3000")
      .transform((value) => value.replace(/\/+$/, "")),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      for (const key of [
        "API_KEY",
        "CONTEXT_SIGNING_SECRET",
        "EVENT_SIGNING_SECRET",
        "DELETION_LEDGER_SECRET",
      ] as const) {
        if (!env[key] || env[key]!.length < 32)
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Required in production: at least 32 characters",
          });
      }
      if (
        env.DELETION_LEDGER_PATH &&
        dirname(resolve(env.DELETION_LEDGER_PATH)) ===
          dirname(resolve(env.DATABASE_PATH))
      )
        ctx.addIssue({
          code: "custom",
          path: ["DELETION_LEDGER_PATH"],
          message:
            "Use a recovery location separate from the database directory",
        });
      if (!env.DELETION_LEDGER_PATH)
        ctx.addIssue({
          code: "custom",
          path: ["DELETION_LEDGER_PATH"],
          message: "Independent deletion ledger required",
        });
      if (!env.PUBLIC_BASE_URL.startsWith("https://"))
        ctx.addIssue({
          code: "custom",
          path: ["PUBLIC_BASE_URL"],
          message: "HTTPS required",
        });
    }
    const url = new URL(env.PUBLIC_BASE_URL);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      ctx.addIssue({
        code: "custom",
        path: ["PUBLIC_BASE_URL"],
        message:
          "Must be an origin without credentials, path, query or fragment",
      });
    if (
      env.EVENT_DESTINATION &&
      (!env.EVENT_SIGNING_SECRET ||
        !env.EVENT_DESTINATION.startsWith("https://"))
    )
      ctx.addIssue({
        code: "custom",
        path: ["EVENT_DESTINATION"],
        message: "HTTPS and EVENT_SIGNING_SECRET required",
      });
  });

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("❌ Invalid environment variables:");
  console.error(_env.error.format());
  process.exit(1);
}

export const config = _env.data;
