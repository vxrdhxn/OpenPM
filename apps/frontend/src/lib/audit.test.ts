import { describe, expect, it } from 'vitest';
import { AUDIT_FILTERS, describeAudit, deviceOf, isWarning } from './audit';

const entry = (action: string, metadata: Record<string, unknown> = {}, target_name: string | null = 'Bo') => ({
  action,
  actor_name: 'Ada',
  target_name,
  metadata,
});

describe('describeAudit', () => {
  it.each([
    [entry('auth.login'), 'Ada signed in'],
    [entry('auth.login_failed'), "Failed sign-in to Bo's account (wrong password)"],
    [entry('member.role_changed', { from: 'member', to: 'admin' }), "Ada changed Bo's role from Member to Admin"],
    [entry('member.ownership_transferred'), 'Ada transferred ownership to Bo'],
    [entry('project.visibility_changed', { to: 'private' }, 'Payroll'), 'Ada made Payroll private'],
    [entry('project.visibility_changed', { to: 'workspace' }, 'Payroll'), 'Ada opened Payroll to the whole workspace'],
    [entry('project.member_added', { name: 'Cy' }, 'Payroll'), 'Ada added Cy to Payroll'],
    [entry('organization.renamed', { to: 'Acme' }), 'Ada renamed the workspace to “Acme”'],
    [entry('something.new'), 'Ada: something.new'],
  ])('%o', (e, sentence) => {
    expect(describeAudit(e)).toBe(sentence);
  });

  it('copes with a deleted actor and an unknown target', () => {
    expect(describeAudit({ action: 'member.removed', actor_name: null, target_name: null, metadata: {} })).toBe(
      'Someone removed someone from the workspace'
    );
  });
});

describe('AUDIT_FILTERS', () => {
  it('names every action once', () => {
    const values = AUDIT_FILTERS.flatMap((g) => g.options.map((o) => o.value));
    expect(new Set(values).size).toBe(values.length);
    expect(values).toHaveLength(20);
  });
});

describe('isWarning', () => {
  it('flags failed sign-ins, not ordinary ones', () => {
    expect(isWarning('auth.login_failed')).toBe(true);
    expect(isWarning('auth.login')).toBe(false);
  });
});

describe('deviceOf', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 'Chrome on Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'Safari on macOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox on Linux'],
    ['curl/8.4.0', 'curl/8.4.0'],
    [null, 'Unknown device'],
  ])('%s', (ua, device) => {
    expect(deviceOf(ua)).toBe(device);
  });
});
