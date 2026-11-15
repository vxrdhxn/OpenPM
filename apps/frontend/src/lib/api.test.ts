import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

describe('api client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sentHeaders = () => new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers);

  // Fastify answers 400 to "Content-Type: application/json" with an empty body, so a body-less request
  // must not declare one. This broke deleting attachments and revoking invites.
  it.each([
    ['DELETE', () => api.delete('/x')],
    ['GET', () => api.get('/x')],
  ])('sends no JSON content type on a %s without a body', async (_method, call) => {
    await call();

    expect(sentHeaders().has('content-type')).toBe(false);
  });

  it.each([
    ['POST', () => api.post('/x', { a: 1 })],
    ['PATCH', () => api.patch('/x', { a: 1 })],
  ])('sends JSON with a %s body', async (_method, call) => {
    await call();

    expect(sentHeaders().get('content-type')).toBe('application/json');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toBe('{"a":1}');
  });

  it('sends cookies with every request', async () => {
    await api.delete('/x');

    expect((fetchMock.mock.calls[0]![1] as RequestInit).credentials).toBe('include');
  });
});
