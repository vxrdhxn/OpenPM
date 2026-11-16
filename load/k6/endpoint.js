// One endpoint at a fixed rate (docs/load-testing.md): isolates what each call costs.
//   ENDPOINT=board RATE=20 DURATION=30s
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const RATE = Number(__ENV.RATE || 20);

export const options = {
  scenarios: { one: { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: __ENV.DURATION || '30s', preAllocatedVUs: 20, maxVUs: 200 } },
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const token = http
    .post(`${BASE}/api/auth/login`, JSON.stringify({ email: 'load2@loadtest.invalid', password: __ENV.PASSWORD || 'loadtest-password' }), {
      headers: { 'content-type': 'application/json' },
    })
    .json('token');
  const auth = { headers: { authorization: `Bearer ${token}` } };
  const projects = http.get(`${BASE}/api/projects?limit=100`, auth).json('items').map((p) => p.id);
  const tasks = http.get(`${BASE}/api/tasks?limit=100`, auth).json('items');
  return { token, projects, tasks };
}

const pick = (l) => l[Math.floor(Math.random() * l.length)];
const URLS = {
  health: () => `${BASE}/health`,
  unread: () => `${BASE}/api/notifications/unread-count`,
  projects: () => `${BASE}/api/projects`,
  board: (d) => `${BASE}/api/projects/${pick(d.projects)}/tasks`,
  board_filtered: (d) => `${BASE}/api/projects/${pick(d.projects)}/tasks?priority=urgent`,
  dashboard: () => `${BASE}/api/dashboard`,
  my_tasks: () => `${BASE}/api/tasks?assignee=me&status=todo&status=in_progress&sort=due_date&order=asc&limit=8`,
  search: () => `${BASE}/api/tasks?q=login&limit=20`,
  activity: () => `${BASE}/api/activity?limit=15`,
  comments: (d) => {
    const t = pick(d.tasks);
    return `${BASE}/api/projects/${t.project_id}/tasks/${t.id}/comments`;
  },
};

export default function (d) {
  const res = http.get(URLS[__ENV.ENDPOINT](d), { headers: { authorization: `Bearer ${d.token}` } });
  check(res, { ok: (r) => r.status === 200 });
}
