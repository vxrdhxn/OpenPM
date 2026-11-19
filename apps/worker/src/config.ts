import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env if present (local development; Compose and Kubernetes set the environment directly).
dotenv.config({ path: '../../.env' });

const port = (fallback: string) =>
  z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .default(fallback)
    .transform(Number)
    .refine((n) => n >= 1 && n <= 65535, 'must be a port between 1 and 65535');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().url().default('postgresql://openpm:openpm@localhost:5432/openpm'),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    // Jobs processed at once by this process (docs/jobs.md).
    WORKER_CONCURRENCY: z
      .string()
      .regex(/^[1-9]\d*$/, 'WORKER_CONCURRENCY must be a positive whole number')
      .default('5')
      .transform(Number),
    METRICS_PORT: port('9100'),
    // Base URL of the frontend, for links in emails (invites, password resets).
    APP_URL: z.string().trim().url().optional(),
    // Unset: emails are logged instead of sent (development), or skipped with a warning (production).
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM_ADDRESS: z.string().email().default('notifications@openpm.local'),
  })
  // Emailing a localhost link in production would look sent but be useless, so refuse to start.
  .refine((env) => env.NODE_ENV !== 'production' || env.APP_URL, {
    path: ['APP_URL'],
    message: 'APP_URL is required when NODE_ENV=production',
  })
  .transform((env) => ({
    ...env,
    APP_URL: (env.APP_URL ?? 'http://localhost:3001').replace(/\/+$/, ''),
  }));

export type WorkerConfig = z.output<typeof envSchema>;

// .env.example ships these blank (`RESEND_API_KEY=`), and blank means "unset", not invalid.
const BLANK_MEANS_UNSET = new Set([
  'LOG_LEVEL',
  'WORKER_CONCURRENCY',
  'METRICS_PORT',
  'APP_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM_ADDRESS',
]);

/** Validates the worker's environment; returns the problems per variable instead of throwing. */
export function parseConfig(
  source: NodeJS.ProcessEnv
): { ok: true; config: WorkerConfig } | { ok: false; errors: Record<string, string[] | undefined> } {
  const env = Object.fromEntries(
    Object.entries(source).filter(([key, value]) => !(value === '' && BLANK_MEANS_UNSET.has(key)))
  );
  const parsed = envSchema.safeParse(env);
  return parsed.success
    ? { ok: true, config: parsed.data }
    : { ok: false, errors: z.flattenError(parsed.error).fieldErrors };
}

const result = parseConfig(process.env);

if (!result.ok) {
  console.error('❌ Invalid environment variables:', result.errors);
  process.exit(1);
}

export const config = result.config;
