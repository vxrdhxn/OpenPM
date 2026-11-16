// HTTP load test for the OpenPM API (docs/load-testing.md).
//
// Run against the Compose stack with the load-test overlay and seeded data:
//   MSYS_NO_PATHCONV=1 docker run --rm --network container:openpm-api \
//     -v "$PWD/load/k6:/scripts" grafana/k6:2.3.0 run /scripts/api.js
//
// Three concurrent scenarios: reads ramping to PEAK_RPS, a steady stream of writes, and logins.
import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const PEAK_RPS = Number(__ENV.PEAK_RPS || 150);
const WRITE_RPS = Number(__ENV.WRITE_RPS || 10);
const LOGIN_RPS = Number(__ENV.LOGIN_RPS ?? 2);
const PASSWORD = __ENV.PASSWORD || 'loadtest-password';
const USERS = Array.from({ length: 10 }, (_, i) => `load${i + 1}@loadtest.invalid`);

// Per-endpoint latency, so the summary says which call is slow, not just "reads".
const endpoints = {};
for (const name of ['projects', 'board', 'my_tasks', 'search', 'dashboard', 'activity', 'unread', 'comments', 'create_task', 'move_task', 'comment', 'login']) {
  endpoints[name] = new Trend(`latency_${name}`, true);
}

export const options = {
  discardResponseBodies: false,
  scenarios: {
    browse: {
      executor: 'ramping-arrival-rate',
      exec: 'browse',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { target: Math.round(PEAK_RPS / 3), duration: '1m' },
        { target: PEAK_RPS, duration: '1m30s' },
        { target: PEAK_RPS, duration: '1m30s' },
        { target: 0, duration: '20s' },
      ],
    },
    edit: {
      executor: 'constant-arrival-rate',
      exec: 'edit',
      rate: WRITE_RPS,
      timeUnit: '1s',
      duration: '4m',
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
    login: {
      executor: 'constant-arrival-rate',
      exec: 'login',
      rate: Math.max(LOGIN_RPS, 1),
      timeUnit: '1s',
      duration: '4m',
      preAllocatedVUs: 5,
      maxVUs: 30,
    },
  },
  // LOGIN_RPS=0 drops the login scenario (isolates bcrypt's cost from everything else).
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:read}': ['p(95)<300'],
    'http_req_duration{kind:write}': ['p(95)<500'],
    'http_req_duration{kind:login}': ['p(95)<1000'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const json = (token) => ({ headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function signIn(email) {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
    headers: { 'content-type': 'application/json' },
    tags: { kind: 'login', name: 'login' },
  });
  return res;
}

export function setup() {
  const sessions = USERS.map((email) => {
    const res = signIn(email);
    if (res.status !== 200) fail(`login failed for ${email}: ${res.status} ${res.body}. Did you run load/seed.sql?`);
    return res.json('token');
  });
  const projects = http.get(`${BASE}/api/projects?limit=100`, json(sessions[0])).json('items').map((p) => p.id);
  // A pool of existing tasks to update and comment on.
  const tasks = http
    .get(`${BASE}/api/tasks?limit=100&sort=updated_at`, json(sessions[0]))
    .json('items')
    .map((t) => ({ id: t.id, project_id: t.project_id }));
  if (projects.length === 0 || tasks.length === 0) fail('no seeded projects/tasks found');
  return { sessions, projects, tasks };
}

function get(name, url, token) {
  const res = http.get(url, { headers: { authorization: `Bearer ${token}` }, tags: { kind: 'read', name } });
  endpoints[name].add(res.timings.duration);
  check(res, { [`${name} 200`]: (r) => r.status === 200 });
}

// Weighted mix of what people do while browsing.
const READS = [
  [15, 'unread', (d) => `${BASE}/api/notifications/unread-count`],
  [15, 'dashboard', () => `${BASE}/api/dashboard`],
  [20, 'board', (d) => `${BASE}/api/projects/${pick(d.projects)}/tasks`],
  [15, 'my_tasks', () => `${BASE}/api/tasks?assignee=me&status=todo&status=in_progress&status=in_review&sort=due_date&order=asc&limit=8`],
  [10, 'projects', () => `${BASE}/api/projects`],
  [10, 'activity', () => `${BASE}/api/activity?limit=15`],
  [10, 'search', () => `${BASE}/api/tasks?q=${encodeURIComponent(pick(['login', 'release', 'Task 42', 'zzqx']))}&limit=20`],
  [5, 'comments', (d) => {
    const t = pick(d.tasks);
    return `${BASE}/api/projects/${t.project_id}/tasks/${t.id}/comments`;
  }],
];
const READ_TOTAL = READS.reduce((sum, [w]) => sum + w, 0);

export function browse(data) {
  let roll = Math.random() * READ_TOTAL;
  for (const [weight, name, url] of READS) {
    roll -= weight;
    if (roll <= 0) return get(name, url(data), pick(data.sessions));
  }
}

export function edit(data) {
  const token = pick(data.sessions);
  const roll = Math.random();
  let res;
  let name;
  if (roll < 0.4) {
    name = 'create_task';
    res = http.post(`${BASE}/api/projects/${pick(data.projects)}/tasks`, JSON.stringify({ title: `Load ${Date.now()}`, priority: 'medium' }), {
      ...json(token),
      tags: { kind: 'write', name },
    });
  } else if (roll < 0.8) {
    name = 'move_task';
    const t = pick(data.tasks);
    res = http.patch(`${BASE}/api/projects/${t.project_id}/tasks/${t.id}`, JSON.stringify({ status: pick(['todo', 'in_progress', 'in_review', 'done']) }), {
      ...json(token),
      tags: { kind: 'write', name },
    });
  } else {
    name = 'comment';
    const t = pick(data.tasks);
    res = http.post(`${BASE}/api/projects/${t.project_id}/tasks/${t.id}/comments`, JSON.stringify({ body: `Load comment ${Date.now()}` }), {
      ...json(token),
      tags: { kind: 'write', name },
    });
  }
  endpoints[name].add(res.timings.duration);
  check(res, { [`${name} ok`]: (r) => r.status === 200 || r.status === 201 });
}

export function login() {
  const res = signIn(pick(USERS));
  endpoints.login.add(res.timings.duration);
  check(res, { 'login 200': (r) => r.status === 200 });
}

if (LOGIN_RPS === 0) delete options.scenarios.login;
