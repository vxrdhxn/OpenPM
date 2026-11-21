import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';

vi.mock('../db/client', () => ({ db: { query: vi.fn() } }));

import { clearSessionCookie, issueSession, sessionCookieOptions, SESSION_TTL_SECONDS } from './session';

const claims = { user_id: 'u1', org_id: 'o1', role: 'owner', tv: 0 } as const;

describe('session cookie domain (COOKIE_DOMAIN)', () => {
  it('is host-only by default: no Domain attribute', () => {
    expect(sessionCookieOptions(60, undefined)).not.toHaveProperty('domain');
  });

  it('carries the configured domain, with the same flags', () => {
    expect(sessionCookieOptions(60, 'example.com')).toEqual({
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60,
      domain: 'example.com',
    });
  });

  describe('on the wire', () => {
    let app: FastifyInstance;
    afterEach(async () => app?.close());

    async function build(domain: string | undefined) {
      app = Fastify({ logger: false });
      await app.register(cookie);
      await app.register(jwt, { secret: 'x'.repeat(32) });
      // Same as issueSession/clearSessionCookie, with an explicit domain instead of the env setting.
      app.get('/in', async (_req, reply) => {
        reply.setCookie('auth_token', 'token', sessionCookieOptions(SESSION_TTL_SECONDS, domain));
        return {};
      });
      app.get('/out', async (_req, reply) => {
        reply.setCookie('auth_token', '', sessionCookieOptions(0, domain));
        return {};
      });
      app.get('/issue', async (_req, reply) => ({ token: issueSession(app, reply, claims) }));
      app.get('/clear', async (_req, reply) => {
        clearSessionCookie(reply);
        return {};
      });
      await app.ready();
    }

    const setCookie = async (url: string) => String((await app.inject({ method: 'GET', url })).headers['set-cookie']);

    it('sets and clears the cookie for the shared domain', async () => {
      await build('example.com');
      const set = await setCookie('/in');
      const cleared = await setCookie('/out');

      expect(set).toMatch(/^auth_token=token;/);
      expect(set).toContain('Domain=example.com');
      expect(set).toContain('HttpOnly');
      expect(set).toContain('SameSite=Strict');
      // Clearing must name the same domain, or the browser keeps the old cookie.
      expect(cleared).toContain('Domain=example.com');
      expect(cleared).toContain('Max-Age=0');
    });

    it('issueSession and clearSessionCookie stay host-only when COOKIE_DOMAIN is unset', async () => {
      await build(undefined);
      const issued = await setCookie('/issue');
      const cleared = await setCookie('/clear');

      expect(issued).toMatch(/^auth_token=ey/);
      expect(issued).not.toContain('Domain=');
      expect(cleared).not.toContain('Domain=');
      expect(cleared).toContain('Max-Age=0');
    });
  });
});
