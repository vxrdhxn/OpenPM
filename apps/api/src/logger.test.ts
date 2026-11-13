import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { FastifyRequest, LogController } from 'fastify';
import cookie from '@fastify/cookie';
import pino from 'pino';
import authPlugin, { authFailureReason } from './plugins/auth';
import requestIdPlugin from './plugins/requestId';
import { REDACT_PATHS, genReqId, loggerOptions } from './logger';

type Line = Record<string, any>;

function capture() {
  const raw: string[] = [];
  const lines: Line[] = [];
  const stream = {
    write(chunk: string) {
      raw.push(chunk);
      lines.push(JSON.parse(chunk));
    },
  };
  return { raw, lines, stream };
}

describe('log format and redaction', () => {
  it('writes one JSON object per line with stable, filterable fields', () => {
    const { lines, stream } = capture();

    pino(loggerOptions, stream).info({ foo: 1 }, 'hello');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'info', service: 'openpm-api', msg: 'hello', foo: 1 });
    expect(new Date(lines[0]!.time).toISOString()).toBe(lines[0]!.time); // ISO-8601, not an epoch number
  });

  it('redacts credentials wherever they appear', () => {
    const { raw, lines, stream } = capture();
    const log = pino(loggerOptions, stream);

    log.info(
      {
        req: { method: 'GET', headers: { authorization: 'Bearer SECRET-JWT', cookie: 'auth_token=SECRET-COOKIE', accept: 'json' } },
        res: { headers: { 'set-cookie': 'auth_token=SECRET-SETCOOKIE' } },
        password: 'SECRET-PW',
        user: { password: 'SECRET-PW2', password_hash: 'SECRET-HASH', token: 'SECRET-TOKEN', name: 'visible' },
        config: { secret: 'SECRET-S', secretAccessKey: 'SECRET-KEY' },
      },
      'sensitive'
    );

    expect(raw.join('')).not.toMatch(/SECRET/);
    expect(lines[0]!.req.headers.authorization).toBe('[Redacted]');
    // Only credentials are redacted; useful context survives.
    expect(lines[0]!.req.method).toBe('GET');
    expect(lines[0]!.req.headers.accept).toBe('json');
    expect(lines[0]!.user.name).toBe('visible');
  });

  it('covers every path it claims to (guards against typos in REDACT_PATHS)', () => {
    const { raw, stream } = capture();
    const log = pino(loggerOptions, stream);

    for (const path of REDACT_PATHS) {
      // Build an object that puts a marker at that path (wildcard -> a nested "x" key).
      const parts = path.replace(/\["([^"]+)"\]/g, '.$1').split('.').map((p) => (p === '*' ? 'x' : p));
      const payload: Line = {};
      let cursor = payload;
      parts.forEach((part, i) => {
        if (i === parts.length - 1) cursor[part] = `LEAK-${path}`;
        else cursor = cursor[part] = {};
      });
      log.info(payload, 'probe');
    }

    expect(raw.join('')).not.toContain('LEAK-');
  });
});

describe('genReqId', () => {
  const idFor = (value: string | string[] | undefined) => genReqId({ headers: { 'x-request-id': value } });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it.each(['3f2a9c1e-7b64-4d0a-9a55-0c1d2e3f4a5b', 'abc12345', 'req_2026-11-12.alpha', 'A'.repeat(128)])(
    'keeps a well-formed upstream id: %s',
    (id) => {
      expect(idFor(id)).toBe(id);
    }
  );

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(129)],
    ['contains a newline (log injection)', 'abcdefgh\n{"level":"fatal"}'],
    ['contains a space', 'abcd efgh'],
    ['contains quotes', 'abcdefgh"x'],
    ['non-ASCII', 'abcdefghé'],
    ['starts with a symbol', '-abcdefgh'],
    ['empty', ''],
  ])('replaces an unacceptable id (%s) with a fresh uuid', (_label, id) => {
    expect(idFor(id)).toMatch(UUID);
  });

  it('mints a unique uuid when there is no header', () => {
    expect(idFor(undefined)).toMatch(UUID);
    expect(idFor(undefined)).not.toBe(idFor(undefined));
  });

  it('uses the first value when a header is repeated', () => {
    expect(idFor(['first-valid-id', 'second-valid-id'])).toBe('first-valid-id');
  });
});

