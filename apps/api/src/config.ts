import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env if present (useful for local dev, in prod K8s handles it)
dotenv.config({ path: '../../.env' });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().regex(/^\d+$/).default('3000'),
  DATABASE_URL: z.string().url().default('postgresql://openpm:openpm@localhost:5432/openpm'),
  // Migrations only: the database owner. When set, DATABASE_URL is the app's unprivileged user, which
  // `migrate up` creates and grants (db/appRole.ts). Unset: everything connects with DATABASE_URL.
  DATABASE_MIGRATION_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().default('redis://:openpm@localhost:6379'),
  // Optional here so development works out of the box; production is enforced by getJwtSecret().
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long').optional(),
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
  // Reverse proxies in front of the API whose X-Forwarded-For to believe, so rate limits and logs see
  // the real client address: a hop count ("1" behind one Ingress) or comma-separated IPs/CIDRs.
  // Unset = the API is reached directly (Compose) and the header is ignored, so clients cannot fake it.
  TRUST_PROXY: z.string().regex(/^(\d+|[0-9a-fA-F.:/]+(\s*,\s*[0-9a-fA-F.:/]+)*)$/, 'TRUST_PROXY must be a hop count or a list of IPs/CIDRs').optional(),
  // Load tests only: IPs/CIDRs exempt from rate limiting (security/rateLimitAllowlist.ts). Never in production.
  RATE_LIMIT_ALLOWLIST: z.string().optional(),
  // How long the security audit log keeps entries (docs/audit-log.md). They hold IP addresses, so
  // they are not kept forever.
  AUDIT_RETENTION_DAYS: z.string().regex(/^[1-9]\d*$/, 'AUDIT_RETENTION_DAYS must be a positive whole number').default('365').transform(Number),
});

const DEV_JWT_SECRET = 'super_secret_development_key_change_me_in_prod_123';

// Secrets that are (or were) published in this repository as examples or defaults. Anyone can sign
// tokens with them, so production refuses them as if no secret were set.
const PUBLISHED_JWT_SECRETS = new Set([
  DEV_JWT_SECRET, // .env.example
  'some_super_secret_jwt_key_that_is_long_enough', // docker-compose.yml before v0.1.0
  'change_me_to_something_super_secret_and_long_enough_32_chars', // Helm values.yaml before v0.1.0
]);

// .env.example ships these optional settings blank (`S3_BUCKET=`), and a blank value is "unset",
// not an invalid URL/size. Other variables keep strict semantics: a blank JWT_SECRET must still fail.
const BLANK_MEANS_UNSET = new Set([
  'LOG_LEVEL',
  'DATABASE_MIGRATION_URL',
  'S3_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
  'ATTACHMENT_MAX_BYTES',
  'RATE_LIMIT_ALLOWLIST',
  'TRUST_PROXY',
  'AUDIT_RETENTION_DAYS',
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

/**
 * Fastify's trustProxy option from TRUST_PROXY: false when unset, a list of trusted proxy addresses,
 * or, for a hop count n, trust the n nearest hops (what Fastify does for a number; its types omit it).
 */
export function trustProxySetting(
  value: string | undefined = config.TRUST_PROXY
): false | string[] | ((address: string, hop: number) => boolean) {
  if (!value) return false;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return (_address, hop) => hop < hops;
  }
  return value.split(',').map((s) => s.trim());
}

/**
 * The secret used to sign tokens. Outside production a development key is used so the app runs out
 * of the box; in production a missing secret stops the API instead of silently signing tokens with
 * a key that is published in this repository. (Checked here, not at config load, so tools that only
 * need the database, such as migrations, do not need a signing secret.)
 */
export function getJwtSecret(): string {
  if (config.NODE_ENV === 'production') {
    if (!config.JWT_SECRET) throw new Error('JWT_SECRET is required when NODE_ENV=production');
    if (PUBLISHED_JWT_SECRETS.has(config.JWT_SECRET)) {
      throw new Error('JWT_SECRET is an example value published in the OpenPM repository; generate one with `openssl rand -hex 32`');
    }
  }
  return config.JWT_SECRET ?? DEV_JWT_SECRET;
}
