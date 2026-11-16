// WebSocket load test (docs/load-testing.md): many connected clients receiving live events.
//
//   MSYS_NO_PATHCONV=1 docker run --rm --network container:openpm-api \
//     -v "$PWD/load/k6:/scripts" grafana/k6:2.3.0 run /scripts/ws.js
//
// SOCKETS clients each hold a socket for HOLD seconds while EVENTS_RPS tasks are created. Every task
// title carries the time it was sent, so each socket measures end-to-end delivery latency
// (API -> Redis pub/sub -> fan-out -> socket).
import http from 'k6/http';
import { check, fail } from 'k6';
import { WebSocket } from 'k6/websockets';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const WS = BASE.replace(/^http/, 'ws') + '/ws';
const SOCKETS = Number(__ENV.SOCKETS || 300);
const HOLD = Number(__ENV.HOLD || 60);
const EVENTS_RPS = Number(__ENV.EVENTS_RPS || 2);

const connectTime = new Trend('ws_connect_ms', true);
const deliveryLatency = new Trend('ws_event_delivery_ms', true);
const connected = new Rate('ws_connected');
const received = new Counter('ws_events_received');

export const options = {
  scenarios: {
    sockets: {
      executor: 'per-vu-iterations',
      exec: 'listen',
      vus: SOCKETS,
      iterations: 1,
      maxDuration: `${HOLD + 60}s`,
    },
    events: {
      executor: 'constant-arrival-rate',
      exec: 'produce',
      rate: EVENTS_RPS,
      timeUnit: '1s',
      startTime: '15s', // let the sockets connect first
      duration: `${HOLD - 25}s`,
      preAllocatedVUs: 5,
    },
  },
  thresholds: {
    ws_connected: ['rate>0.99'],
    ws_connect_ms: ['p(95)<1000'],
    ws_event_delivery_ms: ['p(95)<500'],
  },
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const tokens = Array.from({ length: 10 }, (_, i) => {
    const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: `load${i + 1}@loadtest.invalid`, password: __ENV.PASSWORD || 'loadtest-password' }), {
      headers: { 'content-type': 'application/json' },
    });
    if (res.status !== 200) fail(`login failed: ${res.status}`);
    return res.json('token');
  });
  const project = http.get(`${BASE}/api/projects?limit=1`, { headers: { authorization: `Bearer ${tokens[0]}` } }).json('items')[0].id;
  return { tokens, project };
}

export function listen(data) {
  const started = Date.now();
  let opened = false;
  const ws = new WebSocket(WS, null, { headers: { authorization: `Bearer ${data.tokens[__VU % data.tokens.length]}` } });

  ws.onopen = () => {
    opened = true;
    connected.add(true);
    connectTime.add(Date.now() - started);
    setTimeout(() => ws.close(), HOLD * 1000);
  };
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type !== 'task_created' || !msg.task) return;
    const sentAt = Number((msg.task.title.match(/^ws-load (\d+)$/) || [])[1]);
    if (sentAt) {
      deliveryLatency.add(Date.now() - sentAt);
      received.add(1);
    }
  };
  // Only a socket that never opened counts as a failed connection (k6 can report an error while a
  // socket it closed itself is shutting down).
  ws.onerror = (e) => {
    if (!opened) {
      opened = true; // count once
      connected.add(false);
      console.warn(`ws error before open: ${e.error}`);
    }
  };
}

export function produce(data) {
  const res = http.post(`${BASE}/api/projects/${data.project}/tasks`, JSON.stringify({ title: `ws-load ${Date.now()}` }), {
    headers: { authorization: `Bearer ${data.tokens[0]}`, 'content-type': 'application/json' },
  });
  check(res, { 'event task created': (r) => r.status === 201 });
}
