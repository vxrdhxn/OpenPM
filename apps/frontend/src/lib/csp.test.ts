import { describe, expect, it } from 'vitest';
import { buildCsp, newNonce, originOf } from './csp';

const directive = (csp: string, name: string) =>
  csp
    .split('; ')
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(' ') ?? [];

describe('buildCsp', () => {
  const base = { nonce: 'abc123', dev: false, host: 'pm.example.com', secure: true };

  it('runs only scripts carrying the nonce, and no eval, in production', () => {
    const csp = buildCsp(base);
    expect(directive(csp, 'script-src')).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(csp).not.toContain('unsafe-eval');
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
  });

  it('allows the same-origin socket with the page’s scheme', () => {
    expect(directive(buildCsp(base), 'connect-src')).toEqual(["'self'", 'wss://pm.example.com']);
    expect(directive(buildCsp({ ...base, secure: false, host: 'localhost:3001' }), 'connect-src')).toContain('ws://localhost:3001');
  });

  it('adds the API, socket and storage origins, never paths or junk', () => {
    const csp = buildCsp({
      ...base,
      apiUrl: 'http://localhost:3000/api',
      wsUrl: 'ws://localhost:3000/ws',
      extraConnectSrc: 'https://files.example.com/bucket, javascript:alert(1)  not-a-url',
    });
    expect(directive(csp, 'connect-src')).toEqual([
      "'self'",
      'wss://pm.example.com',
      'http://localhost:3000',
      'ws://localhost:3000',
      'https://files.example.com',
    ]);
  });

  it('lets the dev server eval and reach the local API', () => {
    const csp = buildCsp({ ...base, dev: true });
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'connect-src')).toContain('http://localhost:3000');
  });
});

describe('originOf', () => {
  it.each([
    ['https://a.example.com/x?y', 'https://a.example.com'],
    ['/api', null],
    ['data:text/html,hi', null],
    [undefined, null],
  ])('%s -> %s', (url, origin) => {
    expect(originOf(url)).toBe(origin);
  });
});

describe('newNonce', () => {
  it('is fresh each time and base64', () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});
