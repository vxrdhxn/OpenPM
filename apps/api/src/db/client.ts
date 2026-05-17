import { Pool } from 'pg';
import { config } from '../config';

// WHY max 20 connections:
// PostgreSQL has a default max_connections of 100.
// With 5 API pods each holding 20 connections = 100 total.
// PgBouncer (Stage 2) will pool these further.
// Setting a limit prevents connection exhaustion under load.
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle pg client', err);
  process.exit(-1);
});

export const db = {
  async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (config.NODE_ENV === 'development') {
      console.log('Executed query', { text, duration, rows: res.rowCount });
    }
    return res.rows as T[];
  },
  
  // For transactions
  async getClient() {
    return await pool.connect();
  }
};
