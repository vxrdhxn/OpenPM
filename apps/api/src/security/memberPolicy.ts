import { ROLE_RANKS } from '../plugins/auth';

export { ROLES } from '../wire';

const rank = (role: string) => ROLE_RANKS[role] ?? 0;

/** Admins and owners can manage the organization; every organization must keep at least one. */
export const isManager = (role: string) => rank(role) >= rank('admin');

export type Denial = 'self' | 'outranked' | 'role_too_high';

/**
 * Whether `actor` may change `target`'s role to `newRole` (or remove them, when `newRole` is
 * omitted). The rules:
 * - Not on yourself: use leave instead (so nobody demotes or removes themselves by accident).
 * - You must outrank the target. Owners may also manage other owners.
 * - You cannot hand out a role above your own.
 *
 * Who may call at all (admin or higher) is enforced by the route. Keeping at least one manager is
 * checked separately, under a lock, because it depends on the other members.
 */
export function checkMemberChange(
  actor: { id: string; role: string },
  target: { id: string; role: string },
  newRole?: string
): Denial | null {
  if (actor.id === target.id) return 'self';

  const actorIsOwner = actor.role === 'owner';
  if (!(rank(actor.role) > rank(target.role) || (actorIsOwner && target.role === 'owner'))) {
    return 'outranked';
  }

  if (newRole !== undefined && rank(newRole) > rank(actor.role)) return 'role_too_high';

  return null;
}

export const DENIAL_MESSAGES: Record<Denial, string> = {
  self: 'You cannot change your own membership here. To leave the organization, use Leave.',
  outranked: 'You can only manage members with a lower role than yours.',
  role_too_high: 'You cannot give a role higher than your own.',
};
