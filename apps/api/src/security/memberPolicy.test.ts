import { describe, expect, it } from 'vitest';
import { checkMemberChange, isManager } from './memberPolicy';

const as = (role: string, id = 'actor') => ({ id, role });
const target = (role: string) => ({ id: 'target', role });

describe('checkMemberChange', () => {
  it('never lets anyone change themselves (they leave instead)', () => {
    expect(checkMemberChange(as('owner', 'me'), { id: 'me', role: 'owner' }, 'viewer')).toBe('self');
    expect(checkMemberChange(as('admin', 'me'), { id: 'me', role: 'admin' })).toBe('self');
  });

  it.each([
    ['admin', 'member', 'viewer'],
    ['admin', 'viewer', 'member'],
    ['admin', 'member', 'admin'], // promote to your own level
    ['owner', 'admin', 'member'],
    ['owner', 'member', 'owner'],
    ['owner', 'owner', 'admin'], // owners may manage other owners
  ])('allows %s to change a %s to %s', (actor, from, to) => {
    expect(checkMemberChange(as(actor), target(from), to)).toBeNull();
  });

  it.each([
    ['admin', 'admin'],
    ['admin', 'owner'],
    ['member', 'member'],
    ['viewer', 'viewer'],
    // (Whether a member may call these routes at all is the route's requireRole('admin'), not this.)
  ])('does not let a %s manage a %s', (actor, role) => {
    expect(checkMemberChange(as(actor), target(role), 'viewer')).toBe('outranked');
    expect(checkMemberChange(as(actor), target(role))).toBe('outranked');
  });

  it('does not let an admin hand out owner', () => {
    expect(checkMemberChange(as('admin'), target('member'), 'owner')).toBe('role_too_high');
  });

  it('lets a manager remove someone below them', () => {
    expect(checkMemberChange(as('admin'), target('member'))).toBeNull();
    expect(checkMemberChange(as('owner'), target('admin'))).toBeNull();
  });

  it('treats an unknown role as the lowest', () => {
    expect(checkMemberChange(as('admin'), target('superuser'), 'viewer')).toBeNull();
    expect(checkMemberChange(as('superuser'), target('viewer'), 'viewer')).toBe('outranked');
  });
});

describe('isManager', () => {
  it('is true for admins and owners only', () => {
    expect(['owner', 'admin', 'member', 'viewer', 'x'].map(isManager)).toEqual([true, true, false, false, false]);
  });
});
