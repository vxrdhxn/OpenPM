import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { REDACT_PATHS, domainOf, loggerOptions, resolveLevel } from './logger';

function capture() {
  const raw: string[] = [];
  const lines: Array<Record<string, any>> = [];
  return { raw, lines, stream: { write: (c: string) => (raw.push(c), lines.push(JSON.parse(c))) } };
}

describe('worker log format', () => {
  it('writes JSON lines in the same shape as the API', () => {
    const { lines, stream } = capture();

    pino(loggerOptions, stream).info({ job_id: '7' }, 'hello');

    expect(lines[0]).toMatchObject({ level: 'info', service: 'openpm-worker', msg: 'hello', job_id: '7' });
    expect(new Date(lines[0]!.time).toISOString()).toBe(lines[0]!.time);
  });

  it('redacts credentials', () => {
    const { raw, lines, stream } = capture();

    pino(loggerOptions, stream).info(
      { password: 'SECRET-1', config: { token: 'SECRET-2', apiKey: 'SECRET-3' }, job: { id: '7' } },
      'x'
    );

    expect(raw.join('')).not.toMatch(/SECRET/);
    expect(lines[0]!.job).toEqual({ id: '7' }); // non-sensitive context survives
  });

  it('covers every path it claims to (guards against typos in REDACT_PATHS)', () => {
    const { raw, stream } = capture();
    const log = pino(loggerOptions, stream);

    for (const path of REDACT_PATHS) {
      const parts = path.split('.').map((p) => (p === '*' ? 'x' : p));
      const payload: Record<string, any> = {};
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

describe('resolveLevel', () => {
  it.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])('accepts %s', (level) => {
    expect(resolveLevel(level)).toBe(level);
  });

  it.each([undefined, '', 'verbose', 'INFO', 'warning'])('falls back to info for %j instead of crashing pino', (value) => {
    expect(resolveLevel(value)).toBe('info');
    expect(() => pino({ level: resolveLevel(value) })).not.toThrow();
  });
});

describe('domainOf', () => {
  it.each([
    ['ada@Example.COM', 'example.com'],
    ['a.b+tag@sub.example.org', 'sub.example.org'],
    ['weird@name@host.io', 'host.io'],
    ['no-at-sign', 'invalid'],
    ['', 'invalid'],
  ])('%j -> %j', (input, expected) => {
    expect(domainOf(input)).toBe(expected);
  });

  it('never returns the local part', () => {
    expect(domainOf('someone.private@example.org')).not.toContain('someone');
  });
});
