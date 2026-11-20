'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { Crown, LogOut, UserMinus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm, useToast } from '@/components/ui/feedback';
import { assignableRoles, canManage, canTransferOwnership, leaveBlockedReason, type Member, type Role } from '@/lib/members';

/**
 * The organization's members: change roles, remove people, and leave. Actions are only shown where
 * the API will allow them (lib/members.ts); the API still checks every request.
 */
export default function MembersPanel() {
  const confirm = useConfirm();
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const me = useMe();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  // State is only set in the promise callbacks, never synchronously in the effect.
  const load = useCallback(
    () =>
      api
        .get('/members')
        .then((list) => {
          setMembers(list);
          setError('');
        })
        .catch((err) => setError(err instanceof Error ? err.message : 'Could not load members'))
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const changeRole = async (member: Member, role: Role) => {
    if (role === member.role) return;
    setBusy(member.id);
    setError('');
    try {
      const updated: Member = await api.patch(`/members/${member.id}`, { role });
      setMembers((list) => list.map((m) => (m.id === updated.id ? updated : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the role');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (member: Member) => {
    if (!(await confirm({ title: `Remove ${member.name}?`, message: 'They are signed out at once and their tasks are unassigned.', confirmLabel: 'Remove', destructive: true }))) return;
    setBusy(member.id);
    setError('');
    try {
      await api.delete(`/members/${member.id}`);
      setMembers((list) => list.filter((m) => m.id !== member.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the member');
    } finally {
      setBusy(null);
    }
  };

  const transfer = async (member: Member) => {
    const ok = await confirm({
      title: `Make ${member.name} the owner?`,
      message: 'They can then manage everyone and delete the organization. You become an admin, and only an owner can make you an owner again.',
      confirmLabel: 'Transfer ownership',
      destructive: true,
    });
    if (!ok) return;
    setBusy(member.id);
    setError('');
    try {
      await api.post(`/members/${member.id}/transfer-ownership`, {});
      toast(`${member.name} is now the owner`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not transfer ownership');
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    if (!(await confirm({ title: 'Leave this organization?', message: 'You will be signed out and lose access to its projects.', confirmLabel: 'Leave', destructive: true }))) return;
    setBusy('leave');
    setError('');
    try {
      await api.post('/members/leave', {});
      // Deliberate hard navigation: the session is gone, so drop all client state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/login';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not leave the organization');
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="p-6 text-slate-500">Loading members...</div>;
  }

  const actor = me ? { id: me.id, role: me.role as Role } : null;
  const leaveBlocked = actor ? leaveBlockedReason(actor, members) : null;

  return (
    <div className="card animate-fade-up overflow-hidden">
      <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5" />
            Members
          </h2>
          <p className="text-sm text-slate-500">
            {members.length} {members.length === 1 ? 'person' : 'people'} in this organization.
          </p>
          {leaveBlocked && <p className="text-xs text-slate-500 mt-1">To leave: {leaveBlocked.charAt(0).toLowerCase() + leaveBlocked.slice(1)}.</p>}
        </div>
        {actor && (
          <button
            onClick={leave}
            disabled={busy !== null || leaveBlocked !== null}
            title={leaveBlocked ?? 'Leave this organization'}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <LogOut className="w-4 h-4" />
            Leave
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="mx-6 mt-4 p-3 rounded-lg text-sm bg-red-50 text-red-700">
          {error}
        </div>
      )}

      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {members.map((member) => {
          const manageable = actor ? canManage(actor, member) : false;
          const isMe = actor?.id === member.id;
          return (
            <li key={member.id} className="p-4 sm:px-6 flex items-center justify-between gap-4">
              <div className="flex flex-col min-w-0">
                <span className="font-medium text-slate-900 dark:text-white truncate">
                  {member.name}
                  {isMe && <span className="ml-2 text-xs text-slate-500">(you)</span>}
                </span>
                <span className="text-sm text-slate-500 truncate">{member.email}</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {manageable && actor ? (
                  <select
                    aria-label={`Role of ${member.name}`}
                    value={member.role}
                    disabled={busy !== null}
                    onChange={(e) => changeRole(member, e.target.value as Role)}
                    className="px-3 py-1.5 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg dark:text-white capitalize"
                  >
                    {assignableRoles(actor.role).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 capitalize">{member.role}</span>
                )}

                {actor && canTransferOwnership(actor, member) && (
                  <button
                    onClick={() => transfer(member)}
                    disabled={busy !== null}
                    aria-label={`Make ${member.name} the owner`}
                    title="Transfer ownership"
                    className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Crown className="w-5 h-5" />
                  </button>
                )}

                {manageable && (
                  <button
                    onClick={() => remove(member)}
                    disabled={busy !== null}
                    aria-label={`Remove ${member.name}`}
                    title="Remove from organization"
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <UserMinus className="w-5 h-5" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
