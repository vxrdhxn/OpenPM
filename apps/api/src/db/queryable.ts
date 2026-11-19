/**
 * The part of pg's PoolClient (and Pool) that standalone SQL helpers need: migrations, the app role
 * and the audit log. Taking this instead of PoolClient lets them run inside any transaction and lets
 * tests pass a fake.
 */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}
