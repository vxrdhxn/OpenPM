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

  describe('on 401 (session cookie rejected)', () => {
    const unauthorized = () =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });

    it('clears the cookie through the API before going to /login, so the proxy cannot loop', async () => {
      const location = { pathname: '/projects', href: 'http://app.test/projects' };
      vi.stubGlobal('window', { location });
      fetchMock.mockReset().mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(new Response(null, { status: 200 }));

      await expect(api.get('/auth/me')).rejects.toThrow('Unauthorized');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [logoutUrl, logoutInit] = fetchMock.mock.calls[1]!;
      expect(String(logoutUrl)).toMatch(/\/auth\/logout$/);
      expect(logoutInit).toMatchObject({ method: 'POST', credentials: 'include' });
      expect(location.href).toBe('/login');
    });

    it('still goes to /login when the logout call itself fails', async () => {
      const location = { pathname: '/projects', href: 'http://app.test/projects' };
      vi.stubGlobal('window', { location });
      fetchMock.mockReset().mockResolvedValueOnce(unauthorized()).mockRejectedValueOnce(new TypeError('network'));

      await expect(api.get('/auth/me')).rejects.toThrow('Unauthorized');

      expect(location.href).toBe('/login');
    });

    it('does nothing extra on the login page, where 401 just means wrong credentials', async () => {
      const location = { pathname: '/login', href: 'http://app.test/login' };
      vi.stubGlobal('window', { location });
      fetchMock.mockReset().mockResolvedValueOnce(unauthorized());

      await expect(api.post('/auth/login', { email: 'a', password: 'b' })).rejects.toThrow('Unauthorized');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(location.href).toBe('http://app.test/login');
    });
  });

  it('sends cookies with every request', async () => {
    await api.delete('/x');

    expect((fetchMock.mock.calls[0]![1] as RequestInit).credentials).toBe('include');
  });
});
