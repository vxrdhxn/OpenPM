import type { PoolClient } from 'pg';
import type { TenantScope } from './scope';

export type ActivityEntity = 'project' | 'task';

/**
 * Append to the activity feed (`activity_log`), as the scope's user in the scope's organization.
 * Pass the transaction's client, so the entry commits or rolls back with the change it describes.
 */
export async function logActivity(
  client: Pick<PoolClient, 'query'>,
  scope: TenantScope,
  entityType: ActivityEntity,
  entityId: string,
  action: string,
  metadata: object = {}
): Promise<void> {
  await client.query(
    'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
    [scope.orgId, scope.userId, entityType, entityId, action, JSON.stringify(metadata)]
  );
}
