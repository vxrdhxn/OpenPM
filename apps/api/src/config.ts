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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
