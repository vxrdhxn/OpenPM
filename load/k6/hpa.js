// In-cluster load to exercise the API HorizontalPodAutoscaler (docs/rehearsal.md, G.5).
// Run as a pod in a namespace outside the app's (its default-deny NetworkPolicy blocks other egress),
// with the pod network in RATE_LIMIT_ALLOWLIST.
import http from 'k6/http';
import { check, fail } from 'k6';

const BASE = __ENV.BASE_URL || 'http://openpm-dev-api.openpm-dev.svc:3000';

export const options = {
  scenarios: {
    load: { executor: 'constant-arrival-rate', rate: Number(__ENV.RATE || 60), timeUnit: '1s', duration: __ENV.DURATION || '4m', preAllocatedVUs: 30, maxVUs: 200 },
  },
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const id = `${Date.now()}`;
  const res = http.post(`${BASE}/api/auth/register`, JSON.stringify({ org_name: 'HPA', org_slug: `hpa-${id}`, email: `hpa-${id}@example.com`, password: 'password123', name: 'HPA' }), {
    headers: { 'content-type': 'application/json' },
  });
  if (res.status !== 201) fail(`register: ${res.status} ${res.body}`);
  const auth = { headers: { authorization: `Bearer ${res.json('token')}`, 'content-type': 'application/json' } };
  const project = http.post(`${BASE}/api/projects`, JSON.stringify({ name: 'HPA project' }), auth).json('id');
  for (let i = 0; i < 300; i++) http.post(`${BASE}/api/projects/${project}/tasks`, JSON.stringify({ title: `HPA task ${i}`, priority: ['low', 'high'][i % 2] }), auth);
  return { auth, project };
}

const URLS = (d) => [
  `${BASE}/api/projects/${d.project}/tasks`,
  `${BASE}/api/dashboard`,
  `${BASE}/api/tasks?q=task&limit=20`,
  `${BASE}/api/projects`,
];

export default function (d) {
  const urls = URLS(d);
  const res = http.get(urls[Math.floor(Math.random() * urls.length)], d.auth);
  check(res, { ok: (r) => r.status === 200 });
}
