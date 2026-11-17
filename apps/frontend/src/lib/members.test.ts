import { describe, expect, it } from 'vitest';
import { assignableRoles, canManage, canTransferOwnership, isLastManager, leaveBlockedReason, type Member } from './members';

const m = (id: string, role: Member['role']): Member => ({ id, role, name: id, email: `${id}@x.test`, created_at: '' });

describe('member UI rules (mirror of the API policy)', () => {
  it('lets managers manage lower roles only, never themselves', () => {
    expect(canManage({ id: 'a', role: 'admin' }, m('b', 'member'))).toBe(true);
    expect(canManage({ id: 'a', role: 'admin' }, m('b', 'admin'))).toBe(false);
    expect(canManage({ id: 'a', role: 'admin' }, m('a', 'admin'))).toBe(false);
    expect(canManage({ id: 'a', role: 'owner' }, m('b', 'owner'))).toBe(true);
  });

  it('gives members and viewers no management actions', () => {
    expect(canManage({ id: 'a', role: 'member' }, m('b', 'viewer'))).toBe(false);
  });

  it('offers roles up to your own', () => {
    expect(assignableRoles('admin')).toEqual(['admin', 'member', 'viewer']);
    expect(assignableRoles('owner')).toEqual(['owner', 'admin', 'member', 'viewer']);
  });

  it('knows when you are the last admin', () => {
    expect(isLastManager({ id: 'a', role: 'admin' }, [m('a', 'admin'), m('b', 'member')])).toBe(true);
    expect(isLastManager({ id: 'a', role: 'admin' }, [m('a', 'admin'), m('b', 'owner')])).toBe(false);
    expect(isLastManager({ id: 'b', role: 'member' }, [m('a', 'admin'), m('b', 'member')])).toBe(false);
  });

  it('keeps an owner: the last owner must transfer before leaving', () => {
    const owner = m('o', 'owner');
    expect(leaveBlockedReason(owner, [owner, m('a', 'admin')])).toMatch(/Transfer ownership/);
    expect(leaveBlockedReason(owner, [owner, m('p', 'owner')])).toBeNull();
    expect(leaveBlockedReason(m('a', 'admin'), [owner, m('a', 'admin')])).toBeNull();
    expect(leaveBlockedReason(m('a', 'admin'), [m('a', 'admin')])).toMatch(/admin before leaving/);
  });

  it('lets only owners transfer ownership, to someone who is not already an owner', () => {
    expect(canTransferOwnership({ id: 'o', role: 'owner' }, m('b', 'member'))).toBe(true);
    expect(canTransferOwnership({ id: 'o', role: 'owner' }, m('o', 'owner'))).toBe(false);
    expect(canTransferOwnership({ id: 'o', role: 'owner' }, m('p', 'owner'))).toBe(false);
    expect(canTransferOwnership({ id: 'a', role: 'admin' }, m('b', 'member'))).toBe(false);
  });
});
