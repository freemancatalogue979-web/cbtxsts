/**
 * Members page — a proper paginated directory (never hundreds of rows in one
 * endless scroll). Filters: all / online / admins / moderators / most active,
 * plus server-side search. Tapping a member opens their in-group dossier.
 * Owners assign moderators and remove members; anyone can challenge or invite.
 */
import {Crown, Search, ShieldCheck, Swords, Trash2, UserPlus, Users} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Avatar, Button, Card, EmptyState, IconButton, Modal, Pager, SectionHeading, Segmented, Skeleton, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {useGroup} from './context';
import {MemberAvatar, RoleChip} from './bits';
import {ChallengeModal} from './Duels';
import type {GroupMemberRow, PageMeta, PlayerSummary, PresenceStatus} from '../lib/types';

type Filter = 'all' | 'online' | 'admins' | 'moderators' | 'active';

function InviteModal({open, onClose}: {open: boolean; onClose: () => void}) {
  const {groupId, notify, refresh} = useGroup();
  const [friends, setFriends] = useState<PlayerSummary[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .friends()
      .then((payload) => setFriends(payload.friends ?? []))
      .catch(() => setFriends([]));
  }, [open]);

  const invite = async (studentId: number) => {
    setBusyId(studentId);
    try {
      await api.groups.invite(groupId, studentId);
      notify('success', 'Invite sent', 'They can join with a tap.');
      refresh();
    } catch (error) {
      notify('error', 'Could not invite', (error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite members" subtitle="Invite your friends into this group" size="md">
      <ul className="grid max-h-[50vh] gap-1.5 overflow-y-auto overscroll-contain">
        {friends.map((friend) => (
          <li key={friend.id} className="flex items-center gap-2 rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2">
            <Avatar name={friend.name} hue={friend.avatar_hue} initials={friend.initials} size={32} photo={{id: friend.id, has: friend.has_photo}} />
            <span className="min-w-0 flex-1 truncate text-[0.84rem] font-bold text-mist-100">{friend.name}</span>
            <Button size="sm" variant="outline" disabled={busyId === friend.id} onClick={() => void invite(friend.id)} icon={<UserPlus className="size-3.5" />}>
              {busyId === friend.id ? 'Sending' : 'Invite'}
            </Button>
          </li>
        ))}
        {friends.length === 0 && <li className="py-6 text-center text-[0.8rem] font-medium text-mist-600">Add friends first, then invite them here.</li>}
      </ul>
    </Modal>
  );
}

export default function Members() {
  const {groupId, group, can, room, myId, openMember, notify, refresh, intent, clearIntent} = useGroup();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<GroupMemberRow[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [challengeFor, setChallengeFor] = useState<number | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<GroupMemberRow | null>(null);

  useEffect(() => {
    if (intent === 'invite' && can('invite_members')) {
      setInviteOpen(true);
      clearIntent();
    }
  }, [intent, can, clearIntent]);

  const load = useCallback(() => {
    setLoading(true);
    api.groups
      .members(groupId, {filter, q: search, page, size: 20})
      .then((payload) => {
        setItems(payload.items);
        setMeta(payload);
      })
      .finally(() => setLoading(false));
  }, [groupId, filter, search, page]);

  useEffect(() => {
    const id = window.setTimeout(load, search ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [load, search]);
  useEffect(() => room.on('group_member_update', load), [room, load]);
  useEffect(() => room.on('group_presence', load), [room, load]);

  const setRole = async (member: GroupMemberRow, role: 'moderator' | 'member') => {
    try {
      await api.groups.setRole(groupId, member.student_id, role);
      notify('success', 'Role updated', `${member.name} is now ${role}.`);
      load();
    } catch (error) {
      notify('error', 'Could not change role', (error as Error).message);
    }
  };

  const doRemove = async () => {
    if (!confirmRemove) return;
    try {
      await api.groups.removeMember(groupId, confirmRemove.student_id);
      notify('success', 'Member removed', `${confirmRemove.name} was removed.`);
      setConfirmRemove(null);
      load();
      refresh();
    } catch (error) {
      notify('error', 'Could not remove', (error as Error).message);
    }
  };

  const iAmOwner = group.my_role === 'owner';
  const isStaff = can('remove_members');

  return (
    <div className="grid gap-3 p-3 sm:p-4">
      <SectionHeading
        title="Members"
        subtitle={meta ? `${formatNumber(meta.total)} members` : 'The people in this group'}
        icon={<Users className="size-4" />}
        action={can('invite_members') ? <Button size="sm" variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setInviteOpen(true)}>Invite</Button> : undefined}
      />
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mist-600" />
        <TextInput value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search members…" className="pl-9" />
      </div>
      <Segmented
        value={filter}
        onChange={(value) => { setFilter(value); setPage(1); }}
        options={[
          {value: 'all', label: 'All'},
          {value: 'online', label: 'Online'},
          {value: 'active', label: 'Most active'},
          {value: 'admins', label: 'Owner'},
          {value: 'moderators', label: 'Staff'},
        ]}
      />

      {loading && !items.length ? (
        <div className="grid gap-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title="No members match" detail="Try a different filter or search." />
      ) : (
        <ul className="grid gap-2">
          {items.map((member) => {
            const status = (member.status ?? 'offline') as PresenceStatus;
            const isSelf = member.student_id === myId;
            return (
              <li key={member.student_id}>
                <Card className="flex items-center gap-3 p-3">
                  <button type="button" onClick={() => openMember(member.student_id)} className="shrink-0">
                    <MemberAvatar member={member} size={40} status={status} />
                  </button>
                  <button type="button" onClick={() => openMember(member.student_id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[0.86rem] font-extrabold text-mist-50">{member.name}{isSelf && ' (you)'}</span>
                      <RoleChip role={member.role} />
                    </div>
                    <p className="mt-0.5 flex items-center gap-2 truncate text-[0.72rem] font-semibold text-mist-500">
                      <span>Lv {member.level ?? 1}</span>
                      {member.title && <span className="truncate">· {member.title}</span>}
                      <span className="tabular">· {formatNumber(member.week_xp)} XP this wk</span>
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    {can('challenge_duels') && !isSelf && (
                      <IconButton label={`Challenge ${member.name}`} onClick={() => setChallengeFor(member.student_id)}>
                        <Swords className="size-4 text-nova-300" />
                      </IconButton>
                    )}
                    {isStaff && !isSelf && member.role !== 'owner' && (
                      <>
                        {iAmOwner &&
                          (member.role === 'member' ? (
                            <IconButton label="Make moderator" onClick={() => void setRole(member, 'moderator')}>
                              <ShieldCheck className="size-4 text-nova-300" />
                            </IconButton>
                          ) : (
                            <IconButton label="Demote to member" onClick={() => void setRole(member, 'member')}>
                              <Crown className="size-4 text-mist-500" />
                            </IconButton>
                          ))}
                        <IconButton label={`Remove ${member.name}`} onClick={() => setConfirmRemove(member)}>
                          <Trash2 className="size-4 text-flare-300" />
                        </IconButton>
                      </>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {meta && meta.pages > 1 && <Pager page={meta.page} pages={meta.pages} total={meta.total} size={meta.size} onPage={setPage} label="Member pages" />}

      <ChallengeModal open={challengeFor !== null} onClose={() => setChallengeFor(null)} presetOpponent={challengeFor} />
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />

      <Modal
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        title="Remove member"
        subtitle={confirmRemove ? `${confirmRemove.name} will lose access to this group.` : ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void doRemove()} icon={<Trash2 className="size-4" />}>Remove</Button>
          </>
        }
      >
        <p className="text-[0.84rem] font-medium text-mist-300">
          This only removes them from the study group. They keep their arena account and progress.
        </p>
      </Modal>
    </div>
  );
}
