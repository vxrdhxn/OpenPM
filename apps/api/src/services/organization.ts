import type { FastifyBaseLogger } from 'fastify';
import { withTransaction } from '../db/transaction';
import { deleteStoredObjects } from '../attachments/cleanup';
import { verifyPassword } from '../security/passwords';
import { audit, type RequestOrigin } from '../security/audit';
import { BadRequestError, ForbiddenError, NotFoundError } from '../domain/errors';
import { logActivity } from '../data/activity';
import * as organizations from '../data/organization';
import type { Organization } from '../data/organization';
import type { TenantScope } from '../data/scope';

/** The caller's own organization: its settings, and deleting it. */

const orgNotFound = () => new NotFoundError('Organization not found');

export async function getOrganization(scope: TenantScope): Promise<Organization> {
  const org = await organizations.find(scope);
  if (!org) throw orgNotFound();
  return org;
}

/** Rename (admins). The slug never changes: it was chosen at sign-up and identifies the workspace when deleting it. */
export async function renameOrganization(scope: TenantScope, rawName: string, origin: RequestOrigin): Promise<Organization> {
  const name = rawName.trim();
  return withTransaction(async (client) => {
    const before = await organizations.lock(client, scope);
    const org = await organizations.rename(client, scope, name);
    if (!before || !org) throw orgNotFound();

    if (before.name !== name) {
      const metadata = { from: before.name, to: name };
      await logActivity(client, scope, 'organization', scope.orgId, 'renamed', metadata);
      await audit(client, origin, {
        orgId: scope.orgId, actorId: scope.userId, action: 'organization.renamed', targetType: 'organization', targetId: scope.orgId, metadata,
      });
    }
    return org;
  });
}

/**
 * Delete the organization and everything in it: members, projects, tasks, comments, labels,
 * notifications, invites, activity and attachment files. Owners only, and only with the workspace slug
 * typed out and the owner's password, so it cannot happen by a stray click or from a stolen session
 * alone. There is no undo.
 */
export async function deleteOrganization(
  scope: TenantScope,
  confirmSlug: string,
  password: string,
  log: Pick<FastifyBaseLogger, 'error' | 'warn'>,
  ip: string
): Promise<void> {
  const keys = await withTransaction(async (client) => {
    const org = await organizations.lock(client, scope);
    if (!org) throw orgNotFound();
    if (confirmSlug.trim() !== org.slug) throw new BadRequestError('Type the workspace slug exactly to confirm.');
    if (!(await verifyPassword(password, await organizations.ownPasswordHash(client, scope)))) {
      throw new ForbiddenError('Your password is incorrect.');
    }

    const files = await organizations.allStorageKeys(client, scope);
    await organizations.remove(client, scope);
    return files;
  });

  // After the commit, as for project deletion: a storage failure leaves (logged) orphaned files, never
  // data that points at deleted files.
  await deleteStoredObjects(keys, log);
  // The organization's audit log is deleted with it, so this log line is the only record left.
  log.warn({ event: 'organization_deleted', org_id: scope.orgId, user_id: scope.userId, ip, files: keys.length }, 'Organization deleted');
}
