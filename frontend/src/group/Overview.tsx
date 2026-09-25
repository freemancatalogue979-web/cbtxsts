/**
 * The study-group command centre: everything a member needs to see at a
 * glance — who is here, what is starting soon, what is live, the latest
 * announcements, questions and activity — plus the permission-gated quick
 * actions. Reads one aggregated overview payload and refreshes on live events.
 */
import {
  Activity as ActivityIcon,
  CalendarClock,
  ChevronRight,
  Crown,
  Megaphone,
  MessageCircleQuestion,
  Plus,
  Radio,
  Swords,
  TrendingUp,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import type {ReactNode} from 'react';
import {Button, Card, Chip, EmptyState, ProgressBar, SectionHeading, Skeleton, StatTile} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {useGroup} from './context';
import {MemberAvatar} from './bits';
import {useCountdown} from '../lib/groupSocket';
import type {GroupOverview} from '../lib/types';

function QuizCountdown({iso}: {iso: string | null}) {
  const label = useCountdown(iso);
  return <span className="text-[0.72rem] font-bold text-mint-300">{label ? `Starts ${label}` : 'Open now'}</span>;
}

export default function Overview() {
  const {groupId, can, go, openQuiz, openDuel, refresh} = useGroup();
  const [data, setData] = useState<GroupOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.groups
      .overview(groupId)
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [groupId]);

  useEffect(load, [load]);

  /* Live refreshers — only re-read what the current page needs. */
  const {room} = useGroup();
  useEffect(() => room.on('group_quiz_update', load), [room, load]);
  useEffect(() => room.on('group_announcement', load), [room, load]);
  useEffect(() => room.on('group_activity', load), [room, load]);
  useEffect(() => room.on('group_question', load), [room, load]);
  useEffect(() => room.on('group_presence', load), [room, load]);

  if (error) return <EmptyState icon={<Users className="size-5" />} title="Could not load the group" detail={error} />;
  if (!data) {
    return (
      <div className="grid gap-3 p-3 sm:p-4">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  const {group, owner, stats, studying_now, upcoming_quizzes, active_duels, pinned_announcements, recent_announcements, recent_questions, recent_activity} = data;
  const announcements = [...pinned_announcements, ...recent_announcements.filter((row) => !pinned_announcements.some((p) => p.id === row.id))].slice(0, 4);

  const quickActions = [
    can('set_quiz') && {label: 'Set quiz', icon: <Zap className="size-4" />, onClick: () => go('quizzes', 'create')},
    can('challenge_duels') && {label: 'Start duel', icon: <Swords className="size-4" />, onClick: () => go('duels', 'create')},
    can('ask_questions') && {label: 'Ask question', icon: <MessageCircleQuestion className="size-4" />, onClick: () => go('questions', 'create')},
    can('publish_announcements') && {label: 'Announce', icon: <Megaphone className="size-4" />, onClick: () => go('announcements', 'create')},
    can('invite_members') && {label: 'Invite', icon: <UserPlus className="size-4" />, onClick: () => go('members', 'invite')},
    {label: 'View members', icon: <Users className="size-4" />, onClick: () => go('members')},
  ].filter(Boolean) as {label: string; icon: ReactNode; onClick: () => void}[];

  return (
    <div className="grid gap-3 p-3 sm:gap-4 sm:p-4">
      {/* Hero + quick actions */}
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[1.05rem] font-black text-mist-50">{group.name}</h2>
              <Chip className="border-nova-500/25 bg-nova-500/10 text-nova-200">{group.code}</Chip>
            </div>
            <p className="mt-1 text-[0.8rem] font-medium text-mist-400">{group.description || group.goal || 'A study community inside Quiz Arena.'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.74rem] font-semibold text-mist-500">
              {owner && (
                <span className="inline-flex items-center gap-1">
                  <Crown className="size-3.5 text-gold-300" /> {owner.name}
                </span>
              )}
              {data.course_title && <span>· {data.course_title}</span>}
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" /> {data.member_count} members
              </span>
              <span className="inline-flex items-center gap-1 text-mint-300">
                <Radio className="size-3.5" /> {data.online} online
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <Button key={action.label} size="sm" variant={action.label === 'Set quiz' ? 'primary' : 'outline'} icon={action.icon} onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile label="Quizzes run" value={formatNumber(stats.quizzes)} icon={<Zap className="size-5" />} tone="nova" />
        <StatTile label="Avg score" value={`${stats.average_score}%`} icon={<TrendingUp className="size-5" />} tone="mint" />
        <StatTile label="Messages / wk" value={formatNumber(stats.messages_week)} icon={<Megaphone className="size-5" />} tone="pulse" />
        <StatTile label="Open questions" value={formatNumber(stats.open_questions)} icon={<MessageCircleQuestion className="size-5" />} tone="gold" hint={`${stats.questions} total`} />
      </div>

      {/* Studying now */}
      {studying_now.length > 0 && (
        <Card className="p-3.5">
          <SectionHeading title="Studying now" subtitle={`${data.online} members online`} icon={<Radio className="size-4" />} />
          <div className="mt-2 flex flex-wrap gap-2">
            {studying_now.map((member) => (
              <button key={member.id} type="button" onClick={() => go('members')} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pr-3 pl-1 transition-colors hover:border-nova-400/40">
                <MemberAvatar member={member} size={26} status="online" />
                <span className="text-[0.74rem] font-bold text-mist-200">{member.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-2 sm:gap-4">
        {/* Upcoming quizzes */}
        <Card className="flex flex-col p-3.5">
          <SectionHeading
            title="Quizzes"
            subtitle="Upcoming and live group quizzes"
            icon={<CalendarClock className="size-4" />}
            action={
              <Button size="sm" variant="ghost" onClick={() => go('quizzes')} icon={<ChevronRight className="size-4" />}>
                All
              </Button>
            }
          />
          <ul className="mt-1 grid gap-2">
            {upcoming_quizzes.slice(0, 4).map((quiz) => (
              <li key={quiz.id}>
                <button type="button" onClick={() => (quiz.status === 'live' ? openQuiz(quiz.id) : go('quizzes'))} className="flex w-full items-center gap-2 rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2 text-left transition-colors hover:border-nova-400/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.82rem] font-bold text-mist-100">{quiz.title}</p>
                    <p className="text-[0.7rem] font-semibold text-mist-500">
                      {quiz.question_count} questions · {quiz.participants} joined
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {quiz.status === 'live' ? <Chip className="border-mint-500/30 bg-mint-500/12 text-mint-200">Live</Chip> : <QuizCountdown iso={quiz.starts_at} />}
                  </div>
                </button>
              </li>
            ))}
            {upcoming_quizzes.length === 0 && <li className="text-[0.78rem] font-medium text-mist-600">No quizzes scheduled.</li>}
          </ul>
        </Card>

        {/* Active duels */}
        <Card className="flex flex-col p-3.5">
          <SectionHeading
            title="Duels"
            subtitle="Challenges in this group"
            icon={<Swords className="size-4" />}
            action={
              <Button size="sm" variant="ghost" onClick={() => go('duels')} icon={<ChevronRight className="size-4" />}>
                All
              </Button>
            }
          />
          <ul className="mt-1 grid gap-2">
            {active_duels.slice(0, 4).map((duel) => (
              <li key={duel.id}>
                <button type="button" onClick={() => duel.i_am_in && openDuel(duel.id)} disabled={!duel.i_am_in} className="flex w-full items-center gap-2 rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2 text-left transition-colors hover:border-nova-400/40 disabled:opacity-70">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.82rem] font-bold text-mist-100">{duel.names.join(' vs ')}</p>
                    <p className="truncate text-[0.7rem] font-semibold text-mist-500">{duel.topic}{duel.public ? '' : ' · private'}</p>
                  </div>
                  <Chip className={duel.status === 'live' ? 'border-mint-500/30 bg-mint-500/12 text-mint-200' : 'border-white/12 bg-white/6 text-mist-400'}>
                    {duel.status === 'live' ? 'Live' : 'Invited'}
                  </Chip>
                </button>
              </li>
            ))}
            {active_duels.length === 0 && <li className="text-[0.78rem] font-medium text-mist-600">No active duels.</li>}
          </ul>
          {can('challenge_duels') && (
            <Button size="sm" variant="outline" className="mt-2 self-start" icon={<Swords className="size-4" />} onClick={() => go('duels', 'create')}>
              Challenge a member
            </Button>
          )}
        </Card>

        {/* Announcements */}
        <Card className="flex flex-col p-3.5">
          <SectionHeading
            title="Announcements"
            icon={<Megaphone className="size-4" />}
            action={
              <Button size="sm" variant="ghost" onClick={() => go('announcements')} icon={<ChevronRight className="size-4" />}>
                All
              </Button>
            }
          />
          <ul className="mt-1 grid gap-2">
            {announcements.map((row) => (
              <li key={row.id} className={`rounded-xl border px-3 py-2 ${row.pinned ? 'border-gold-500/30 bg-gold-500/8' : 'border-white/8 bg-ink-900/50'}`}>
                <div className="flex items-center gap-2">
                  {row.pinned && <span className="text-[0.62rem] font-black tracking-wide text-gold-300">PINNED</span>}
                  <p className="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-mist-100">{row.title}</p>
                  {row.priority === 'high' && <Chip className="border-flare-500/30 bg-flare-500/12 text-flare-200">High</Chip>}
                </div>
                {row.body && <p className="mt-0.5 line-clamp-2 text-[0.74rem] font-medium text-mist-400">{row.body}</p>}
              </li>
            ))}
            {announcements.length === 0 && <li className="text-[0.78rem] font-medium text-mist-600">No announcements yet.</li>}
          </ul>
        </Card>

        {/* Recent questions */}
        <Card className="flex flex-col p-3.5">
          <SectionHeading
            title="Recent questions"
            icon={<MessageCircleQuestion className="size-4" />}
            action={
              <Button size="sm" variant="ghost" onClick={() => go('questions')} icon={<ChevronRight className="size-4" />}>
                All
              </Button>
            }
          />
          <ul className="mt-1 grid gap-2">
            {recent_questions.slice(0, 4).map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => go('questions')} className="flex w-full items-center gap-2 rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2 text-left transition-colors hover:border-nova-400/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.82rem] font-bold text-mist-100">{row.title}</p>
                    <p className="text-[0.7rem] font-semibold text-mist-500">
                      {row.asker?.name?.split(' ')[0]} · {row.answers_count} replies
                    </p>
                  </div>
                  {row.status === 'open' ? (
                    <Chip className="border-gold-500/30 bg-gold-500/12 text-gold-200">Open</Chip>
                  ) : (
                    <Chip className="border-mint-500/30 bg-mint-500/12 text-mint-200">Answered</Chip>
                  )}
                </button>
              </li>
            ))}
            {recent_questions.length === 0 && <li className="text-[0.78rem] font-medium text-mist-600">No questions yet.</li>}
          </ul>
        </Card>
      </div>

      {/* Activity + progress */}
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr] sm:gap-4">
        <Card className="p-3.5">
          <SectionHeading
            title="Recent activity"
            icon={<ActivityIcon className="size-4" />}
            action={
              <Button size="sm" variant="ghost" onClick={() => go('activity')} icon={<ChevronRight className="size-4" />}>
                All
              </Button>
            }
          />
          <ul className="mt-1 grid gap-1.5">
            {recent_activity.slice(0, 6).map((row) => (
              <li key={row.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-nova-400" />
                <p className="min-w-0 flex-1 text-[0.78rem] font-medium text-mist-300">{row.text}</p>
              </li>
            ))}
            {recent_activity.length === 0 && <li className="text-[0.78rem] font-medium text-mist-600">Nothing yet.</li>}
          </ul>
        </Card>

        <Card className="p-3.5">
          <SectionHeading title="Group progress" subtitle="Toward a strong average" icon={<TrendingUp className="size-4" />} />
          <div className="mt-2 grid gap-3">
            <div>
              <div className="flex items-center justify-between text-[0.74rem] font-bold text-mist-400">
                <span>Average quiz score</span>
                <span className="tabular text-mint-300">{stats.average_score}%</span>
              </div>
              <ProgressBar value={stats.average_score} className="mt-1.5" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/5 px-3 py-2">
                <p className="text-[0.62rem] font-bold tracking-wider text-mist-500">DUELS</p>
                <p className="text-[0.95rem] font-black tabular text-mist-50">{formatNumber(stats.duels)}</p>
              </div>
              <div className="rounded-xl bg-white/5 px-3 py-2">
                <p className="text-[0.62rem] font-bold tracking-wider text-mist-500">MEMBERS</p>
                <p className="text-[0.95rem] font-black tabular text-mist-50">{formatNumber(data.member_count)}</p>
              </div>
            </div>
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={refresh} className="self-start">
              Refresh
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
