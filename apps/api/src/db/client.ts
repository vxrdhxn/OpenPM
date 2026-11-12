import { Pool } from 'pg';
import client from 'prom-client';
import { config } from '../config';
import { logger } from '../logger';
import { dbQueryDurationSeconds } from '../metrics';

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
  logger.error({ err }, 'Unexpected error on idle pg client');
  process.exit(-1);
});

// Pool saturation, read at scrape time so it is always current. "waiting" > 0 means requests are
// queueing for a connection, the first sign the pool (max 20) is too small or queries are slow.
new client.Gauge({
  name: 'db_pool_connections',
  help: 'Database pool connections by state (total, idle, waiting)',
  labelNames: ['state'],
  collect() {
    this.set({ state: 'total' }, pool.totalCount);
    this.set({ state: 'idle' }, pool.idleCount);
    this.set({ state: 'waiting' }, pool.waitingCount);
  },
});

export const db = {
  async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const stopTimer = dbQueryDurationSeconds.startTimer();
    try {
      const start = Date.now();
      const res = await pool.query(text, params);
      if (config.NODE_ENV === 'development') {
        logger.debug({ text, duration: Date.now() - start, rows: res.rowCount }, 'Executed query');
      }
      stopTimer({ outcome: 'ok' });
      return res.rows as T[];
    } catch (err) {
      stopTimer({ outcome: 'error' });
      throw err;
    }
  },
  
  // For transactions
  async getClient() {
    return await pool.connect();
  }
};
