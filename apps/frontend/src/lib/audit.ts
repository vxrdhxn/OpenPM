/** The security audit log (GET /api/audit; docs/audit-log.md). Admins and owners only. */

export interface AuditEntry {
  id: string;
  action: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  target_type: 'user' | 'invite' | 'organization' | 'project' | null;
  target_id: string | null;
  /** The person, project or invite email it concerned, if known. */
  target_name: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  metadata: Record<string, unknown>;
}

const ROLE_NAMES: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };
const roleName = (value: unknown) => (typeof value === 'string' ? (ROLE_NAMES[value] ?? value) : '');

/** Filter choices for the admin view, grouped as the page shows them. Values are API action names. */
export const AUDIT_FILTERS: { label: string; options: { value: string; label: string }[] }[] = [
  {
    label: 'Sign-in',
    options: [
      { value: 'auth.login', label: 'Signed in' },
      { value: 'auth.login_failed', label: 'Failed sign-in' },
      { value: 'auth.logout', label: 'Signed out' },
      { value: 'auth.password_changed', label: 'Password changed' },
      { value: 'auth.password_reset_requested', label: 'Password reset requested' },
      { value: 'auth.password_reset', label: 'Password reset' },
      { value: 'auth.registered', label: 'Workspace created' },
    ],
  },
  {
    label: 'Members',
    options: [
      { value: 'member.role_changed', label: 'Role changed' },
      { value: 'member.removed', label: 'Member removed' },
      { value: 'member.left', label: 'Member left' },
      { value: 'member.ownership_transferred', label: 'Ownership transferred' },
      { value: 'invite.created', label: 'Invite sent' },
      { value: 'invite.revoked', label: 'Invite revoked' },
      { value: 'invite.accepted', label: 'Invite accepted' },
      { value: 'invite.declined', label: 'Invite declined' },
    ],
  },
  {
    label: 'Workspace and projects',
    options: [
      { value: 'organization.renamed', label: 'Workspace renamed' },
      { value: 'project.visibility_changed', label: 'Project visibility changed' },
      { value: 'project.member_added', label: 'Added to a project' },
      { value: 'project.member_removed', label: 'Removed from a project' },
      { value: 'project.deleted', label: 'Project deleted' },
    ],
  },
];

/**
 * One sentence for an entry, from the point of view of someone reading the log: who did what to
 * whom. `target_name` is filled in by the API from the live row or what the entry recorded.
 */
export function describeAudit(entry: Pick<AuditEntry, 'action' | 'actor_name' | 'target_name' | 'metadata'>): string {
  const who = entry.actor_name ?? 'Someone';
  const target = entry.target_name ?? 'someone';
  const m = entry.metadata ?? {};

  switch (entry.action) {
    case 'auth.registered':
      return `${who} created the workspace`;
    case 'auth.login':
      return `${who} signed in`;
    case 'auth.login_failed':
      return `Failed sign-in to ${target}'s account (wrong password)`;
    case 'auth.logout':
      return `${who} signed out on every device`;
    case 'auth.password_changed':
      return `${who} changed their password`;
    case 'auth.password_reset_requested':
      return `A password reset link was requested for ${target}`;
    case 'auth.password_reset':
      return `${target}'s password was reset with an emailed link`;
    case 'member.role_changed':
      return `${who} changed ${target}'s role from ${roleName(m.from)} to ${roleName(m.to)}`;
    case 'member.removed':
      return `${who} removed ${target} from the workspace`;
    case 'member.left':
      return `${who} left the workspace`;
    case 'member.ownership_transferred':
      return `${who} transferred ownership to ${target}`;
    case 'invite.created':
      return `${who} invited someone as ${roleName(m.role) || 'a member'}`;
    case 'invite.revoked':
      return `${who} revoked an invite`;
    case 'invite.accepted':
      return `${who} accepted an invite as ${roleName(m.role) || 'a member'}`;
    case 'invite.declined':
      return `${target} declined an invite`;
    case 'organization.renamed':
      return `${who} renamed the workspace to “${String(m.to ?? '')}”`;
    case 'project.visibility_changed':
      return m.to === 'private'
        ? `${who} made ${target} private`
        : `${who} opened ${target} to the whole workspace`;
    case 'project.member_added':
      return `${who} added ${String(m.name ?? 'someone')} to ${target}`;
    case 'project.member_removed':
      return `${who} removed ${String(m.name ?? 'someone')} from ${target}`;
    case 'project.deleted':
      return `${who} deleted the project ${target}`;
    default:
      return `${who}: ${entry.action}`;
  }
}

/** Failed sign-ins and ownership or access removals stand out in the list. */
export const isWarning = (action: string) =>
  action === 'auth.login_failed' || action === 'member.removed' || action === 'member.ownership_transferred' || action === 'project.deleted';

/** "Firefox on Windows"-style summary of a user agent, enough to spot an unfamiliar device. */
export function deviceOf(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? ua.slice(0, 40);
}
