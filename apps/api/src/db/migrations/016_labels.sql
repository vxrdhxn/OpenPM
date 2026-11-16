-- Labels (Phase I). Labels belong to the organization, so the same set is used across its projects.
-- Colors are names from a fixed palette (not free CSS), so a label can never carry arbitrary styles
-- and every color has a tested light/dark rendering in the frontend.
CREATE TABLE labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 50),
  color VARCHAR(16) NOT NULL DEFAULT 'gray'
    CHECK (color IN ('gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One label per name in an organization, ignoring case ("Bug" and "bug" are the same label).
CREATE UNIQUE INDEX idx_labels_org_name ON labels (org_id, lower(name));

-- Which labels a task has. org_id is denormalized so every query can stay tenant-scoped.
CREATE TABLE task_labels (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

-- "Tasks with this label" (filtering, and finding boards to refresh when a label changes).
CREATE INDEX idx_task_labels_label ON task_labels (label_id);
