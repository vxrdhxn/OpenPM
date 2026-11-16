// Enqueue background jobs for the worker-throughput test (docs/load-testing.md): creates JOBS tasks,
// each assigned to someone, so each one queues a task_created (assignment email) job.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const JOBS = Number(__ENV.JOBS || 2000);

export const options = { scenarios: { enqueue: { executor: 'shared-iterations', vus: 20, iterations: JOBS, maxDuration: '5m' } } };

export function setup() {
  const login = (email) =>
    http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: __ENV.PASSWORD || 'loadtest-password' }), { headers: { 'content-type': 'application/json' } });
  const token = login('load1@loadtest.invalid').json('token');
  const assignee = http.get(`${BASE}/api/members`, { headers: { authorization: `Bearer ${token}` } }).json().find((m) => m.email === 'load2@loadtest.invalid').id;
  const project = http.get(`${BASE}/api/projects?limit=1`, { headers: { authorization: `Bearer ${token}` } }).json('items')[0].id;
  return { token, assignee, project };
}

export default function (d) {
  const res = http.post(`${BASE}/api/projects/${d.project}/tasks`, JSON.stringify({ title: `job-load ${__ITER}`, assignee_id: d.assignee }), {
    headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' },
  });
  check(res, { created: (r) => r.status === 201 });
}
