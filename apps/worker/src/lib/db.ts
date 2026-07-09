import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load env for local dev (ignored in K8s)
dotenv.config({ path: '../../.env' });

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://openpm:openpm@localhost:5432/openpm',
});
