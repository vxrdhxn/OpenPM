import { Pool } from 'pg';
import client from 'prom-client';
import { config } from '../config';
import { logger } from '../logger';
import { dbConnectionErrorsTotal, dbQueryDurationSeconds } from '../metrics';

// WHY max 20 connections:
// PostgreSQL has a default max_connections of 100.
// With 5 API pods each holding 20 connections = 100 total.
// PgBouncer (Stage 2) will pool these further.
// Setting a limit prevents connection exhaustion under load.
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  // Long enough that a busy pod rarely has to reconnect (each new connection needs a DNS lookup on
  // the libuv thread pool, which bcrypt also uses; see security/passwords.ts).
  idleTimeoutMillis: 120_000,
  connectionTimeoutMillis: 2000,
  // Postgres cancels any statement still running after 10s, so one slow query cannot hold a pool
  // connection (and the request waiting on it) indefinitely. Migrations use their own pool.
  statement_timeout: 10_000,
});

// An idle connection broke (Postgres restarted, failed over, or the network dropped). pg-pool has
// already discarded it and opens a new one on demand, so this is logged and counted, not fatal.
// It used to call process.exit(): the Phase 9 failure test showed a 20-second Postgres restart
// then also killed the API, with every in-flight request and WebSocket (docs/load-testing.md).
pool.on('error', (err) => {
  dbConnectionErrorsTotal.inc();
  logger.warn({ err }, 'Idle database connection failed; the pool will reconnect');
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

/** Close every pool connection (on shutdown, after the HTTP server has stopped). */
export async function closeDb(): Promise<void> {
  await pool.end();
}
