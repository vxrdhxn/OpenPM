import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import type http from 'http';
import client from 'prom-client';

vi.mock('./lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

import { createMetricsServer, startMetricsServer } from './metricsServer';

describe('metrics server', () => {
  let server: http.Server;
  let base: string;
  const registry = new client.Registry();
  new client.Counter({ name: 'probe_total', help: 'probe', registers: [registry] }).inc(3);

  beforeEach(async () => {
    server = createMetricsServer(registry);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves Prometheus exposition format on /metrics', async () => {
    const res = await fetch(`${base}/metrics`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(registry.contentType);
    const body = await res.text();
    expect(body).toContain('# TYPE probe_total counter');
    expect(body).toMatch(/probe_total 3/);
  });

  it('ignores a query string on /metrics', async () => {
    expect((await fetch(`${base}/metrics?foo=bar`)).status).toBe(200);
  });

  it('answers /healthz cheaply', async () => {
    const res = await fetch(`${base}/healthz`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('supports HEAD without a body', async () => {
    const res = await fetch(`${base}/metrics`, { method: 'HEAD' });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it.each(['/', '/admin', '/metrics/extra', '/healthz/x', '/.env'])('serves nothing else: %s -> 404', async (path) => {
    expect((await fetch(`${base}${path}`)).status).toBe(404);
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('rejects %s with 405', async (method) => {
    const res = await fetch(`${base}/metrics`, { method });

    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });

  it('returns 500 (and does not crash) if the registry cannot be rendered', async () => {
    const broken = { metrics: () => Promise.reject(new Error('boom')), contentType: 'text/plain' } as unknown as client.Registry;
    const s = createMetricsServer(broken);
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));

    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/metrics`);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('boom'); // internals are not echoed to the client

    // Still alive afterwards.
    expect((await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/healthz`)).status).toBe(200);
    await new Promise<void>((resolve) => s.close(() => resolve()));
  });
});

describe('startMetricsServer', () => {
  it('listens on the requested port and resolves with the server', async () => {
    const server = await startMetricsServer(0);
    const { port } = server.address() as AddressInfo;

    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects if the port is already taken', async () => {
    const first = await startMetricsServer(0);
    const { port } = first.address() as AddressInfo;

    await expect(startMetricsServer(port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await new Promise<void>((resolve) => first.close(() => resolve()));
  });
});
