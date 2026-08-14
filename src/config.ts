import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().default(3000),
  API_KEY: z.string().optional(),
  DATABASE_PATH: z.string().default('./data/publisher.db'),
  TOKEN_ENCRYPTION_KEY: z.string().length(64, 'TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)'),
  META_INSTAGRAM_APP_ID: z.string().min(1),
  META_INSTAGRAM_APP_SECRET: z.string().min(1),
  META_FACEBOOK_APP_ID: z.string().optional(),
  META_FACEBOOK_APP_SECRET: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().default('v21.0'),
  PUBLIC_BASE_URL: z.string().optional(),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:');
  console.error(_env.error.format());
  process.exit(1);
}

export const config = _env.data;
