/**
 * A member's in-group dossier — public study data only (role, contribution,
 * quiz and duel record inside the group, recent activity). No private fields
 * like phone numbers are exposed. Actions: add friend, challenge to a duel,
 * jump to chat. Challenge reuses the group duel modal so it stays one system.
 */
import {ArrowLeft, MessageSquare, Swords, Trophy, UserPlus, Users} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, ProgressBar, SectionHeading, Skeleton, StatTile} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber, formatRelative} from '../lib/format';
import {useGroup} from './context';
import {MemberAvatar, RoleChip} from './bits';
import {ChallengeModal} from './Duels';
import type {GroupMemberProfile} from '../lib/types';

export default function MemberProfile({studentId, onBack}: {studentId: number; onBack: () => void}) {
  const {groupId, can, notify, go} = useGroup();
  const [profile, setProfile] = useState<GroupMemberProfile | null>(null);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [friendBusy, setFriendBusy] = useState(false);

  const load = useCallback(() => {
    api.groups.memberProfile(groupId, studentId).then(setProfile).catch(() => setProfile(null));
  }, [groupId, studentId]);

  useEffect(load, [load]);

  const addFriend = async () => {
    setFriendBusy(true);
    try {
      const result = await api.addFriend({student_id: studentId});
      notify('success', 'Friend request', result.status === 'friends' ? 'You are now friends.' : 'Request sent.');
      load();
    } catch (error) {
      notify('error', 'Could not add friend', (error as Error).message);
    } finally {
      setFriendBusy(false);
    }
  };

  if (!profile) {
    return (
      <div className="grid gap-3 p-3 sm:p-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const {student, role, contribution, quizzes, duels, recent_activity, friendship, is_self, week_xp, status} = profile;
  const friendStatus = friendship?.status ?? 'none';
  const duelWinRate = duels.played > 0 ? Math.round((duels.wins / duels.played) * 100) : 0;

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onBack} icon={<ArrowLeft className="size-4" />}>
          Back
        </Button>
      </div>

      {/* Identity card */}
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <MemberAvatar
            member={{id: student.id, name: student.name, initials: student.initials, avatar_hue: student.avatar_hue, has_photo: student.has_photo ?? false}}
            size={56}
            status={status}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[1.05rem] font-black text-mist-50">{student.name}{is_self && ' (you)'}</h2>
              <RoleChip role={role} />
            </div>
            <p className="mt-0.5 text-[0.78rem] font-semibold text-mist-500">
              Level {student.level ?? 1}{student.title ? ` · ${student.title}` : ''}
            </p>
            {student.status_text && <p className="mt-1 text-[0.74rem] font-medium text-mist-400">{student.status_text}</p>}
          </div>
        </div>

        {!is_self && (
          <div className="mt-3 flex flex-wrap gap-2">
            {can('challenge_duels') && (
              <Button size="sm" variant="primary" icon={<Swords className="size-4" />} onClick={() => setChallengeOpen(true)}>
                Challenge
              </Button>
            )}
            {friendStatus !== 'friends' && friendStatus !== 'pending' && (
              <Button size="sm" variant="outline" icon={<UserPlus className="size-4" />} disabled={friendBusy} onClick={() => void addFriend()}>
                {friendBusy ? 'Sending…' : 'Add friend'}
              </Button>
            )}
            {friendStatus === 'pending' && <Chip className="border-gold-500/30 bg-gold-500/12 text-gold-200">Friend request sent</Chip>}
            {friendStatus === 'friends' && <Chip className="border-mint-500/30 bg-mint-500/12 text-mint-200">Friends</Chip>}
            <Button size="sm" variant="ghost" icon={<MessageSquare className="size-4" />} onClick={() => go('chat')}>
              Group chat
            </Button>
          </div>
        )}
      </Card>

      {/* Contribution + week */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile label="Week XP" value={formatNumber(week_xp)} icon={<Trophy className="size-5" />} tone="gold" />
        <StatTile label="Messages" value={formatNumber(contribution.messages)} icon={<MessageSquare className="size-5" />} tone="nova" />
        <StatTile label="Answers" value={formatNumber(contribution.answers)} icon={<Users className="size-5" />} tone="mint" />
        <StatTile label="Quizzes done" value={`${quizzes.submitted}/${quizzes.taken}`} icon={<Trophy className="size-5" />} tone="pulse" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2 sm:gap-4">
        <Card className="p-3.5">
          <SectionHeading title="Quiz record" subtitle="In this group" icon={<Trophy className="size-4" />} />
          <div className="mt-2 grid gap-3">
            <div>
              <div className="flex items-center justify-between text-[0.74rem] font-bold text-mist-400">
                <span>Best score</span>
                <span className="tabular text-mint-300">{quizzes.best_percentage}%</span>
              </div>
              <ProgressBar value={quizzes.best_percentage} className="mt-1.5" />
            </div>
            <div>
              <div className="flex items-center justify-between text-[0.74rem] font-bold text-mist-400">
                <span>Average score</span>
                <span className="tabular text-nova-300">{quizzes.average_percentage}%</span>
              </div>
              <ProgressBar value={quizzes.average_percentage} className="mt-1.5" />
            </div>
          </div>
        </Card>

        <Card className="p-3.5">
          <SectionHeading title="Duel record" subtitle="Group challenges" icon={<Swords className="size-4" />} />
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/5 px-2 py-2.5">
              <p className="text-[0.62rem] font-bold tracking-wider text-mist-500">PLAYED</p>
              <p className="text-[1.05rem] font-black tabular text-mist-50">{duels.played}</p>
            </div>
            <div className="rounded-xl bg-mint-500/10 px-2 py-2.5">
              <p className="text-[0.62rem] font-bold tracking-wider text-mint-300">WINS</p>
              <p className="text-[1.05rem] font-black tabular text-mint-200">{duels.wins}</p>
            </div>
            <div className="rounded-xl bg-flare-500/10 px-2 py-2.5">
              <p className="text-[0.62rem] font-bold tracking-wider text-flare-300">LOSSES</p>
              <p className="text-[1.05rem] font-black tabular text-flare-200">{duels.losses}</p>
            </div>
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[0.74rem] font-bold text-mist-400">
              <span>Win rate</span>
              <span className="tabular text-gold-300">{duelWinRate}%</span>
            </div>
            <ProgressBar value={duelWinRate} className="mt-1.5" />
          </div>
        </Card>
      </div>

      <Card className="p-3.5">
        <SectionHeading title="Recent activity" subtitle={`${formatRelative(recent_activity[0]?.created_at ?? null) || 'No activity yet'}`} icon={<Users className="size-4" />} />
        <ul className="mt-1 grid gap-1.5">
          {recent_activity.slice(0, 6).map((row) => (
            <li key={row.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-nova-400" />
              <p className="min-w-0 flex-1 text-[0.78rem] font-medium text-mist-300">{row.text}</p>
              <span className="shrink-0 text-[0.66rem] font-semibold text-mist-600">{formatRelative(row.created_at)}</span>
            </li>
          ))}
          {recent_activity.length === 0 && <li className="px-2 py-3 text-[0.78rem] font-medium text-mist-600">No activity yet.</li>}
        </ul>
      </Card>

      <ChallengeModal open={challengeOpen} onClose={() => setChallengeOpen(false)} presetOpponent={studentId} />
    </div>
  );
}
