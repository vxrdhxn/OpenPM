import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env if present (useful for local dev, in prod K8s handles it)
dotenv.config({ path: '../../.env' });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().regex(/^\d+$/).default('3000'),
  DATABASE_URL: z.string().url().default('postgresql://openpm:openpm@localhost:5432/openpm'),
  REDIS_URL: z.string().url().default('redis://:openpm@localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long').default('super_secret_development_key_change_me_in_prod_123'),
  CORS_ORIGIN: z.string().url().default('http://localhost:3001'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Attachment storage: any S3-compatible service (AWS S3, MinIO, ...).
  // Deliberately no defaults for credentials: if these are unset, attachments are disabled
  // (the routes return 503) instead of silently using well-known dev credentials.
  S3_ENDPOINT: z.string().url().optional(), // internal endpoint used by the API (omit for AWS S3)
  S3_PUBLIC_ENDPOINT: z.string().url().optional(), // endpoint browsers use for presigned URLs; defaults to S3_ENDPOINT
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(3).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'), // true for MinIO
  ATTACHMENT_MAX_BYTES: z.string().regex(/^\d+$/).default('10485760').transform(Number), // 10 MiB
});

// .env.example ships these optional settings blank (`S3_BUCKET=`), and a blank value is "unset",
// not an invalid URL/size. Other variables keep strict semantics: a blank JWT_SECRET must still fail.
const BLANK_MEANS_UNSET = new Set([
  'LOG_LEVEL',
  'S3_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
  'ATTACHMENT_MAX_BYTES',
]);

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key, value]) => !(value === '' && BLANK_MEANS_UNSET.has(key)))
);

const parsed = envSchema.safeParse(env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
