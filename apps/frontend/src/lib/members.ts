/**
 * Who may manage whom, mirrored from the API (apps/api/src/security/memberPolicy.ts) so the UI only
 * offers actions that will be allowed. This is a convenience, not the security boundary: the API
 * enforces the same rules and is the authority.
 */
import { ROLES, type Role } from '@openpm/wire';
export { ROLES, type Role };

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: string;
}

const RANK: Record<string, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };
const rank = (role: string) => RANK[role] ?? 0;

export const isManager = (role: string) => rank(role) >= RANK.admin!;

/** Whether `actor` can change `target`'s role or remove them. */
export function canManage(actor: { id: string; role: string }, target: { id: string; role: string }): boolean {
  if (actor.id === target.id || !isManager(actor.role)) return false;
  return rank(actor.role) > rank(target.role) || (actor.role === 'owner' && target.role === 'owner');
}

/** Roles `actor` may hand out (never above their own). */
export function assignableRoles(actorRole: string): Role[] {
  return ROLES.filter((r) => rank(r) <= rank(actorRole));
}

/** Leaving is refused for the last admin/owner; the UI says why up front. */
export function isLastManager(me: { id: string; role: string }, members: Member[]): boolean {
  return isManager(me.role) && !members.some((m) => m.id !== me.id && isManager(m.role));
}

/** Every organization keeps an owner: the last one must transfer ownership before leaving. */
export function isLastOwner(me: { id: string; role: string }, members: Member[]): boolean {
  return me.role === 'owner' && !members.some((m) => m.id !== me.id && m.role === 'owner');
}

/** Only an owner can hand ownership to someone else (they become an admin). */
export function canTransferOwnership(actor: { id: string; role: string }, target: { id: string; role: string }): boolean {
  return actor.role === 'owner' && actor.id !== target.id && target.role !== 'owner';
}

/** Why Leave is unavailable, or null when it is allowed. */
export function leaveBlockedReason(me: { id: string; role: string }, members: Member[]): string | null {
  if (isLastOwner(me, members)) return 'Transfer ownership to another member before leaving';
  if (isLastManager(me, members)) return 'Make another member an admin before leaving';
  return null;
}
