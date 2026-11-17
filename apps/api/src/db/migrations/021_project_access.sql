-- Private projects: a project is visible to the whole workspace (the default, and every existing
-- project), or only to its members plus the workspace's admins and owners.
ALTER TABLE projects
  ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'workspace'
    CONSTRAINT projects_visibility_check CHECK (visibility IN ('workspace', 'private')),
  ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Who was added to a project. Only consulted for private projects; kept when a project goes back to
-- the workspace, so making it private again restores the same people.
CREATE TABLE project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id)
);

-- "Which private projects is this user in" (every request of a non-admin to a project).
CREATE INDEX idx_project_members_user ON project_members (user_id, project_id);
