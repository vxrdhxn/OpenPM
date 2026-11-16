-- Load-test data (docs/load-testing.md). Creates a separate "loadtest" organization; re-running
-- replaces it. Never run against production.
--
--   docker exec -i openpm-postgres psql -U openpm -d openpm -v pwhash="<bcrypt hash>" < load/seed.sql
--
-- Volume: 10 users, 50 projects, 50,000 tasks (skewed: a few big boards, many small ones),
-- 8 labels on ~30% of tasks, 20,000 comments, 100,000 activity entries.
\set ON_ERROR_STOP on
BEGIN;

DELETE FROM organizations WHERE slug = 'loadtest';

INSERT INTO organizations (name, slug) VALUES ('Load Test', 'loadtest');

INSERT INTO users (org_id, email, password_hash, name, role)
SELECT o.id, 'load' || g || '@loadtest.invalid', :'pwhash', 'Load User ' || g,
       CASE WHEN g = 1 THEN 'admin' ELSE 'member' END
  FROM organizations o, generate_series(1, 10) g
 WHERE o.slug = 'loadtest';

INSERT INTO projects (org_id, name, description, created_by, created_at)
SELECT o.id, 'Project ' || g, 'Seeded project ' || g, u.id, NOW() - (g || ' days')::interval
  FROM organizations o
  JOIN users u ON u.org_id = o.id AND u.email = 'load1@loadtest.invalid'
  CROSS JOIN generate_series(1, 50) g
 WHERE o.slug = 'loadtest';

-- Project picked by random()^2, so low-numbered projects get most tasks (a few boards over 1000).
WITH org AS (SELECT id FROM organizations WHERE slug = 'loadtest'),
     p AS (SELECT id, row_number() OVER (ORDER BY name) - 1 AS n FROM projects WHERE org_id = (SELECT id FROM org)),
     u AS (SELECT id, row_number() OVER (ORDER BY email) - 1 AS n FROM users WHERE org_id = (SELECT id FROM org)),
     t AS (
       SELECT g,
              floor(50 * power(random(), 2))::int AS pn,
              floor(random() * 11)::int AS un, -- 10 = unassigned
              random() AS r1, random() AS r2, random() AS r3
         FROM generate_series(1, 50000) g
     )
INSERT INTO tasks (org_id, project_id, title, description, status, priority, assignee_id, created_by, due_date, created_at, updated_at)
SELECT (SELECT id FROM org), p.id,
       'Task ' || t.g || CASE WHEN t.g % 7 = 0 THEN ' login bug' WHEN t.g % 11 = 0 THEN ' release notes' ELSE '' END,
       'Seeded task description ' || t.g,
       (ARRAY['todo', 'in_progress', 'in_review', 'done'])[1 + floor(t.r1 * 4)::int],
       (ARRAY['low', 'medium', 'high', 'urgent'])[1 + floor(t.r2 * 4)::int],
       u.id,
       (SELECT id FROM users WHERE email = 'load1@loadtest.invalid'),
       CASE WHEN t.r3 < 0.6 THEN NOW() + ((floor(t.r3 * 120) - 30) || ' days')::interval END,
       NOW() - ((t.g % 365) || ' days')::interval,
       NOW() - ((t.g % 90) || ' days')::interval
  FROM t
  JOIN p ON p.n = t.pn
  LEFT JOIN u ON u.n = t.un;

INSERT INTO labels (org_id, name, color)
SELECT o.id, l.name, l.color
  FROM organizations o,
       (VALUES ('bug', 'red'), ('feature', 'blue'), ('docs', 'gray'), ('ui', 'purple'),
               ('backend', 'teal'), ('urgent', 'orange'), ('design', 'pink'), ('infra', 'green')) AS l(name, color)
 WHERE o.slug = 'loadtest';

INSERT INTO task_labels (task_id, label_id, org_id)
SELECT t.id, l.id, t.org_id
  FROM tasks t
  JOIN LATERAL (
    SELECT id FROM labels WHERE org_id = t.org_id ORDER BY md5(t.id::text || id::text) LIMIT 1
  ) l ON TRUE
 WHERE t.org_id = (SELECT id FROM organizations WHERE slug = 'loadtest') AND random() < 0.3;

INSERT INTO task_comments (org_id, task_id, author_id, body, created_at)
SELECT t.org_id, t.id, t.created_by, 'Seeded comment on ' || t.title, t.created_at + interval '1 hour'
  FROM tasks t
 WHERE t.org_id = (SELECT id FROM organizations WHERE slug = 'loadtest')
 ORDER BY random()
 LIMIT 20000;

INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata, created_at)
SELECT t.org_id, t.created_by, 'task', t.id, 'updated', '{"changes":["status"]}'::jsonb,
       NOW() - (random() * interval '90 days')
  FROM tasks t, generate_series(1, 2) g
 WHERE t.org_id = (SELECT id FROM organizations WHERE slug = 'loadtest');

COMMIT;

ANALYZE;

SELECT (SELECT count(*) FROM tasks t JOIN organizations o ON o.id = t.org_id WHERE o.slug = 'loadtest') AS tasks,
       (SELECT count(*) FROM task_comments c JOIN organizations o ON o.id = c.org_id WHERE o.slug = 'loadtest') AS comments,
       (SELECT count(*) FROM activity_log a JOIN organizations o ON o.id = a.org_id WHERE o.slug = 'loadtest') AS activity;
