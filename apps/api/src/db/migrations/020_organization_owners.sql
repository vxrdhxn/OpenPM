-- Organizations: an owner for every workspace, settings, and declinable invites.

-- Workspace settings can be changed now (rename), so record when.
ALTER TABLE organizations ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- An invitee can decline. The invite is kept (marked) so admins see the answer.
ALTER TABLE organization_invites ADD COLUMN declined_at TIMESTAMP WITH TIME ZONE;

-- Before this release, sign-up made the creator an admin, so most workspaces have no owner, and only
-- an owner can transfer ownership or delete the workspace. Promote the longest-standing active admin
-- of each workspace that has no active owner (normally the person who created it).
UPDATE users SET role = 'owner'
 WHERE id IN (
   SELECT DISTINCT ON (u.org_id) u.id
     FROM users u
    WHERE u.role = 'admin'
      AND u.deactivated_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM users o WHERE o.org_id = u.org_id AND o.role = 'owner' AND o.deactivated_at IS NULL
      )
    ORDER BY u.org_id, u.created_at, u.id
 );