describe('request context in logs', () => {
  let app: ReturnType<typeof Fastify>;

  async function build() {
    const out = capture();
    app = Fastify({
      loggerInstance: pino(loggerOptions, out.stream), // Fastify 5: a ready-made pino instance goes in `loggerInstance`
      genReqId,
      logController: new LogController({ requestIdLogLabel: 'request_id' }), // same wiring as src/index.ts
    });
    await app.register(cookie); // as in src/index.ts: the JWT plugin reads the auth cookie via it
    await app.register(requestIdPlugin);
    await app.register(authPlugin);
    app.get('/open', async (request: FastifyRequest) => {
      request.log.info('open handler');
      return { ok: true };
    });
    app.get('/secure', { preValidation: app.authenticate }, async (request: FastifyRequest) => {
      request.log.info('secure handler');
      return { ok: true };
    });
    await app.ready();
    return out;
  }

  afterEach(async () => {
    await app.close();
  });

  it('echoes a valid incoming request id and stamps it on every line of that request', async () => {
    const { lines } = await build();

    const res = await app.inject({ method: 'GET', url: '/open', headers: { 'x-request-id': 'upstream-abc-123' } });

    expect(res.headers['x-request-id']).toBe('upstream-abc-123');
    const mine = lines.filter((l) => l.request_id === 'upstream-abc-123');
    expect(mine.map((l) => l.msg)).toEqual(expect.arrayContaining(['incoming request', 'open handler', 'request completed']));
    expect(lines.filter((l) => l.request_id && l.request_id !== 'upstream-abc-123')).toEqual([]);
  });

  it('replaces a hostile id and never echoes it', async () => {
    const { raw } = await build();

    const res = await app.inject({ method: 'GET', url: '/open', headers: { 'x-request-id': 'bad id\twith spaces' } });

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(raw.join('')).not.toContain('with spaces');
  });

  it('generates distinct ids for distinct requests', async () => {
    await build();

    const a = await app.inject({ method: 'GET', url: '/open' });
    const b = await app.inject({ method: 'GET', url: '/open' });

    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('adds user and org ids (only) to every line after authentication, including the completion line', async () => {
    const { lines } = await build();
    const token = app.jwt.sign({ user_id: 'user-42', org_id: 'org-7', role: 'member' });

    const res = await app.inject({ method: 'GET', url: '/secure', headers: { authorization: `Bearer ${token}` } });

    const requestId = res.headers['x-request-id'];
    const after = lines.filter((l) => l.request_id === requestId && ['secure handler', 'request completed'].includes(l.msg));
    expect(after).toHaveLength(2);
    for (const line of after) expect(line).toMatchObject({ user_id: 'user-42', org_id: 'org-7' });
    // No role/email/name/token in the context.
    expect(Object.keys(after[0]!).filter((k) => ['role', 'email', 'name', 'token', 'authorization'].includes(k))).toEqual([]);
  });

  it('does not attribute unauthenticated requests to anyone', async () => {
    const { lines } = await build();

    const res = await app.inject({ method: 'GET', url: '/secure' });

    expect(res.statusCode).toBe(401);
    const mine = lines.filter((l) => l.request_id === res.headers['x-request-id']);
    expect(mine.some((l) => 'user_id' in l || 'org_id' in l)).toBe(false);
  });

  it('logs the reason for an auth failure but never the credential', async () => {
    const { lines, raw } = await build();

    await app.inject({ method: 'GET', url: '/secure', headers: { authorization: 'Bearer not-a-real-jwt-SECRETVALUE' } });
    await app.inject({ method: 'GET', url: '/secure' });

    const failures = lines.filter((l) => l.event === 'auth_failure');
    expect(failures.map((l) => l.reason)).toEqual(['invalid', 'missing']);
    expect(failures.every((l) => l.level === 'warn')).toBe(true);
    expect(raw.join('')).not.toContain('SECRETVALUE');
  });

  it('classifies an expired token', async () => {
    const { lines } = await build();
    const expired = app.jwt.sign({ user_id: 'u', org_id: 'o', role: 'member', exp: Math.floor(Date.now() / 1000) - 60 });

    await app.inject({ method: 'GET', url: '/secure', headers: { authorization: `Bearer ${expired}` } });

    expect(lines.find((l) => l.event === 'auth_failure')).toMatchObject({ reason: 'expired' });
  });
});

describe('authFailureReason', () => {
  it.each([
    ['FST_JWT_NO_AUTHORIZATION_IN_HEADER', 'missing'],
    ['FST_JWT_NO_AUTHORIZATION_IN_COOKIE', 'missing'], // what @fastify/jwt emits with cookie auth enabled
    ['FST_JWT_AUTHORIZATION_TOKEN_EXPIRED', 'expired'],
    ['FST_JWT_AUTHORIZATION_TOKEN_INVALID', 'invalid'],
    ['SOMETHING_ELSE', 'invalid'],
  ])('%s -> %s', (code, reason) => {
    expect(authFailureReason({ code })).toBe(reason);
  });

  it('is safe for non-error values', () => {
    expect(authFailureReason(undefined)).toBe('invalid');
    expect(authFailureReason('boom')).toBe('invalid');
  });
});
