import type { PoolClient } from 'pg';
import { db } from '../db/client';
import { userSeesProjectSql } from '../security/projectAccess';
import type { TenantScope } from './scope';

/** project_members: who is explicitly in a project. Every statement is scoped to `scope.orgId`. */

export interface ProjectPerson {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Added to the project explicitly (rather than seeing it as an admin or because it is a workspace project). */
  member: boolean;
}

/** Everyone who can see the project (who can be assigned or mentioned). */
export async function listPeople(scope: TenantScope, projectId: string): Promise<ProjectPerson[]> {
  return db.query<ProjectPerson>(
    `SELECT u.id, u.name, u.email, u.role,
            EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = u.id) AS member
       FROM projects p
       JOIN users u ON u.org_id = p.org_id AND u.deactivated_at IS NULL
      WHERE p.id = $1 AND p.org_id = $2 AND ${userSeesProjectSql('p', 'u.id', 'u.role')}
      ORDER BY lower(u.name), u.id`,
    [projectId, scope.orgId]
  );
}

/** Add a user to the project; false if they already were a member. */
export async function add(client: PoolClient, scope: TenantScope, projectId: string, userId: string): Promise<boolean> {
  const res = await client.query(
    `INSERT INTO project_members (project_id, user_id, org_id, added_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, user_id) DO NOTHING RETURNING user_id`,
    [projectId, userId, scope.orgId, scope.userId]
  );
  return res.rows.length > 0;
}

/** Remove a user from the project; returns their name, or null if they were not a member. */
export async function remove(client: PoolClient, scope: TenantScope, projectId: string, userId: string): Promise<string | null> {
  const res = await client.query<{ name: string }>(
    `DELETE FROM project_members m USING users u
      WHERE m.project_id = $1 AND m.user_id = $2 AND m.org_id = $3 AND u.id = m.user_id
      RETURNING u.name`,
    [projectId, userId, scope.orgId]
  );
  return res.rows[0]?.name ?? null;
}
