import { describe, expect, it } from 'vitest';
import { parseAllowlist } from './rateLimitAllowlist';

describe('parseAllowlist', () => {
  it('is off when nothing is configured', () => {
    expect(parseAllowlist(undefined)).toBeNull();
    expect(parseAllowlist(' , ')).toBeNull();
  });

  it('matches exact addresses and CIDR ranges, IPv4 and IPv6', () => {
    const allowed = parseAllowlist('127.0.0.1, 10.0.0.0/8, fd00::/8')!;

    expect(allowed('127.0.0.1')).toBe(true);
    expect(allowed('::ffff:127.0.0.1')).toBe(true); // dual-stack form
    expect(allowed('10.42.1.7')).toBe(true);
    expect(allowed('fd12::1')).toBe(true);
    expect(allowed('127.0.0.2')).toBe(false);
    expect(allowed('192.168.1.1')).toBe(false);
    expect(allowed('not-an-ip')).toBe(false);
  });

  it.each(['localhost', '10.0.0.0/33', '10.0.0.0/x', '300.1.1.1'])('rejects %s at startup', (entry) => {
    expect(() => parseAllowlist(entry)).toThrow(/RATE_LIMIT_ALLOWLIST/);
  });
});
